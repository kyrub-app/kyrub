import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {after,test} from 'node:test';
import {randomUUID} from 'node:crypto';

const project='kyrub-security-test';
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8088');
for(const key of ['FIREBASE_PROJECT_ID','GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT'])assert.equal(process.env[key],project);
for(const key of ['VERCEL','VERCEL_ENV','FIREBASE_SERVICE_ACCOUNT_JSON','GOOGLE_APPLICATION_CREDENTIALS'])assert.ok(!process.env[key],key);
assert.equal(process.env.NODE_ENV,'test');
assert.equal(process.env.KYRUB_FREELANCE_LOCAL_HOMOLOGATION,'true');
const {initializeApp,getApps}=await import('firebase-admin/app');
const {getAuth}=await import('firebase-admin/auth');
const {getFirestore}=await import('firebase-admin/firestore');
const app=getApps()[0]??initializeApp({projectId:project});
assert.equal(app.options.projectId,project);
const auth=getAuth(app),db=getFirestore(app);
const {handleFreelanceWorkspace,freelanceWorkspaceEnabled}=await import('../server/freelance/freelanceWorkspaceTransport.js');
const {confirmSimulatedFreelanceFunding}=await import('../server/freelance/freelanceFundingService.js');
const {listFreelanceReviews,decideFreelanceReview}=await import('../server/admin/freelanceReviewService.js');
assert.equal(freelanceWorkspaceEnabled(),true);

