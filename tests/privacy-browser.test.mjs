import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:https';
import {initializeApp,getApps,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {getAuth} from 'firebase-admin/auth';
import {build as viteBuild} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {chromium} from 'playwright';
import {assertPrivacyEmulator,PRIVACY_EMULATOR_PROJECT} from '../server/governance/privacyRightsEmulator.ts';
import {PRIVACY_CID_ORIGIN as origin} from '../server/governance/privacyCidEvidenceEmulator.ts';
import {createPrivacyHttpEmulatorHandler} from '../server/governance/privacyHttpEmulator.ts';
import {isolatedTagPasskeyScope,issueTagPasskeyChallenge} from '../server/identity/kyrubTagPasskeyPolicy.ts';
import {tagRegistrationOptions,verifyTagRegistration} from '../server/identity/kyrubTagPasskeyVerifier.ts';
const random=()=>randomBytes(32).toString('base64url'),hash=s=>createHash('sha256').update(s).digest('hex');
test('privacy central: CID request, virtual WebAuthn, separate operator browsers and private tracking',{timeout:180000},async()=>{
 assertPrivacyEmulator();
 const app=initializeApp({projectId:PRIVACY_EMULATOR_PROJECT},'privacy-browser-fixtures'),db=getFirestore(app),auth=getAuth(app);
 const folder=mkdtempSync(join(tmpdir(),'privacy-browser-')),key=join(folder,'key.pem'),cert=join(folder,'cert.pem');
 const tagId='a'.repeat(32),ownerId='privacy-browser-cid-owner',host=new URL(origin).hostname;
 let server,browser;
 const errors=[],external=[];
 try{
  async function operator(uid,permissions){
   const email=uid+'@example.invalid',password='LocalFixturePassword123!';
   await auth.createUser({uid,email,password,emailVerified:true});
   await db.doc('kyrub_admin/control_plane/admins/'+uid).set({uid,role:'compliance',status:'active'});
   await db.doc('kyrub_admin/control_plane/privacy_rights_grants/'+uid).set({uid,status:'active',permissions});
   const response=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
   assert.equal(response.status,200);return (await response.json()).idToken;
  }
  const adminToken=await operator('privacy-browser-admin',['privacy:read','privacy:triage','privacy:assess','privacy:prepare-response','privacy:review-response']),reviewerToken=await operator('privacy-browser-reviewer',['privacy:read','privacy:review-response']);
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN='+host,'-addext','subjectAltName=DNS:'+host],{stdio:'ignore'});
  const out=join(folder,'dist');
  await viteBuild({configFile:false,publicDir:false,plugins:[tailwindcss()],esbuild:{jsx:'automatic'},build:{outDir:out,emptyOutDir:true,rollupOptions:{input:resolve('tests/fixtures/privacy-browser.html')}}});
  const html=readFileSync(join(out,'tests/fixtures/privacy-browser.html')),handler=createPrivacyHttpEmulatorHandler();
  server=createServer({key:readFileSync(key),cert:readFileSync(cert)},(req,res)=>{
   if(req.url?.startsWith('/privacy-homologation/api/'))return void handler(req,res);
   if(req.method==='GET'&&req.url==='/privacy-test'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
   const asset=/^\/assets\/([A-Za-z0-9_.-]+\.(?:js|css))$/.exec(req.url??'');
   if(req.method==='GET'&&asset){try{res.setHeader('Content-Type',asset[1].endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');res.end(readFileSync(join(out,'assets',asset[1])));return;}catch{}}
   res.statusCode=404;res.end();
  });
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(8449,'127.0.0.1',ok);});
  browser=await chromium.launch({headless:true,args:['--no-proxy-server','--host-resolver-rules=MAP '+host+' 127.0.0.1:8449, MAP * ~NOTFOUND']});
  async function device(){
   const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:844},serviceWorkers:'block'});
   await ctx.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===origin)return route.continue();external.push(u.origin);return route.abort();});
   const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto(origin+'/privacy-test');await page.waitForFunction(()=>typeof window.privacyTestMount==='function');
   return {ctx,page};
  }
  const owner=await device(),other=await device(),preparer=await device(),reviewer=await device(),p=owner.page;
  async function mountOperator(device,uid,token,role='compliance'){
   const profile={uid,role,status:'active',email:uid+'@example.invalid',displayName:'Operador fictício',createdBy:'fixture',createdAt:'',updatedAt:'',suspendedAt:'',revokedAt:''};
   await device.page.evaluate(({profile,token})=>window.privacyTestMountAdmin(profile,token),{profile,token});
  }
  await mountOperator(preparer,'privacy-browser-admin',adminToken);
  await mountOperator(reviewer,'privacy-browser-reviewer',reviewerToken);
  for(const device of [preparer,reviewer]){await device.page.getByRole('heading',{name:'Governança e Compliance'}).click();await device.page.getByRole('button',{name:'Consultar fila'}).waitFor();}
  const a=preparer.page,b=reviewer.page;
  const cdp=await owner.ctx.newCDPSession(p);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
  const registration=issueTagPasskeyChallenge({tagId,purpose:'register',ownerId:null,credentialId:null,scope:isolatedTagPasskeyScope(origin,origin)},Date.now());
  const options=await tagRegistrationOptions(registration),response=await p.evaluate(o=>window.privacyTestRegister(o),options);
  const stored=await verifyTagRegistration(registration,response);
  await db.collection('kyrub_official_tags').doc(tagId).set({ownerId,ownerAuthMode:'passkey',enabled:true,blocked:false});
  await db.collection('kyrub_tag_passkey_credentials').doc(tagId).set({ownerId,credential:stored});
  await db.collection('kyrub_tag_passkey_credential_index').doc(hash(stored.id)).set({ownerId,tagId});
  const credential={id:random(),secret:random()},now=Date.now();
  await db.collection('privacy_emulator_channels').doc(credential.id).set({id:credential.id,digest:hash(credential.secret),verifiedAt:now-1000,expiresAt:now+600000,simulation:true,boundTagId:tagId,boundOwnerId:ownerId});
  await p.evaluate(c=>window.privacyTestMount(c),credential);
  await p.getByLabel('Direito de privacidade').selectOption('access');
  assert.equal(await p.getByRole('button',{name:'Registrar solicitação'}).isDisabled(),true);
  await p.getByRole('checkbox',{name:'Confirmo que desejo registrar esta solicitação.'}).check();
  await p.getByRole('button',{name:'Registrar solicitação'}).click();
  await p.getByText('Recebimento simulado confirmado').waitFor();
  const requests=await db.collection('privacy_emulator_requests').get();assert.equal(requests.size,1);
  const protocol=requests.docs[0].id;
  await p.getByRole('button',{name:'Exibir código privado'}).click();
  const code=await p.getByLabel('Código privado de acompanhamento').inputValue();
  await a.getByRole('button',{name:'Consultar fila'}).click();
  await a.getByRole('button',{name:'Solicitar verificação'}).click();
  await a.getByText('Verificação requerida · Aguardando comprovação').waitFor();
  assert.equal((await requests.docs[0].ref.get()).get('revision'),1);
  async function track(page,secret){
   await page.getByRole('button',{name:'Acompanhar',exact:true}).click();
   await page.getByLabel('Protocolo',{exact:true}).fill(protocol);
   await page.getByLabel('Código privado',{exact:true}).fill(secret);
   await page.getByRole('button',{name:'Consultar andamento'}).click();
  }
  await other.page.evaluate(()=>window.privacyTestMount());
  await track(other.page,random());
  await other.page.getByText('Não foi possível confirmar o acesso.',{exact:false}).waitFor();
  await track(p,code);
  await p.getByRole('button',{name:'Confirmar controle do CID'}).click();
  await p.getByText('Controle do CID confirmado. Análise de identidade pendente.').waitFor();
  const evidence=(await db.collection('privacy_emulator_identity_evidence').doc(protocol).get()).data();
  assert.equal(evidence.authorizesExecution,false);assert.equal(evidence.kind,'cid-passkey-control');
  await a.getByRole('button',{name:'Consultar fila'}).click();
  await a.getByText('Verificação requerida · Controle de credencial comprovado').waitFor();
  await a.getByRole('button',{name:'Registrar parecer'}).click();
  await a.getByLabel('Parecer',{exact:true}).selectOption('ready-for-fulfillment-review');
  assert.equal(await a.getByRole('button',{name:'Confirmar parecer'}).isDisabled(),true);
  await a.getByLabel('Justificativa fictícia (sem dados pessoais)').fill('Exercício fictício');
  await a.getByRole('button',{name:'Confirmar parecer'}).click();
  await a.getByRole('button',{name:'Preparar aviso'}).click();
  await a.getByText('Aviso: rascunho').waitFor();
  const record=db.collection('privacy_emulator_responses').doc(protocol+'_1');
  // Same actor has the review grant but cannot approve its own draft.
  await a.getByRole('button',{name:'Aprovar aviso'}).click();
  await a.getByText('Não foi possível confirmar a operação.',{exact:false}).waitFor();
  assert.equal((await record.get()).get('status'),'draft');
  await b.getByRole('button',{name:'Consultar fila'}).click();
  await b.getByRole('button',{name:'Aprovar aviso'}).waitFor();
  const grant=db.doc('kyrub_admin/control_plane/privacy_rights_grants/privacy-browser-reviewer');
  await grant.update({status:'revoked'});
  await b.getByRole('button',{name:'Aprovar aviso'}).click();
  await b.getByText('Não foi possível confirmar a operação.',{exact:false}).waitFor();
  assert.equal((await record.get()).get('status'),'draft');
  await grant.update({status:'active'});
  await b.getByRole('button',{name:'Consultar fila'}).click();
  await b.getByRole('button',{name:'Aprovar aviso'}).click();
  await b.getByText('Aviso: revisado').waitFor();
  const reviewed=(await record.get()).data();
  assert.equal(reviewed.preparedBy,'privacy-browser-admin');assert.equal(reviewed.reviewedBy,'privacy-browser-reviewer');assert.equal(reviewed.delivered,false);
  await p.getByRole('button',{name:'Consultar andamento'}).click();
  await p.getByText('Sua solicitação foi encaminhada para preparação do atendimento.',{exact:false}).waitFor();
  assert.equal((await requests.docs[0].ref.get()).get('actionStatus'),'not-executed');
  await p.getByRole('checkbox',{name:'Revogar este código privado',exact:false}).check();
  await p.getByRole('button',{name:'Revogar código'}).click();
  await p.getByText('Código de acompanhamento revogado na homologação.',{exact:false}).waitFor();
  assert.equal((await requests.docs[0].ref.get()).exists,true);
  for(const device of [owner,other,preparer,reviewer]){
   assert.equal(await device.page.evaluate(()=>localStorage.length+sessionStorage.length),0);
   assert.equal((await device.ctx.cookies()).length,0);
  }
  await mountOperator(other,'privacy-browser-reviewer',reviewerToken,'support');
  await other.page.getByRole('region',{name:'Central de Privacidade'}).waitFor({state:'detached'});
  assert.equal(await other.page.getByRole('heading',{name:'Governança e Compliance'}).count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 }finally{await browser?.close();if(server)await new Promise(r=>server.close(r));rmSync(folder,{recursive:true,force:true});for(const a of getApps().filter(a=>a.name.startsWith('privacy-')))await deleteApp(a);}
});
