import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer,request} from 'node:https';
import {initializeApp,getApps,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {getAuth} from 'firebase-admin/auth';
import {assertPrivacyEmulator,PRIVACY_EMULATOR_PROJECT} from '../server/governance/privacyRightsEmulator';
import {createPrivacyHttpEmulatorHandler,PRIVACY_HTTP_ORIGIN as origin} from '../server/governance/privacyHttpEmulator';
assertPrivacyEmulator();
const app=initializeApp({projectId:PRIVACY_EMULATOR_PROJECT},'privacy-http-fixtures'),db=getFirestore(app),auth=getAuth(app);
const random=()=>randomBytes(32).toString('base64url');
after(async()=>{for(const a of getApps().filter(a=>['privacy-http-fixtures','privacy-rights-local-emulator','privacy-admin-local-emulator','privacy-optional-consent-local-emulator','privacy-own-data-export-local-emulator'].includes(a.name)))await deleteApp(a);});
test('local TLS connects intake, independent review, tracking and optional consent',async()=>{
 async function account(uid:string){
  const email=uid+'@example.invalid',password='LocalFixturePassword123!';
  await auth.createUser({uid,email,password,emailVerified:true});
  const res=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
  assert.equal(res.status,200);return (await res.json() as {idToken:string}).idToken;
 }
 const uid='privacy-http-owner',owner=await account(uid),admin=await account('privacy-http-admin'),reviewer=await account('privacy-http-reviewer');
 for(const [id,permissions] of [['privacy-http-admin',['privacy:read','privacy:triage','privacy:assess','privacy:prepare-response']],['privacy-http-reviewer',['privacy:read','privacy:review-response']]] as const){
  await db.doc('kyrub_admin/control_plane/admins/'+id).set({uid:id,role:'compliance',status:'active'});
  await db.doc('kyrub_admin/control_plane/privacy_rights_grants/'+id).set({uid:id,status:'active',permissions});
 }
 const credential={id:random(),secret:random()},now=Date.now();
 await db.collection('privacy_emulator_channels').doc(credential.id).set({id:credential.id,digest:createHash('sha256').update(credential.secret).digest('hex'),verifiedAt:now-1000,expiresAt:now+600000,simulation:true,boundAccountUid:uid});
 const directory=mkdtempSync(join(tmpdir(),'privacy-tls-')),key=join(directory,'key.pem'),cert=join(directory,'cert.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=127.0.0.1'],{stdio:'ignore'});
 const server=createServer({key:readFileSync(key),cert:readFileSync(cert)},createPrivacyHttpEmulatorHandler());
 try{
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(8449,'127.0.0.1',resolve);});
  const call=(action:string,data:unknown,token='',override:Record<string,string>={})=>new Promise<{status:number;body:any;cache:string|undefined}>((resolve,reject)=>{
   const req=request({hostname:'127.0.0.1',port:8449,path:'/privacy-homologation/api/'+action,method:'POST',rejectUnauthorized:false,headers:{Host:new URL(origin).host,Origin:origin,'X-Privacy-Homologation':'1','Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...override}},res=>{
    const chunks:Buffer[]=[];res.on('data',c=>chunks.push(Buffer.from(c)));res.on('end',()=>{try{resolve({status:res.statusCode??0,body:JSON.parse(Buffer.concat(chunks).toString()),cache:res.headers['cache-control']});}catch(e){reject(e);}});
   });req.on('error',reject);req.end(JSON.stringify(data));
  });
  const input={credential,requestId:random(),draft:{right:'access',context:'ecosystem',confirmed:true}};
  assert.equal((await call('submit',input,'',{Origin:'https://foreign.example'})).status,403);
  assert.equal((await call('submit',{...input,now:1})).status,403);
  const submitted=await call('submit',input);assert.equal(submitted.status,200);assert.equal(submitted.cache,'no-store');
  const {protocol,trackingCode:code}=submitted.body,scope={protocol,code};
  assert.equal((await call('submit',input)).body.protocol,protocol);
  assert.equal((await call('track?code=bad',scope)).status,404);
  assert.equal((await call('track',{protocol,code:random()})).status,403);
  assert.equal((await call('admin-list',{},owner)).status,403);
  assert.equal((await call('admin-triage',{protocol,expectedRevision:0},admin)).status,200);
  assert.equal((await call('confirm-account',scope,admin)).status,403);
  assert.equal((await call('confirm-account',scope,owner)).body.evidenceStatus,'account-control-confirmed');
  assert.equal((await call('admin-assess',{protocol,expectedRevision:0,finding:'ready-for-fulfillment-review',reason:'Homologação'},admin)).status,200);
  assert.equal((await call('admin-prepare',{protocol,expectedAssessmentRevision:1},admin)).status,200);
  assert.equal((await call('track',scope)).body.reviewedNotice,undefined);
  const review={protocol,expectedAssessmentRevision:1,expectedResponseRevision:1,decision:'approve'};
  assert.equal((await call('admin-review',review,admin)).status,403);
  assert.equal((await call('admin-review',review,reviewer)).status,200);
  assert.ok((await call('track',scope)).body.reviewedNotice);
  assert.equal((await call('track',scope)).body.actionStatus,'not-executed');
  const profile=db.collection('privacy_emulator_fixture_profiles').doc(uid);
  await profile.set({ownerUid:uid,displayName:'Perfil fictício',createdAt:now-1000,simulation:true,privateNote:'não exportar'});
  await db.collection('privacy_emulator_fixture_preferences').doc(uid).set({ownerUid:uid,locale:'pt-BR',theme:'dark',simulation:true});
  assert.equal((await call('own-export',scope,admin)).status,403);
  assert.equal((await call('own-export',scope)).status,403);
  const exported=await call('own-export',scope,owner);
  assert.equal(exported.status,200);assert.equal(exported.body.completeAccessResponse,false);
  assert.equal(exported.body.data.profile.displayName,'Perfil fictício');
  assert.equal(exported.body.data.profile.privateNote,undefined);
  assert.equal((await call('own-confirm',scope,owner)).status,403);
  async function prepare(right:string){
   const s=await call('submit',{...input,requestId:random(),draft:{...input.draft,right}});
   assert.equal(s.status,200);
   const p=s.body.protocol,c=s.body.trackingCode;
   assert.equal((await call('admin-triage',{protocol:p,expectedRevision:0},admin)).status,200);
   assert.equal((await call('confirm-account',{protocol:p,code:c},owner)).status,200);
   assert.equal((await call('admin-assess',{protocol:p,expectedRevision:0,finding:'ready-for-fulfillment-review',reason:'Homologação'},admin)).status,200);
   assert.equal((await call('admin-prepare',{protocol:p,expectedAssessmentRevision:1},admin)).status,200);
   assert.equal((await call('admin-review',{...review,protocol:p},reviewer)).status,200);
   return {protocol:p,code:c};
  }
  const confirmScope=await prepare('confirm-processing');
  const confirmed=await call('own-confirm',confirmScope,owner);
  assert.equal(confirmed.status,200);assert.deepEqual(confirmed.body.categories,['profile','preferences']);assert.equal(confirmed.body.completeConfirmationResponse,false);
  const correction=await prepare('correction'),change={expectedDisplayName:'Perfil fictício',displayName:'Nome fictício corrigido'};
  assert.equal((await call('own-correct',{...scope,change},owner)).status,403);
  assert.equal((await call('own-correct',{...correction,change},admin)).status,403);
  assert.equal((await call('own-correct',{...correction,change:{...change,ownerUid:uid}},owner)).status,403);
  assert.equal((await call('own-correct',{...correction,change},owner)).status,200);
  assert.equal((await profile.get()).get('displayName'),change.displayName);
  assert.equal((await profile.get()).get('privateNote'),'não exportar');
  assert.equal((await call('own-correct',{...correction,change},owner)).status,403);
  assert.equal((await db.collection('privacy_emulator_requests').doc(correction.protocol).get()).get('actionStatus'),'not-executed');
  const consent={purpose:'fixture-product-news',expectedRevision:0,decision:'grant',version:'fixture-1',confirmed:true};
  assert.equal((await call('consents-change',consent)).status,403);
  assert.equal((await call('consents-change',consent,owner)).body.effective,true);
  assert.equal((await call('consents-change',{...consent,decision:'withdraw',expectedRevision:1},owner)).body.effective,false);
  assert.equal((await call('revoke',scope)).status,200);assert.equal((await call('track',scope)).status,403);
  assert.equal((await call('own-export',scope,owner)).status,403);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(directory,{recursive:true,force:true});}
});