const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url??'/','http://127.0.0.1');
  if(url.pathname!=='/api/freelance/workspace'){res.statusCode=404;res.end();return;}
  const chunks:Buffer[]=[];
  for await(const chunk of req)chunks.push(Buffer.from(chunk));
  const raw=Buffer.concat(chunks).toString('utf8');
  const response={setHeader:(k:string,v:string)=>res.setHeader(k,v),status:(code:number)=>{res.statusCode=code;return response;},json:(value:unknown)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));}};
  await handleFreelanceWorkspace({method:req.method,headers:req.headers,query:Object.fromEntries(url.searchParams),body:raw?JSON.parse(raw):undefined},response);
 }catch{res.statusCode=500;res.end(JSON.stringify({code:'TEST_HTTP_ERROR'}));}
});
server.listen(0,'127.0.0.1');await once(server,'listening');
after(async()=>{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await db.terminate();});
const address=server.address();assert.ok(address&&typeof address!=='string');
const endpoint='http://127.0.0.1:'+address.port+'/api/freelance/workspace';
const suffix=randomUUID().replaceAll('-','').slice(0,12);
async function account(role:string,profiles:string[]){
 const email='freelas-'+role+'-'+suffix+'@example.invalid';
 const password='FixtureOnly-'+randomUUID();
 const uid='freela-'+role+'-'+suffix;
 await auth.createUser({uid,email,password,emailVerified:true});
 const signed=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-emulator-key',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
 assert.equal(signed.status,200);
 const {idToken}=await signed.json() as {idToken:string};
 assert.ok(idToken);
 assert.equal((await auth.verifyIdToken(idToken,true)).uid,uid);
 if(profiles.length)await db.doc('identity_verifications/'+uid).set({status:'approved',approvedProfiles:profiles});
 return {uid,token:idToken};
}
type Actor=Awaited<ReturnType<typeof account>>;
async function call(actor:Actor|null,query:string,expected:number,body?:Record<string,unknown>){
 const response=await fetch(endpoint+query,{method:body?'POST':'GET',headers:{...(actor?{authorization:'Bearer '+actor.token}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const payload=await response.json();
 assert.equal(response.status,expected,JSON.stringify(payload));
 assert.match(response.headers.get('cache-control')??'',/no-store/);
 return payload;
}
const act=(actor:Actor,offerId:string,action:string,expected=200,extra:Record<string,unknown>={})=>call(actor,'',expected,{action,offerId,...extra});

test('authenticated HTTP journey: two parties, independent outsider, funding barrier, completion and personal statements',async()=>{
 const owner=await account('owner',['requester']),worker=await account('worker',['freelancer']),outsider=await account('outsider',['freelancer']);
 const offerId='http-normal-'+suffix,terms={title:'Serviço fictício HTTP',description:'Somente emulador',requirements:'',paymentMinor:15000};
 await call(null,'?view=owner',401);
 await act(outsider,offerId,'publish',403,{terms});
 assert.deepEqual(await act(owner,offerId,'publish',200,{terms}),{confirmed:true});
 assert.ok((await call(worker,'?view=open',200)).items.some((x:{id:string})=>x.id===offerId));
 await act(worker,offerId,'apply');await act(outsider,offerId,'apply');
 const candidates=await call(owner,'?view=detail&offerId='+offerId,200);
 assert.equal(candidates.applications.length,2);
 const own=await call(worker,'?view=detail&offerId='+offerId,200);
 assert.deepEqual(own.applications.map((a:{applicantUid:string})=>a.applicantUid),[worker.uid]);
 await act(worker,offerId,'select',403,{applicantUid:worker.uid});
 await act(owner,offerId,'select',200,{applicantUid:worker.uid});
 await act(outsider,offerId,'confirm',403,{confirmed:true});
 await act(worker,offerId,'confirm',200,{confirmed:true});
 const lost=await call(outsider,'?view=alerts',200);
 assert.ok(lost.alerts.some((a:{offerId:string;state:string})=>a.offerId===offerId&&a.state==='not_selected'));
 assert.equal((await act(worker,offerId,'start',409,{confirmed:true})).code,'FREELANCE_FUNDING_REQUIRED');
 await act(owner,offerId,'confirm_funding',400);
 await confirmSimulatedFreelanceFunding(offerId,'http-payment-'+suffix,15000,owner.uid,worker.uid);
 await act(worker,offerId,'start',200,{confirmed:true});
 await act(worker,offerId,'request_completion',200,{confirmed:true});
 await act(worker,offerId,'confirm_completion',403,{confirmed:true});
 const completions=await Promise.all([act(owner,offerId,'confirm_completion',200,{confirmed:true}),act(owner,offerId,'confirm_completion',200,{confirmed:true})]);
 assert.deepEqual(completions,[{confirmed:true},{confirmed:true}]);
 const earnings=await call(worker,'?view=earnings',200);
 assert.equal(earnings.confirmedMinor,15000);assert.equal(earnings.receivedMinor,null);
 assert.equal(earnings.entries.length,1);
 assert.equal(earnings.entries[0].state,'service_confirmed');
 for(const actor of [owner,outsider]){
  const other=await call(actor,'?view=earnings&uid='+worker.uid,200);
  assert.deepEqual(other.entries,[]);assert.equal(other.receivedMinor,null);
 }
 const snapshot=await db.doc('freelanceOffersV1/'+offerId).collection('financialBasis').get();
 assert.equal(snapshot.size,1);assert.equal(snapshot.docs[0].get('confirmedServiceMinor'),15000);
 assert.equal(snapshot.docs[0].get('settlement'),'not_verified');
 console.log('PASS freelance HTTP: publication, private candidates, funding, dual completion, personal earnings');
});

test('HTTP occurrence freezes contract; administrative authority requires recent MFA',async()=>{
 const owner=await account('dispute-owner',['requester']),worker=await account('dispute-worker',['freelancer']),admin=await account('review-admin',[]);
 await db.doc('kyrub_admin/control_plane/admins/'+admin.uid).set({uid:admin.uid,role:'super_admin',status:'active'});
 const offerId='http-review-'+suffix,occurrenceId='http-occurrence-'+suffix;
 await act(owner,offerId,'publish',200,{terms:{title:'Ocorrência fictícia',description:'Teste isolado',requirements:'',paymentMinor:20000}});
 await act(worker,offerId,'apply');await act(owner,offerId,'select',200,{applicantUid:worker.uid});
 await act(worker,offerId,'confirm',200,{confirmed:true});
 await confirmSimulatedFreelanceFunding(offerId,'http-review-payment-'+suffix,20000,owner.uid,worker.uid);
 await act(worker,offerId,'start',200,{confirmed:true});
 await act(worker,offerId,'report',200,{confirmed:true,kind:'service_disputed',occurrenceId});
 await act(worker,offerId,'request_completion',409,{confirmed:true});
 await act(owner,offerId,'respond',200,{confirmed:true,position:'agree',occurrenceId});
 const detail=await call(owner,'?view=detail&offerId='+offerId,200);
 assert.equal(detail.item.status,'under_review');assert.equal(detail.occurrence.response,'agree');
 await assert.rejects(listFreelanceReviews('Bearer '+admin.token,undefined),/second_factor_required/);
 await assert.rejects(decideFreelanceReview('Bearer '+admin.token,{offerId,occurrenceId,outcome:'resume',reason:'Motivo de teste isolado',confirmed:true}),/second_factor_required/);
 const earnings=await call(worker,'?view=earnings',200);
 assert.equal(earnings.reviewCount,1);assert.equal(earnings.confirmedMinor,0);assert.equal(earnings.receivedMinor,null);
 assert.equal((await db.doc('freelanceOffersV1/'+offerId).get()).get('status'),'under_review');
 console.log('PASS freelance HTTP: occurrence, response, freeze, refusal without MFA; positive MFA not covered');
});
