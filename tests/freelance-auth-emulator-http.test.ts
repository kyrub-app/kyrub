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
const {handleFreelanceFinancialReview}=await import('../server/admin/freelanceFinancialReviewTransport.js');
const {handleFreelanceFinance}=await import('../server/freelance/freelanceFinanceTransport.js');
assert.equal(freelanceWorkspaceEnabled(),true);
const {handlePersonalPix,personalPixTransportEnabled,personalPixRecentLogin}=await import('../server/payments/personalPixTransport.js');
assert.equal(personalPixTransportEnabled(),true);

const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url??'/','http://127.0.0.1');
  if(!['/api/freelance/workspace','/api/personal-finance/pix','/api/admin/freelance-financial-review','/api/freelance/finance'].includes(url.pathname)){res.statusCode=404;res.end();return;}
  const chunks:Buffer[]=[];
  for await(const chunk of req)chunks.push(Buffer.from(chunk));
  const raw=Buffer.concat(chunks).toString('utf8');
  const response={setHeader:(k:string,v:string)=>res.setHeader(k,v),status:(code:number)=>{res.statusCode=code;return response;},json:(value:unknown)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));}};
  const request={method:req.method,headers:req.headers,query:Object.fromEntries(url.searchParams),body:raw?JSON.parse(raw):undefined};
  if(url.pathname==='/api/freelance/finance')await handleFreelanceFinance(request,response);else if(url.pathname==='/api/admin/freelance-financial-review')await handleFreelanceFinancialReview(request,response);else if(url.pathname==='/api/personal-finance/pix')await handlePersonalPix(request,response);else await handleFreelanceWorkspace(request,response);
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
 assert.equal((await act(worker,offerId,'select',400,{applicantUid:worker.uid})).code,'FREELANCE_INVALID');
 assert.equal((await act(worker,offerId,'select',403,{applicantUid:outsider.uid})).code,'FREELANCE_FORBIDDEN');
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


test('administrative transaction: role, synthetic MFA claim policy, resume, cancellation, replay and audit',async t=>{
 const owner=await account('admin-test-owner',['requester']),worker=await account('admin-test-worker',['freelancer']),admin=await account('admin-test-reviewer',[]),inactive=await account('admin-test-inactive',[]);
 const role=(uid:string)=>db.doc('kyrub_admin/control_plane/admins/'+uid);
 await Promise.all([role(admin.uid).set({uid:admin.uid,role:'super_admin',status:'active'}),role(owner.uid).set({uid:owner.uid,role:'super_admin',status:'active'}),role(inactive.uid).set({uid:inactive.uid,role:'super_admin',status:'inactive'})]);
 const offerId='http-admin-'+suffix,first='http-admin-resume-'+suffix,second='http-admin-cancel-'+suffix;
 await act(owner,offerId,'publish',200,{terms:{title:'Decisão fictícia',description:'Teste administrativo isolado',requirements:'',paymentMinor:24000}});
 await act(worker,offerId,'apply');await act(owner,offerId,'select',200,{applicantUid:worker.uid});
 await act(worker,offerId,'confirm',200,{confirmed:true});
 await confirmSimulatedFreelanceFunding(offerId,'http-admin-payment-'+suffix,24000,owner.uid,worker.uid);
 await act(worker,offerId,'start',200,{confirmed:true});
 await act(worker,offerId,'report',200,{confirmed:true,kind:'service_disputed',occurrenceId:first});
 const authz=(a:Actor)=>'Bearer '+a.token;
 const reason='Fundamentação fictícia para teste';
 const decision=(occurrenceId:string,outcome:'resume'|'cancel')=>({offerId,occurrenceId,outcome,reason,confirmed:true});
 await assert.rejects(decideFreelanceReview(authz(admin),decision(first,'resume')),/second_factor_required/);
 // Test-only seam: original verifier must accept the emulator token first.
 // Synthetic TOTP claim tests policy + real database transactions, NOT actual MFA login/enrollment.
 const original=auth.verifyIdToken.bind(auth);
 const fixtures=new Set([admin.token,owner.token,inactive.token]);
 let stale=false;
 t.mock.method(auth,'verifyIdToken',async(token:string,checkRevoked?:boolean)=>{
   const decoded=await original(token,checkRevoked);
   if(!fixtures.has(token))return decoded;
   assert.equal(checkRevoked,true);
   return {...decoded,auth_time:Math.floor(Date.now()/1000)-(stale?301:0),firebase:{...decoded.firebase,sign_in_second_factor:'totp'}};
 });
 try{
   stale=true;
   await assert.rejects(listFreelanceReviews(authz(admin),undefined),/reauthentication_required/);
   stale=false;
   await assert.rejects(listFreelanceReviews(authz(inactive),undefined),/FORBIDDEN/);
   const queue=await listFreelanceReviews(authz(admin),undefined);
   assert.ok(queue.items.some(a=>a.offerId===offerId&&a.canResume===false&&a.canDecide===true));
   const self=await listFreelanceReviews(authz(owner),undefined);
   assert.ok(self.items.some(a=>a.offerId===offerId&&a.canDecide===false));
   await assert.rejects(decideFreelanceReview(authz(owner),decision(first,'cancel')),/FREELANCE_FORBIDDEN/);
   await assert.rejects(decideFreelanceReview(authz(admin),decision(first,'resume')),/FREELANCE_CONFLICT/);
   await act(owner,offerId,'respond',200,{confirmed:true,position:'agree',occurrenceId:first});
   const resumes=await Promise.all([decideFreelanceReview(authz(admin),decision(first,'resume')),decideFreelanceReview(authz(admin),decision(first,'resume'))]);
   assert.deepEqual(resumes.map(x=>x.replay).sort(),[false,true]);
   const ref=db.doc('freelanceOffersV1/'+offerId);
   assert.equal((await ref.get()).get('status'),'in_progress');
   assert.equal((await ref.collection('financialBasis').get()).size,0);
   await act(worker,offerId,'report',200,{confirmed:true,kind:'cancellation_requested',occurrenceId:second});
   const cancels=await Promise.all([decideFreelanceReview(authz(admin),decision(second,'cancel')),decideFreelanceReview(authz(admin),decision(second,'cancel'))]);
   assert.deepEqual(cancels.map(x=>x.replay).sort(),[false,true]);
   assert.equal((await ref.get()).get('status'),'cancelled');
   assert.equal((await ref.collection('applications').doc(worker.uid).get()).get('status'),'cancelled');
   const basis=await ref.collection('financialBasis').get();
   assert.equal(basis.size,1);assert.equal(basis.docs[0].get('agreedMinor'),24000);
   assert.equal(basis.docs[0].get('confirmedServiceMinor'),null);
   assert.equal(basis.docs[0].get('settlement'),'not_verified');
   assert.equal(basis.docs[0].get('sourceOccurrenceId'),second);
   const audits=await db.collection('kyrub_admin/control_plane/audit_logs').where('targetId','==',offerId).get();
   assert.equal(audits.size,2);
   assert.deepEqual(audits.docs.map(d=>d.get('outcome')).sort(),['cancel','resume']);
   assert.ok(audits.docs.every(d=>d.get('actorId')===admin.uid&&d.get('actorRole')==='super_admin'));
   await assert.rejects(decideFreelanceReview(authz(admin),{...decision(second,'cancel'),reason:'Outra fundamentação fictícia'}),/FREELANCE_CONFLICT/);
   const earnings=await call(worker,'?view=earnings',200);
   assert.equal(earnings.reviewCount,1);assert.equal(earnings.receivedMinor,null);
   assert.ok(!(await listFreelanceReviews(authz(admin),undefined)).items.some(a=>a.offerId===offerId));
   console.log('PASS admin transaction with synthetic TOTP claim: role, recent session, resume, cancel, replay, audit; genuine TOTP login NOT tested');
 }finally{t.mock.restoreAll();}
 await assert.rejects(listFreelanceReviews(authz(admin),undefined),/second_factor_required/);
});

test('personal Pix authenticated HTTP: own masked destination, eligibility, revision, revocation and disabled runtime',async()=>{
 const worker=await account('pix-worker',['freelancer']),other=await account('pix-other',['bicycle_courier']),unapproved=await account('pix-unapproved',[]);
 const url='http://127.0.0.1:'+address.port+'/api/personal-finance/pix';
 const request=async(actor:Actor|null,status:number,body?:Record<string,unknown>,query='')=>{
  const res=await fetch(url+query,{method:body?'POST':'GET',headers:{...(actor?{authorization:'Bearer '+actor.token}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const data=await res.json();assert.equal(res.status,status,JSON.stringify(data));assert.match(res.headers.get('cache-control')??'',/no-store/);return data;
 };
 const declaration={action:'declare',expectedRevision:0,confirmed:true,destination:{keyType:'email',key:'fixture@example.invalid'}};
 await request(null,401);
 assert.equal((await request(unapproved,403,declaration)).code,'IDENTITY_VERIFICATION_REQUIRED');
 assert.equal((await request(worker,200)).status,'not_configured');
 await request(worker,400,{...declaration,userId:other.uid});
 const saved=await request(worker,200,declaration);
 assert.equal(saved.status,'declared');assert.equal(saved.ownershipVerified,false);assert.equal(saved.revision,1);assert.equal('key' in saved,false);
 assert.equal((await request(other,200)).status,'not_configured');
 await request(other,400,undefined,'?uid='+worker.uid);
 await request(worker,409,declaration);
 assert.equal(personalPixRecentLogin(700,1000),true);
 assert.equal(personalPixRecentLogin(699,1000),false);
 assert.equal(personalPixRecentLogin(1001,1000),false);
 assert.equal(personalPixRecentLogin(undefined,1000),false);
 await db.doc('identity_verifications/'+worker.uid).update({status:'rejected'});
 const revoked=await request(worker,200,{action:'revoke',expectedRevision:1,confirmed:true});
 assert.equal(revoked.status,'revoked');assert.equal((await db.doc('financialProfilesV1/'+worker.uid+'/receiving/externalPix').get()).get('key'),undefined);
 const flag=process.env.KYRUB_PERSONAL_FINANCE_LOCAL_HOMOLOGATION;
 try{delete process.env.KYRUB_PERSONAL_FINANCE_LOCAL_HOMOLOGATION;await request(worker,503);}
 finally{process.env.KYRUB_PERSONAL_FINANCE_LOCAL_HOMOLOGATION=flag;}
 console.log('PASS personal Pix HTTP: authenticated UID, masked declaration, eligibility, stale revision, revocation, disabled gate; real MFA and bank ownership not tested');
});

test('CID Pix import HTTP: private list, explicit confirmation, account isolation, stale origin and replacement',async(t)=>{
 const worker=await account('cid-worker',['freelancer']),other=await account('cid-other',['freelancer']),unapproved=await account('cid-unapproved',[]);
 const url='http://127.0.0.1:'+address.port+'/api/personal-finance/pix';
 const request=async(actor:Actor|null,status:number,body?:Record<string,unknown>,query='')=>{
  const res=await fetch(url+query,{method:body?'POST':'GET',headers:{...(actor?{authorization:'Bearer '+actor.token}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const data=await res.json();assert.equal(res.status,status,JSON.stringify(data));assert.match(res.headers.get('cache-control')??'',/no-store/);return data;
 };
 const tagId=randomUUID().replaceAll('-',''),ownerId='tagpk_'+'x'.repeat(43);
 const tag=db.doc('kyrub_official_tags/'+tagId);
 const pix={keyType:'email',key:'fixture-cid@example.invalid',recipientName:'Pessoa Teste',recipientCity:'BRASILIA',publicConsent:true};
 const record={distribution:'promotional',model:'adesivo',manufacturingState:'released',ownerAuthMode:'passkey',ownerId,firstOwnerId:ownerId,linkedAccountId:worker.uid,linkedAccountAt:new Date().toISOString(),enabled:true,blocked:false,presentation:{name:'Teste',occupation:'',about:'',pix}};
 await Promise.all([tag.set(record),...([worker,other,unapproved].map(a=>db.doc('users/'+a.uid).set({uid:a.uid})))]);
 try{
  const query='?view=cid_candidates';
  await request(null,401,undefined,query);
  await request(worker,400,undefined,query+'&uid='+other.uid);
  assert.deepEqual(await request(other,200,undefined,query),{candidates:[]});
  const list=await request(worker,200,undefined,query);
  assert.equal(list.candidates.length,1);
  const choice=list.candidates[0];assert.equal(choice.cidId,tagId);assert.equal(choice.maskedKey,'••••alid');assert.equal(choice.ownershipVerified,false);
  assert.ok(!JSON.stringify(list).includes(pix.key));
  const input={action:'import_cid',cidId:tagId,sourceVersion:choice.sourceVersion,expectedRevision:0,confirmed:true,replaceExisting:false};
  await request(other,403,input);
  await request(unapproved,403,input);
  await request(worker,400,{...input,confirmed:false});
  await request(worker,400,{...input,key:pix.key});
  await request(worker,400,input,query);
  const original=auth.verifyIdToken.bind(auth);
  t.mock.method(auth,'verifyIdToken',async(token:string,checkRevoked?:boolean)=>{
   const decoded=await original(token,checkRevoked);
   return token===worker.token?{...decoded,auth_time:Math.floor(Date.now()/1000)-301}:decoded;
  });
  try{assert.equal((await request(worker,403,input)).code,'REAUTHENTICATION_REQUIRED');}finally{t.mock.restoreAll();}
  await tag.update({blocked:true,enabled:false});
  assert.equal((await request(worker,403,input)).code,'PERSONAL_CID_UNAVAILABLE');
  await tag.update({blocked:false,enabled:true});
  assert.equal((await request(worker,409,input)).code,'PERSONAL_CID_CHANGED');
  const fresh=(await request(worker,200,undefined,query)).candidates[0];
  const declaration={...input,sourceVersion:fresh.sourceVersion};
  const imported=await request(worker,200,declaration);
  assert.equal(imported.revision,1);assert.equal(imported.status,'declared');assert.equal(imported.ownershipVerified,false);
  assert.ok(!JSON.stringify(imported).includes(pix.key));
  await request(worker,409,declaration);
  await request(worker,409,{...declaration,expectedRevision:1});
  const replacement=await request(worker,200,{...declaration,expectedRevision:1,replaceExisting:true});
  assert.equal(replacement.revision,2);
  await tag.update({'presentation.pix':null});
  assert.deepEqual(await request(worker,200,undefined,query),{candidates:[]});
  assert.equal((await request(worker,200)).revision,2);
  assert.equal((await db.doc('financialProfilesV1/'+worker.uid+'/receiving/externalPix').get()).get('key'),pix.key);
  console.log('PASS CID Pix HTTP: own masked list, foreign account rejected, recent session, stale source, explicit replacement, independent destination');
 }finally{await tag.delete();}
});

test('financial Control Plane queue: actual Auth emulator token, synthetic MFA, active admin only, private bounded read',async(t)=>{
 const {publishFreelanceOffer,applyToFreelanceOffer,selectFreelanceApplication,confirmFreelanceContract}=await import('../server/freelance/freelanceLifecycleService.js');
 const {recordFreelanceExternalPaymentStatement:record,requestFreelanceFinancialReview:request}=await import('../server/freelance/freelanceExternalPaymentStatementService.js');
 const {createDirectPaymentTerms}=await import('../shared/directPaymentTerms.js');
 const payer=await account('finqueue-payer',['requester']),worker=await account('finqueue-worker',['freelancer']),admin=await account('finqueue-admin',[]),inactive=await account('finqueue-inactive',[]);
 for(const [a,status] of [[admin,'active'],[inactive,'inactive'],[payer,'active']] as const)await db.doc('kyrub_admin/control_plane/admins/'+a.uid).set({uid:a.uid,role:'super_admin',status});
 const id='finqueue-'+suffix;
 await publishFreelanceOffer(payer.uid,id,{title:'Freela financeiro fictício',description:'Teste isolado',requirements:'',paymentMinor:15000,paymentTerms:createDirectPaymentTerms({method:'external_pix',timing:'advance',amountMinor:15000})});
 await applyToFreelanceOffer(worker.uid,id);await selectFreelanceApplication(payer.uid,id,worker.uid);await confirmFreelanceContract(worker.uid,id,true);
 await record(payer.uid,id,{eventId:'paid',statement:'paid',confirmed:true});
 await record(worker.uid,id,{eventId:'denied',statement:'not_received',confirmed:true});
 await request(worker.uid,id,{confirmed:true});
 const url='http://127.0.0.1:'+address.port+'/api/admin/freelance-financial-review';
 const call=async(a:Actor|null,status:number,query='',method='GET')=>{
  const r=await fetch(url+query,{method,headers:a?{authorization:'Bearer '+a.token}:{}});
  const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));assert.match(r.headers.get('cache-control')??'',/no-store/);return data;
 };
 await call(null,401);await call(admin,405,'','PUT');await call(admin,415,'','POST');
 assert.equal((await call(admin,403)).code,'second_factor_required');
 const original=auth.verifyIdToken.bind(auth),tokens=new Set([payer.token,worker.token,admin.token,inactive.token]);let stale=false;
 t.mock.method(auth,'verifyIdToken',async(token:string,checkRevoked?:boolean)=>{
  const decoded=await original(token,checkRevoked);
  if(!tokens.has(token))return decoded;
  assert.equal(checkRevoked,true);
  return {...decoded,auth_time:Math.floor(Date.now()/1000)-(stale?301:0),firebase:{...decoded.firebase,sign_in_second_factor:'totp'}};
 });
 try{
  stale=true;assert.equal((await call(admin,403)).code,'reauthentication_required');stale=false;
  await call(worker,403);await call(inactive,403);await call(admin,400,'?uid='+worker.uid);
  const mine=await call(payer,200);assert.ok(!mine.items.some(x=>x.offerId===id));
  const list=await call(admin,200),item=list.items.find(x=>x.offerId===id);
  assert.ok(item);assert.equal(item.amountMinor,15000);assert.equal(item.restrictionActive,true);assert.equal(item.bankVerified,false);
  assert.deepEqual(item.statements.map(x=>x.statement),['paid','not_received']);assert.equal(item.requestedByRole,'freelancer');
  assert.ok(!JSON.stringify(item).includes('@example.invalid'));assert.equal('events' in item,false);
  await record(worker.uid,id,{eventId:'received',statement:'received',confirmed:true});
  assert.ok(!(await call(admin,200)).items.some(x=>x.offerId===id));
  const flag=process.env.KYRUB_PERSONAL_FINANCE_LOCAL_HOMOLOGATION;
  try{delete process.env.KYRUB_PERSONAL_FINANCE_LOCAL_HOMOLOGATION;await call(admin,503);}finally{process.env.KYRUB_PERSONAL_FINANCE_LOCAL_HOMOLOGATION=flag;}
 }finally{t.mock.restoreAll();}
 console.log('PASS private financial review queue: real emulator auth, synthetic TOTP policy, active admin, no self, voluntary removal; genuine MFA not tested');
});

test('financial administrative decision: protected, audited, no bank proof, one case only, later receipt preserved',async(t)=>{
 const {publishFreelanceOffer,applyToFreelanceOffer,selectFreelanceApplication,confirmFreelanceContract}=await import('../server/freelance/freelanceLifecycleService.js');
 const {recordFreelanceExternalPaymentStatement:record,requestFreelanceFinancialReview:request}=await import('../server/freelance/freelanceExternalPaymentStatementService.js');
 const {createDirectPaymentTerms}=await import('../shared/directPaymentTerms.js');
 const payer=await account('findec-payer',['requester']),worker=await account('findec-worker',['freelancer']),admin=await account('findec-admin',[]);
 for(const a of [admin,payer])await db.doc('kyrub_admin/control_plane/admins/'+a.uid).set({uid:a.uid,role:'super_admin',status:'active'});
 const ids=['findec-first-'+suffix,'findec-second-'+suffix];
 for(const id of ids){
  await publishFreelanceOffer(payer.uid,id,{title:'Teste decisão financeira',description:'Somente emulador',requirements:'',paymentMinor:15000,paymentTerms:createDirectPaymentTerms({method:'external_pix',timing:'advance',amountMinor:15000})});
  await applyToFreelanceOffer(worker.uid,id);await selectFreelanceApplication(payer.uid,id,worker.uid);await confirmFreelanceContract(worker.uid,id,true);
 }
 for(const id of ids){
  await record(payer.uid,id,{eventId:'paid',statement:'paid',confirmed:true});await record(worker.uid,id,{eventId:'denied',statement:'not_received',confirmed:true});await request(worker.uid,id,{confirmed:true});
 }
 const id=ids[0],ref=db.doc('freelanceFinancialReviewsV1/'+id),history=db.doc('freelanceOffersV1/'+id+'/directPayment/externalStatements');
 const initial=(await history.get()).data(),requestedAt=(await ref.get()).get('requestedAt');
 const body={offerId:id,expectedRequestedAt:requestedAt,expectedEvidenceRevision:0,outcome:'inconclusive',reason:'Evidências fictícias insuficientes para conclusão bancária.',confirmed:true};
 const call=async(a:Actor,status:number,input:Record<string,unknown>)=>{
  const r=await fetch('http://127.0.0.1:'+address.port+'/api/admin/freelance-financial-review',{method:'POST',headers:{authorization:'Bearer '+a.token,'content-type':'application/json'},body:JSON.stringify(input)});
  const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;
 };
 assert.equal((await call(admin,403,body)).code,'second_factor_required');
 const original=auth.verifyIdToken.bind(auth),tokens=new Set([payer.token,worker.token,admin.token]);let stale=false;
 t.mock.method(auth,'verifyIdToken',async(token:string,checkRevoked?:boolean)=>{
  const decoded=await original(token,checkRevoked);
  if(!tokens.has(token))return decoded;
  assert.equal(checkRevoked,true);return {...decoded,auth_time:Math.floor(Date.now()/1000)-(stale?301:0),firebase:{...decoded.firebase,sign_in_second_factor:'totp'}};
 });
 try{
  stale=true;assert.equal((await call(admin,403,body)).code,'reauthentication_required');stale=false;
  await call(payer,403,body);await call(worker,403,body);
  await call(admin,400,{...body,reason:'curto'});await call(admin,400,{...body,confirmed:false});
  await call(admin,409,{...body,expectedRequestedAt:'2020-01-01T00:00:00Z'});
  const {submitFreelanceFinancialEvidence:submit}=await import('../server/freelance/freelanceFinancialEvidenceService.js');
  await submit(payer.uid,id,{evidenceId:'note-a',note:'Declaração fictícia sobre o horário do pagamento.',confirmed:true});
  await call(admin,409,body);
  const {submitFreelanceFinancialReceipt:submitReceipt}=await import('../server/freelance/freelanceFinancialReceiptService.js');
  const {getFreelanceFinancialReceipt:getReceipt,listFreelanceFinancialReviews:listReviews}=await import('../server/admin/freelanceFinancialReviewService.js');
  const {receiptFixture}=await import('./fixtures/freelance-receipt-fixture.js');
  await submitReceipt(payer.uid,id,{receiptId:'receipt-a',pngBase64:receiptFixture(),confirmed:true});
  await call(admin,409,{...body,expectedEvidenceRevision:1});
  const list=await listReviews('Bearer '+admin.token,undefined);
  const item=list.items.find(x=>x.offerId===id)!;
  assert.equal(item.evidenceRevision,2);assert.equal(item.receipts.length,1);
  assert.ok(!JSON.stringify(item).includes('pngBase64'));
  await assert.rejects(getReceipt('Bearer '+payer.token,id,'receipt-a'),/FORBIDDEN/);
  await assert.rejects(getReceipt('Bearer '+worker.token,id,'receipt-a'),/FORBIDDEN/);
  const file=await getReceipt('Bearer '+admin.token,id,'receipt-a');
  assert.equal(file.mimeType,'image/png');assert.equal(file.bankVerified,false);
  assert.ok(!Buffer.from(file.pngBase64,'base64').includes(Buffer.from('fixture metadata')));
  const current={...body,expectedEvidenceRevision:2};
  const results=await Promise.all([call(admin,200,current),call(admin,200,current)]);
  assert.deepEqual(results.map(x=>x.replay).sort(),[false,true]);assert.ok(results.every(x=>x.bankVerified===false));
  assert.equal((await ref.get()).get('status'),'resolved_administratively');
  assert.equal((await ref.get()).get('decision.reason'),body.reason);
  assert.equal((await ref.get()).get('decision.evidenceRevision'),2);
  const {listUserNotifications}=await import('../server/notifications/userNotificationService.js');
  for(const a of [payer,worker])assert.equal((await listUserNotifications({recipientUserId:a.uid})).notifications.filter(n=>n.eventType==='freelance_finance_administrative_release').length,1);
  assert.deepEqual((await history.get()).data(),initial);
  const audit=await db.collection('kyrub_admin/control_plane/audit_logs').where('targetId','==',id).get();
  assert.equal(audit.size,1);assert.equal(audit.docs[0].get('actorId'),admin.uid);assert.equal(audit.docs[0].get('bankVerified'),false);
  for(const a of [payer,worker])assert.deepEqual((await db.doc('freelanceEngagementRestrictionsV1/'+a.uid).get()).get('openOfferIds'),[ids[1]]);
  await call(admin,409,{...body,expectedEvidenceRevision:2,outcome:'payment_evidence_accepted'});
  await assert.rejects(submit(worker.uid,id,{evidenceId:'late',note:'Manifestação posterior ao encerramento.',confirmed:true}),/FREELANCE_FINANCIAL_EVIDENCE_CONFLICT/);
  await assert.rejects(getReceipt('Bearer '+admin.token,id,'receipt-a'),/FREELANCE_FINANCIAL_REVIEW_CONFLICT/);
  await record(worker.uid,id,{eventId:'received',statement:'received',confirmed:true});
  assert.equal((await history.get()).get('events').length,3);assert.equal((await ref.get()).get('status'),'resolved_administratively');
  await record(worker.uid,ids[1],{eventId:'received',statement:'received',confirmed:true});
  for(const a of [payer,worker])assert.deepEqual((await db.doc('freelanceEngagementRestrictionsV1/'+a.uid).get()).get('openOfferIds'),[]);
 }finally{t.mock.restoreAll();}
});

test('participant finance HTTP: authenticated statements, private own evidence, receipt and release',async()=>{
 const {publishFreelanceOffer,applyToFreelanceOffer,selectFreelanceApplication,confirmFreelanceContract}=await import('../server/freelance/freelanceLifecycleService.js');
 const {createDirectPaymentTerms}=await import('../shared/directPaymentTerms.js');
 const {receiptFixture}=await import('./fixtures/freelance-receipt-fixture.js');
 const payer=await account('finhttp-payer',['requester']),worker=await account('finhttp-worker',['freelancer']),other=await account('finhttp-other',[]);
 const id='finhttp-'+suffix;
 await publishFreelanceOffer(payer.uid,id,{title:'Freela financeiro HTTP',description:'Somente emulador',requirements:'',paymentMinor:15000,paymentTerms:createDirectPaymentTerms({method:'external_pix',timing:'advance',amountMinor:15000})});
 await applyToFreelanceOffer(worker.uid,id);await selectFreelanceApplication(payer.uid,id,worker.uid);await confirmFreelanceContract(worker.uid,id,true);
 const url='http://127.0.0.1:'+address.port+'/api/freelance/finance';
 const call=async(a:Actor|null,status:number,query='',body?:Record<string,unknown>)=>{
  const r=await fetch(url+query,{method:body?'POST':'GET',headers:{...(a?{authorization:'Bearer '+a.token}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));assert.match(r.headers.get('cache-control')??'',/no-store/);return data;
 };
 const q='?view=case&offerId='+id,receiptQ='?view=receipt&offerId='+id+'&receiptId=receipt-a';
 const send=(a:Actor,status:number,action:string,extra:Record<string,unknown>={})=>call(a,status,'',{offerId:id,action,confirmed:true,...extra});
 await call(null,401,q);await call(other,403,q);await call(payer,400,q+'&uid='+worker.uid);
 assert.equal((await call(payer,200,q)).financialState,'awaiting_payment');
 const movements=(a:Actor,role:string)=>call(a,200,'?view=movements&role='+role);
 const movement=(p:Awaited<ReturnType<typeof movements>>)=>p.entries.find((e:{offerId:string})=>e.offerId===id);
 assert.equal(movement(await movements(payer,'requester')).financialState,'awaiting_payment');
 assert.equal(movement(await movements(worker,'freelancer')).amountMinor,15000);
 assert.equal(movement(await movements(other,'freelancer')),undefined);
 await call(payer,400,'?view=movements&role=requester&uid='+worker.uid);
 await send(worker,403,'statement',{statement:'paid',eventId:'forged'});
 await send(payer,400,'statement',{statement:'paid',eventId:'paid',actorUid:worker.uid});
 await send(payer,200,'statement',{statement:'paid',eventId:'paid'});
 await send(worker,200,'statement',{statement:'not_received',eventId:'denied'});
 assert.equal((await call(payer,200,q)).financialState,'disputed');
 assert.equal(movement(await movements(worker,'freelancer')).financialState,'disputed');
 for(const a of [payer,worker])assert.deepEqual(await call(a,200,'?view=restrictions'),{restricted:true,openOfferIds:[id]});
 const {listUserNotifications,markUserNotificationRead}=await import('../server/notifications/userNotificationService.js');
 const {shouldDeliverUserNotificationToBrowser,buildDefaultUserCommunicationPreferences}=await import('../shared/userCommunicationPreferences.js');
 const list=(uid:string)=>listUserNotifications({recipientUserId:uid});
 const opened=(await list(payer.uid)).notifications.find(n=>n.eventType==='freelance_finance_dispute_opened')!;
 assert.ok(opened);await markUserNotificationRead({recipientUserId:payer.uid,notificationId:opened.id});
 await send(worker,200,'statement',{statement:'not_received',eventId:'denied'});
 const afterReplay=await list(payer.uid);
 assert.equal(afterReplay.notifications.filter(n=>n.eventType==='freelance_finance_dispute_opened').length,1);
 assert.ok(afterReplay.notifications.find(n=>n.id===opened.id)?.readAt);
 await send(worker,200,'request_review');
 await send(payer,200,'submit_note',{evidenceId:'note-a',note:'Manifestação privada de teste.'});
 await send(payer,400,'submit_receipt',{receiptId:'receipt-a',pngBase64:'YWJjZA=='});
 await send(payer,200,'submit_receipt',{receiptId:'receipt-a',pngBase64:receiptFixture()});
 assert.equal((await call(payer,200,q)).ownNotes.length,1);assert.equal((await call(payer,200,q)).ownReceipts.length,1);
 assert.equal((await call(worker,200,q)).ownNotes.length,0);assert.equal((await call(worker,200,q)).ownReceipts.length,0);
 await call(worker,403,receiptQ);await call(other,403,receiptQ);
 assert.equal((await call(payer,200,receiptQ)).mimeType,'image/png');
 await send(worker,200,'statement',{statement:'received',eventId:'received'});
 const resolved=await call(payer,200,q);assert.equal(resolved.reviewStatus,'resolved_voluntarily');assert.equal(resolved.bankVerified,false);
 for(const [actor,role] of [[payer,'requester'],[worker,'freelancer']] as const){const p=await movements(actor,role);assert.equal(p.bankVerifiedMinor,null);assert.equal(movement(p).financialState,'bilaterally_reported_received');assert.equal(movement(p).bankVerified,false);assert.ok(!JSON.stringify(p).includes('pngBase64'));}
 await call(payer,403,receiptQ);
 assert.deepEqual(await call(worker,200,'?view=restrictions'),{restricted:false,openOfferIds:[]});
 for(const a of [payer,worker]){
  const inbox=await list(a.uid);
  for(const kind of ['dispute_opened','review_requested','voluntary_release'])assert.equal(inbox.notifications.filter(n=>n.eventType==='freelance_finance_'+kind).length,1);
  const p=buildDefaultUserCommunicationPreferences(a.uid);p.browser.enabled=true;
  for(const n of inbox.notifications){assert.equal(n.recipientUserId,a.uid);assert.equal(n.target.kind,'none');assert.equal(shouldDeliverUserNotificationToBrowser(p,n),false);}
  assert.ok(!JSON.stringify(inbox).includes('Manifestação privada de teste.'));
  assert.ok(!JSON.stringify(inbox).includes('pngBase64'));
 }
 assert.equal((await list(other.uid)).notifications.length,0);
});

test('contract Pix disclosure: explicit sharing, due, payer-only, recent session and pinned revision',async(t)=>{
 const {publishFreelanceOffer,applyToFreelanceOffer,selectFreelanceApplication,confirmFreelanceContract}=await import('../server/freelance/freelanceLifecycleService.js');
 const {createDirectPaymentTerms}=await import('../shared/directPaymentTerms.js');
 const {changePersonalPixDestination}=await import('../server/payments/personalPixDestinationService.js');
 const payer=await account('share-payer',['requester']),worker=await account('share-worker',['freelancer']),other=await account('share-other',['requester']);
 const ids=['share-advance-'+suffix,'share-completion-'+suffix,'share-revoked-'+suffix];
 const key='share-'+suffix+'@example.invalid';
 await changePersonalPixDestination(worker.uid,{action:'declare',expectedRevision:0,confirmed:true,destination:{keyType:'email',key}});
 for(const [i,id] of ids.entries()){
  await publishFreelanceOffer(payer.uid,id,{title:'Pix fictício',description:'Somente emulador',requirements:'',paymentMinor:15000,paymentTerms:createDirectPaymentTerms({method:'external_pix',timing:i===1?'on_completion':'advance',amountMinor:15000})});
  await applyToFreelanceOffer(worker.uid,id);await selectFreelanceApplication(payer.uid,id,worker.uid);await confirmFreelanceContract(worker.uid,id,true);
 }
 const url='http://127.0.0.1:'+address.port+'/api/freelance/finance';
 const call=async(a:Actor,status:number,id:string,action?:string,extra:Record<string,unknown>={})=>{
  const r=await fetch(url+(action?'':'?view=pix_sharing&offerId='+id),{method:action?'POST':'GET',headers:{authorization:'Bearer '+a.token,...(action?{'content-type':'application/json'}:{})},...(action?{body:JSON.stringify({action,offerId:id,expectedRevision:1,confirmed:true,...extra})}:{})});
  const b=await r.json();assert.equal(r.status,status,JSON.stringify(b));assert.match(r.headers.get('cache-control')??'',/no-store/);return b;
 };
 const id=ids[0];
 await call(payer,409,id);await call(worker,200,id,'bind_pix');
 assert.equal((await call(payer,200,id)).sharingAuthorized,false);
 await call(payer,409,id,'reveal_pix');await call(other,403,id,'reveal_pix');await call(payer,403,id,'authorize_pix_share');
 await call(worker,400,id,'authorize_pix_share',{confirmed:false});
 await call(worker,200,id,'authorize_pix_share');await call(worker,200,id,'authorize_pix_share');
 const mask=await call(payer,200,id);assert.equal(mask.sharingAuthorized,true);assert.equal(mask.due,true);assert.ok(!JSON.stringify(mask).includes(key));
 await call(worker,403,id,'reveal_pix');await call(payer,409,id,'reveal_pix',{expectedRevision:2});
 const original=auth.verifyIdToken.bind(auth);
 t.mock.method(auth,'verifyIdToken',async(token:string,revoked?:boolean)=>{const decoded=await original(token,revoked);return {...decoded,auth_time:Math.floor(Date.now()/1000)-301};});
 try{assert.equal((await call(payer,403,id,'reveal_pix')).code,'REAUTHENTICATION_REQUIRED');}finally{t.mock.restoreAll();}
 const revealed=await call(payer,200,id,'reveal_pix');assert.equal(revealed.key,key);assert.equal(revealed.amountMinor,15000);assert.equal(revealed.bankVerified,false);
 const direct=db.doc('freelanceOffersV1/'+id).collection('directPayment');
 const audit=(await direct.doc('pixDisclosure').get()).data();assert.equal(audit?.requesterUid,payer.uid);assert.ok(!JSON.stringify(audit).includes(key));
 await call(payer,200,id,'reveal_pix');assert.deepEqual((await direct.doc('pixDisclosure').get()).data(),audit);
 const consent={expectedSequence:0};
 await call(payer,403,id,'revoke_pix_share',consent);await call(other,403,id,'revoke_pix_share',consent);
 await call(worker,200,id,'revoke_pix_share',consent);await call(worker,200,id,'revoke_pix_share',consent);
 const revoked=await call(payer,200,id);assert.equal(revoked.sharingAuthorized,false);assert.equal(revoked.sharingRevoked,true);assert.equal(revoked.sharingSequence,1);
 await call(payer,409,id,'reveal_pix');await call(worker,409,id,'authorize_pix_share');
 // Same personal key remains valid on another contract.
 await call(worker,200,ids[2],'bind_pix');await call(worker,200,ids[2],'authorize_pix_share');
 assert.equal((await call(payer,200,ids[2],'reveal_pix')).key,key);
 await call(worker,409,id,'restore_pix_share',{expectedSequence:0});
 await call(worker,200,id,'restore_pix_share',{expectedSequence:1});await call(worker,200,id,'restore_pix_share',{expectedSequence:1});
 await call(worker,409,id,'revoke_pix_share',{expectedSequence:0});
 const restored=await call(payer,200,id);assert.equal(restored.sharingAuthorized,true);assert.equal(restored.sharingSequence,2);
 assert.equal((await call(payer,200,id,'reveal_pix')).key,key);
 assert.deepEqual((await direct.doc('pixDisclosure').get()).data(),audit);
 assert.equal((await direct.doc('pixSharingEvent-1-1').get()).get('state'),'revoked');
 assert.equal((await direct.doc('pixSharingEvent-1-2').get()).get('state'),'active');
 assert.ok(!JSON.stringify((await direct.doc('pixSharingControl-1').get()).data()).includes(key));

 const {recordFreelanceExternalPaymentStatement:record}=await import('../server/freelance/freelanceExternalPaymentStatementService.js');
 await record(payer.uid,id,{eventId:'paid',statement:'paid',confirmed:true});
 await call(worker,200,id,'revoke_pix_share',{expectedSequence:2});
 await call(worker,409,id,'restore_pix_share',{expectedSequence:3});
 await call(payer,409,id,'reveal_pix');
 for(const otherId of ids.slice(1)){await call(worker,200,otherId,'bind_pix');await call(worker,200,otherId,'authorize_pix_share');}
 assert.equal((await call(payer,200,ids[1])).due,false);await call(payer,409,ids[1],'reveal_pix');
 await changePersonalPixDestination(worker.uid,{action:'declare',expectedRevision:1,confirmed:true,destination:{keyType:'email',key:'new-'+key}});
 await call(payer,409,ids[2],'reveal_pix');
 await changePersonalPixDestination(worker.uid,{action:'revoke',expectedRevision:2,confirmed:true});
 await call(worker,200,ids[2],'revoke_pix_share',{expectedSequence:0});
 await call(worker,200,ids[2],'revoke_pix_share',{expectedSequence:0});
 assert.equal((await db.doc('freelanceOffersV1/'+ids[2]+'/directPayment/pixSharingControl-1').get()).get('state'),'revoked');
 await call(payer,409,ids[2],'reveal_pix');
 assert.equal((await db.doc('freelanceOffersV1/'+ids[2]+'/directPayment/pixDisclosure').get()).get('destinationRevision'),1);
});

test('direct publication HTTP: canonical terms, explicit acceptance, immutable obligation and completion payment execution',async()=>{
 const {createDirectPaymentTerms}=await import('../shared/directPaymentTerms.js');
 const payer=await account('terms-payer',['requester']),worker=await account('terms-worker',['freelancer']);
 const id='http-direct-terms-'+suffix,base={title:'Freela Pix fictício',description:'Somente emulador',requirements:'',paymentMinor:15000};
 const terms=createDirectPaymentTerms({method:'external_pix',amountMinor:15000});
 const advance=createDirectPaymentTerms({method:'external_pix',timing:'advance',amountMinor:15000});
 const mp=createDirectPaymentTerms({method:'mercado_pago',amountMinor:15000});
 await act(payer,id,'publish',409,{terms:{...base,paymentTerms:mp}});
 await act(payer,id,'publish',400,{terms:{...base,paymentTerms:{...terms,platformCommissionMinor:10}}});
 const workTerms={mode:'fixed',location:'remote',estimatedMinutes:360};
 await act(payer,id,'publish',409,{terms:{...base,paymentTerms:terms,workTerms:{mode:'hourly',location:'remote',estimatedMinutes:360,hourlyRateMinor:2500}}});
 await act(payer,id,'publish',200,{terms:{...base,paymentTerms:terms,workTerms}});
 await act(payer,id,'publish',409,{terms:{...base,paymentTerms:terms,workTerms:{...workTerms,estimatedMinutes:180}}});
 await act(payer,id,'publish',409,{terms:{...base,paymentTerms:advance,workTerms}});
 const visible=(await call(worker,'?view=detail&offerId='+id,200)).item;
 assert.deepEqual(visible.paymentTerms,terms);assert.deepEqual(visible.workTerms,workTerms);
 await act(worker,id,'apply',409,{expectedPaymentTerms:terms});
 await act(worker,id,'apply',409,{expectedPaymentTerms:terms,expectedWorkTerms:{...workTerms,estimatedMinutes:180}});
 await act(worker,id,'apply',409);await act(worker,id,'apply',409,{expectedPaymentTerms:advance});
 await act(worker,id,'apply',200,{expectedPaymentTerms:terms,expectedWorkTerms:workTerms});
 await act(payer,id,'select',200,{applicantUid:worker.uid});
 await act(worker,id,'confirm',409,{confirmed:true,expectedPaymentTerms:terms});
 await act(worker,id,'confirm',409,{confirmed:true,expectedPaymentTerms:advance,expectedWorkTerms:workTerms});
 await act(worker,id,'confirm',409,{confirmed:true});
 await act(worker,id,'confirm',200,{confirmed:true,expectedPaymentTerms:terms,expectedWorkTerms:workTerms});
 const ref=db.doc('freelanceOffersV1/'+id);
 assert.deepEqual((await ref.collection('applications').doc(worker.uid).get()).get('workTerms'),workTerms);
 assert.deepEqual((await ref.collection('directPayment').doc('obligation').get()).get('terms'),terms);
 assert.deepEqual((await ref.collection('applications').doc(worker.uid).get()).get('paymentTerms'),terms);
 assert.equal((await act(worker,id,'start',409,{confirmed:true})).code,'FREELANCE_PIX_DESTINATION_REQUIRED');
 const {changePersonalPixDestination}=await import('../server/payments/personalPixDestinationService.js');
 await changePersonalPixDestination(worker.uid,{action:'declare',expectedRevision:0,confirmed:true,destination:{keyType:'email',key:'execution-'+suffix+'@example.invalid'}});
 const url='http://127.0.0.1:'+address.port+'/api/freelance/finance';
 const finance=async(a:Actor,status:number,offerId:string,action?:string,extra:Record<string,unknown>={})=>{
  const r=await fetch(url+(action?'':'?view=case&offerId='+offerId),{method:action?'POST':'GET',headers:{authorization:'Bearer '+a.token,...(action?{'content-type':'application/json'}:{})},...(action?{body:JSON.stringify({action,offerId,confirmed:true,...extra})}:{})});
  const b=await r.json();assert.equal(r.status,status,JSON.stringify(b));return b;
 };
 await finance(worker,200,id,'bind_pix',{expectedRevision:1});
 assert.equal((await act(worker,id,'start',409,{confirmed:true})).code,'FREELANCE_PIX_SHARING_REQUIRED');
 await finance(worker,200,id,'authorize_pix_share',{expectedRevision:1});
 await finance(worker,200,id,'revoke_pix_share',{expectedRevision:1,expectedSequence:0});
 assert.equal((await act(worker,id,'start',409,{confirmed:true})).code,'FREELANCE_PIX_SHARING_REQUIRED');
 await finance(worker,200,id,'restore_pix_share',{expectedRevision:1,expectedSequence:1});
 assert.equal((await finance(payer,200,id)).financialState,'not_due');
 await finance(payer,409,id,'statement',{eventId:'early-paid',statement:'paid'});
 await finance(payer,409,id,'reveal_pix',{expectedRevision:1});
 await act(payer,id,'start',403,{confirmed:true});
 await act(worker,id,'start',200,{confirmed:true});await act(worker,id,'start',200,{confirmed:true});
 await act(worker,id,'request_completion',200,{confirmed:true});await act(payer,id,'confirm_completion',200,{confirmed:true});
 assert.equal((await finance(payer,200,id)).financialState,'awaiting_payment');
 assert.equal((await finance(payer,200,id,'reveal_pix',{expectedRevision:1})).bankVerified,false);
 await finance(payer,200,id,'statement',{eventId:'paid',statement:'paid'});
 await finance(worker,200,id,'statement',{eventId:'received',statement:'received'});
 const completed=await finance(worker,200,id);assert.equal(completed.financialState,'bilaterally_reported_received');assert.equal(completed.bankVerified,false);
 assert.equal((await ref.collection('financialBasis').doc('remuneration').get()).get('confirmedServiceMinor'),15000);
 const advanceId='http-advance-execution-'+suffix;
 await act(payer,advanceId,'publish',200,{terms:{...base,paymentTerms:advance}});
 await act(worker,advanceId,'apply',200,{expectedPaymentTerms:advance});
 await act(payer,advanceId,'select',200,{applicantUid:worker.uid});
 await act(worker,advanceId,'confirm',200,{confirmed:true,expectedPaymentTerms:advance});
 await finance(worker,200,advanceId,'bind_pix',{expectedRevision:1});await finance(worker,200,advanceId,'authorize_pix_share',{expectedRevision:1});
 await finance(worker,200,advanceId,'revoke_pix_share',{expectedRevision:1,expectedSequence:0});
 assert.equal((await act(worker,advanceId,'start',409,{confirmed:true})).code,'FREELANCE_ADVANCE_RECEIPT_REQUIRED');
 await finance(payer,200,advanceId,'statement',{eventId:'paid',statement:'paid'});
 assert.equal((await act(worker,advanceId,'start',409,{confirmed:true})).code,'FREELANCE_ADVANCE_RECEIPT_REQUIRED');
 await finance(worker,200,advanceId,'statement',{eventId:'denied',statement:'not_received'});
 assert.equal((await act(worker,advanceId,'start',409,{confirmed:true})).code,'FREELANCE_ADVANCE_RECEIPT_REQUIRED');
 await finance(worker,200,advanceId,'statement',{eventId:'received',statement:'received'});
 await changePersonalPixDestination(worker.uid,{action:'revoke',expectedRevision:1,confirmed:true});
 await act(worker,advanceId,'start',200,{confirmed:true});
 await act(worker,advanceId,'request_completion',200,{confirmed:true});await act(payer,advanceId,'confirm_completion',200,{confirmed:true});
 assert.equal((await db.doc('freelanceOffersV1/'+advanceId).get()).get('status'),'completed');
});


test('contract Pix replacement requires both participants, preserves prior disclosure and requires new consent',async()=>{
 const {createDirectPaymentTerms}=await import('../shared/directPaymentTerms.js');
 const {changePersonalPixDestination}=await import('../server/payments/personalPixDestinationService.js');
 const payer=await account('rebind-payer',['requester']),worker=await account('rebind-worker',['freelancer']),other=await account('rebind-other',['requester']);
 const id='http-pix-rebind-'+suffix,terms=createDirectPaymentTerms({method:'external_pix',timing:'advance',amountMinor:15000});
 const oldKey='old-rebind-'+suffix+'@example.invalid',newKey='new-rebind-'+suffix+'@example.invalid';
 await act(payer,id,'publish',200,{terms:{title:'Troca Pix fictícia',description:'Somente emulador',requirements:'',paymentMinor:15000,paymentTerms:terms}});
 await act(worker,id,'apply',200,{expectedPaymentTerms:terms});
 await act(payer,id,'select',200,{applicantUid:worker.uid});
 await act(worker,id,'confirm',200,{confirmed:true,expectedPaymentTerms:terms});
 const url='http://127.0.0.1:'+address.port+'/api/freelance/finance';
 const finance=async(a:Actor,status:number,action?:string,extra:Record<string,unknown>={})=>{
  const r=await fetch(url+(action?'':'?view=pix_rebind&offerId='+id),{method:action?'POST':'GET',headers:{authorization:'Bearer '+a.token,...(action?{'content-type':'application/json'}:{})},...(action?{body:JSON.stringify({action,offerId:id,confirmed:true,...extra})}:{})});
  const b=await r.json();assert.equal(r.status,status,JSON.stringify(b));return b;
 };
 await changePersonalPixDestination(worker.uid,{action:'declare',expectedRevision:0,confirmed:true,destination:{keyType:'email',key:oldKey}});
 await finance(worker,200,'bind_pix',{expectedRevision:1});
 await finance(worker,200,'authorize_pix_share',{expectedRevision:1});
 assert.equal((await finance(payer,200,'reveal_pix',{expectedRevision:1})).key,oldKey);
 await changePersonalPixDestination(worker.uid,{action:'declare',expectedRevision:1,confirmed:true,destination:{keyType:'email',key:newKey}});
 const pair={oldRevision:1,newRevision:2};
 assert.equal((await finance(payer,200)).replacementRequired,true);
 assert.equal((await finance(payer,200)).pending,false);
 await finance(other,403);
 await finance(payer,409,'reveal_pix',{expectedRevision:1});
 await finance(payer,409,'accept_pix_rebind',{...pair,paymentNotSent:true});
 await finance(payer,403,'propose_pix_rebind',pair);
 await finance(worker,200,'propose_pix_rebind',pair);
 await finance(worker,200,'propose_pix_rebind',pair);
 assert.equal((await finance(payer,200)).pending,true);
 const {listUserNotifications,markUserNotificationRead}=await import('../server/notifications/userNotificationService.js');
 const list=(uid:string)=>listUserNotifications({recipientUserId:uid});
 const notice=(await list(payer.uid)).notifications.filter(n=>n.eventType==='freelance_finance_pix_rebind_proposed');
 assert.equal(notice.length,1);assert.equal(notice[0].target.kind,'none');
 await markUserNotificationRead({recipientUserId:payer.uid,notificationId:notice[0].id});
 await finance(worker,200,'propose_pix_rebind',pair);
 assert.ok((await list(payer.uid)).notifications.find(n=>n.id===notice[0].id)?.readAt);
 await finance(worker,403,'accept_pix_rebind',{...pair,paymentNotSent:true});
 await finance(payer,400,'accept_pix_rebind',{...pair,paymentNotSent:false});
 await finance(payer,200,'accept_pix_rebind',{...pair,paymentNotSent:true});
 await finance(payer,200,'accept_pix_rebind',{...pair,paymentNotSent:true});
 const direct=db.doc('freelanceOffersV1/'+id).collection('directPayment');
 const accepted=(await list(worker.uid)).notifications.filter(n=>n.eventType==='freelance_finance_pix_rebind_accepted');
 assert.equal(accepted.length,1);assert.equal(accepted[0].target.kind,'none');
 assert.equal((await list(other.uid)).notifications.length,0);
 for(const a of [payer,worker]){const inbox=await list(a.uid);assert.ok(!JSON.stringify(inbox).includes(oldKey));assert.ok(!JSON.stringify(inbox).includes(newKey));}
 const audit=(await direct.doc('pixRebind-2').get()).data()!;
 assert.equal(audit.previousBinding.destinationRevision,1);assert.equal(audit.previousDisclosure.destinationRevision,1);
 assert.equal(audit.previousSharing.destinationRevision,1);assert.equal(audit.bankVerified,false);
 assert.ok(!JSON.stringify(audit).includes(oldKey));assert.ok(!JSON.stringify(audit).includes(newKey));
 assert.equal((await direct.doc('pixSharing').get()).exists,false);
 assert.equal((await direct.doc('pixDisclosure').get()).exists,false);
 assert.equal((await finance(payer,200)).replacementRequired,false);
 await finance(payer,409,'reveal_pix',{expectedRevision:2});
 await finance(worker,200,'authorize_pix_share',{expectedRevision:2});
 assert.equal((await finance(payer,200,'reveal_pix',{expectedRevision:2})).key,newKey);
 assert.equal((await direct.doc('obligation').get()).get('terms.amountMinor'),15000);
 await finance(payer,200,'statement',{statement:'paid',eventId:'paid'});
 await changePersonalPixDestination(worker.uid,{action:'declare',expectedRevision:2,confirmed:true,destination:{keyType:'email',key:'third-'+newKey}});
 await finance(worker,409,'propose_pix_rebind',{oldRevision:2,newRevision:3});
 await finance(payer,409,'accept_pix_rebind',{oldRevision:2,newRevision:3,paymentNotSent:true});
 assert.equal((await direct.doc('receivingDestination').get()).get('destinationRevision'),2);
 await finance(worker,200,'statement',{statement:'received',eventId:'received'});
 await act(worker,id,'start',200,{confirmed:true});
});


test('operational cancellation keeps advance dispute reachable, blocks new Pix disclosure and never creates a payable balance',async t=>{
 const {createDirectPaymentTerms}=await import('../shared/directPaymentTerms.js');
 const {changePersonalPixDestination}=await import('../server/payments/personalPixDestinationService.js');
 const payer=await account('cancel-pix-payer',['requester']),worker=await account('cancel-pix-worker',['freelancer']),admin=await account('cancel-pix-admin',[]),other=await account('cancel-pix-other',['requester']);
 await db.doc('kyrub_admin/control_plane/admins/'+admin.uid).set({uid:admin.uid,role:'super_admin',status:'active'});
 const id='cancel-pix-'+suffix,completionId='cancel-completion-'+suffix,staleId='cancel-stale-'+suffix;
 for(const [offerId,timing] of [[id,'advance'],[completionId,'on_completion'],[staleId,'advance']] as const){
  const terms=createDirectPaymentTerms({method:'external_pix',timing,amountMinor:15000});
  await act(payer,offerId,'publish',200,{terms:{title:'Cancelamento fictício',description:'Somente emulador',requirements:'',paymentMinor:15000,paymentTerms:terms}});
  await act(worker,offerId,'apply',200,{expectedPaymentTerms:terms});await act(payer,offerId,'select',200,{applicantUid:worker.uid});
  await act(worker,offerId,'confirm',200,{confirmed:true,expectedPaymentTerms:terms});
 }
 const url='http://127.0.0.1:'+address.port+'/api/freelance/finance';
 const finance=async(a:Actor,status:number,offerId:string,action?:string,extra:Record<string,unknown>={},view='case')=>{
  const r=await fetch(url+(action?'':'?view='+view+'&offerId='+offerId),{method:action?'POST':'GET',headers:{authorization:'Bearer '+a.token,...(action?{'content-type':'application/json'}:{})},...(action?{body:JSON.stringify({action,offerId,confirmed:true,...extra})}:{})});
  const b=await r.json();assert.equal(r.status,status,JSON.stringify(b));return b;
 };
 await changePersonalPixDestination(worker.uid,{action:'declare',expectedRevision:0,confirmed:true,destination:{keyType:'email',key:'cancel-'+suffix+'@example.invalid'}});
 await finance(worker,200,id,'bind_pix',{expectedRevision:1});await finance(worker,200,id,'authorize_pix_share',{expectedRevision:1});
 await finance(payer,200,id,'statement',{eventId:'paid',statement:'paid'});
 await finance(worker,200,id,'statement',{eventId:'denied',statement:'not_received'});
 const first='cancel-advance-occurrence',second='cancel-completion-occurrence',third='cancel-stale-occurrence';
 await act(worker,id,'report',200,{confirmed:true,kind:'cancellation_requested',occurrenceId:first});
 await act(worker,completionId,'report',200,{confirmed:true,kind:'cancellation_requested',occurrenceId:second});
 await act(worker,staleId,'report',200,{confirmed:true,kind:'cancellation_requested',occurrenceId:third});
 assert.equal((await finance(payer,200,id)).operationalStatus,'under_review');
 assert.equal((await finance(worker,200,id)).restrictionActive,true);
 await finance(other,403,id);await finance(payer,409,id,'reveal_pix',{expectedRevision:1});
 await finance(worker,200,id,'request_review');
 assert.equal((await finance(worker,200,id)).reviewStatus,'pending');
 assert.equal((await finance(payer,200,completionId)).due,false);
 await finance(payer,409,completionId,'statement',{eventId:'not-due',statement:'paid'});
 const original=auth.verifyIdToken.bind(auth);
 t.mock.method(auth,'verifyIdToken',async(token:string,checkRevoked?:boolean)=>{
  const d=await original(token,checkRevoked);return token===admin.token?{...d,auth_time:Math.floor(Date.now()/1000),firebase:{...d.firebase,sign_in_second_factor:'totp'}}:d;
 });
 try{
  for(const [offerId,occurrenceId] of [[id,first],[completionId,second],[staleId,third]]){
   await decideFreelanceReview('Bearer '+admin.token,{offerId,occurrenceId,outcome:'cancel',reason:'Cancelamento fictício fundamentado',confirmed:true});
   const ref=db.doc('freelanceOffersV1/'+offerId);
   assert.equal((await ref.get()).get('status'),'cancelled');
   const basis=(await ref.collection('financialBasis').doc('remuneration').get()).data()!;
   assert.equal(basis.confirmedServiceMinor,null);assert.equal(basis.settlement,'not_verified');
  }
 }finally{t.mock.restoreAll();}
 const accounting=(a:Actor,status:number,offerId:string)=>finance(a,status,offerId,undefined,{},'cancellation_accounting');
 const propose=(a:Actor,status:number,offerId:string,proposalId:string,recognizedServiceMinor:number,reportedReceivedMinor:number)=>finance(a,status,offerId,'propose_cancellation_accounting',{proposalId,recognizedServiceMinor,reportedReceivedMinor});
 const accept=(a:Actor,status:number,offerId:string,proposalId:string)=>finance(a,status,offerId,'accept_cancellation_accounting',{proposalId});
 await accounting(other,403,id);
 const blocked=await accounting(payer,200,id);assert.equal(blocked.eligible,false);assert.equal(blocked.proposal,null);
 await propose(payer,409,id,'blocked-proposal',5000,15000);
 const cancelled=await finance(payer,200,id);assert.equal(cancelled.operationalStatus,'cancelled');assert.equal(cancelled.financialState,'disputed');assert.equal(cancelled.restrictionActive,true);
 assert.equal(cancelled.bankVerified,false);assert.equal(cancelled.amountMinor,15000);
 await finance(payer,409,id,'reveal_pix',{expectedRevision:1});
 await finance(worker,200,id,'statement',{eventId:'received',statement:'received'});
 const resolved=await finance(payer,200,id);assert.equal(resolved.reviewStatus,'resolved_voluntarily');assert.equal(resolved.restrictionActive,false);assert.equal(resolved.bankVerified,false);
 assert.equal((await db.doc('freelanceOffersV1/'+id).get()).get('status'),'cancelled');
 const unpaid=await finance(payer,200,completionId);assert.equal(unpaid.due,false);assert.equal(unpaid.operationalStatus,'cancelled');
 await finance(payer,409,completionId,'statement',{eventId:'not-due',statement:'paid'});
 // Paid advance: a proposed partial remuneration is not an automatic refund.
 await propose(payer,409,id,'invalid-amount',15001,15000);
 await propose(payer,409,id,'wrong-receipt',5000,0);
 await propose(payer,200,id,'refund-proposal',5000,15000);
 const {listUserNotifications,markUserNotificationRead}=await import('../server/notifications/userNotificationService.js');
 const inbox=(uid:string)=>listUserNotifications({recipientUserId:uid});
 const notices=(await inbox(worker.uid)).notifications.filter(n=>n.eventType==='freelance_finance_cancellation_accounting_proposed');
 assert.equal(notices.length,1);assert.equal(notices[0].target.kind,'none');
 await markUserNotificationRead({recipientUserId:worker.uid,notificationId:notices[0].id});
 await propose(payer,200,id,'refund-proposal',5000,15000);
 assert.ok((await inbox(worker.uid)).notifications.find(n=>n.id===notices[0].id)?.readAt);
 await accept(payer,409,id,'refund-proposal');
 await accept(other,403,id,'refund-proposal');
 const accepted=await Promise.all([accept(worker,200,id,'refund-proposal'),accept(worker,200,id,'refund-proposal')]);assert.ok(accepted.every(a=>a.confirmed));
 const refund=await accounting(payer,200,id);
 assert.equal(refund.proposal.status,'accepted');assert.equal(refund.proposal.amounts.proposedRefundMinor,10000);
 assert.equal(refund.proposal.amounts.proposedAdditionalMinor,0);assert.equal(refund.proposal.amounts.bankVerified,false);
 assert.equal(refund.settlement,'not_verified');
 const acceptedNotices=(await inbox(payer.uid)).notifications.filter(n=>n.eventType==='freelance_finance_cancellation_accounting_accepted');assert.equal(acceptedNotices.length,1);assert.equal(acceptedNotices[0].target.kind,'none');
 assert.ok(!JSON.stringify(acceptedNotices).includes('10000'));assert.ok(!JSON.stringify(acceptedNotices).includes('refund-proposal'));
 assert.equal((await inbox(other.uid)).notifications.length,0);
 await propose(worker,409,id,'replace-accepted',0,15000);
 assert.equal((await db.doc('freelanceOffersV1/'+id+'/financialBasis/remuneration').get()).get('confirmedServiceMinor'),null);
 // Payment on completion: zero must be explicitly agreed, not inferred.
 assert.equal((await accounting(payer,200,completionId)).proposal,null);
 await propose(worker,200,completionId,'first-proposal',6000,0);
 await finance(payer,200,completionId,'close_cancellation_accounting',{proposalId:'first-proposal'});
 await accept(worker,409,completionId,'first-proposal');
 assert.equal((await inbox(worker.uid)).notifications.filter(n=>n.eventType==='freelance_finance_cancellation_accounting_closed').length,1);
 const declined=await accounting(worker,200,completionId);
 assert.equal(declined.proposal.closure,'declined');assert.equal(declined.restrictionActive,false);
 const restriction=async(a:Actor)=>{const r=await fetch('http://127.0.0.1:'+address.port+'/api/freelance/finance?view=restrictions',{headers:{authorization:'Bearer '+a.token}});const v=await r.json();assert.equal(r.status,200,JSON.stringify(v));return v;};
 const df={snapshot:declined.snapshot};
 await finance(other,403,completionId,'dispute_fixed_cancellation',df);
 await finance(worker,409,completionId,'dispute_fixed_cancellation',{snapshot:'0'.repeat(64)});
 await finance(worker,200,completionId,'dispute_fixed_cancellation',df);
 await finance(worker,200,completionId,'dispute_fixed_cancellation',df);
 for(const actor of [payer,worker])assert.deepEqual(await restriction(actor),{restricted:true,openOfferIds:[completionId]});
 await finance(payer,200,completionId,'request_fixed_cancellation_review',df);
 await finance(payer,200,completionId,'request_fixed_cancellation_review',df);
 assert.equal((await accounting(worker,200,completionId)).dispute.status,'review_requested');
 assert.equal((await db.doc('freelanceFixedCancellationReviewsV1/'+completionId).get()).get('status'),'pending');
 // Another cause on the same offer must survive the cancellation agreement.
 for(const actor of [payer,worker])await db.doc('freelanceEngagementRestrictionsV1/'+actor.uid).update({openExcessOfferIds:[completionId]});
 await propose(payer,200,completionId,'second-proposal',4000,0);
 await accept(worker,200,completionId,'second-proposal');
 await accept(worker,200,completionId,'second-proposal');
 assert.equal((await db.doc('freelanceFixedCancellationReviewsV1/'+completionId).get()).get('status'),'resolved_voluntarily');
 for(const actor of [payer,worker]){
  assert.deepEqual(await restriction(actor),{restricted:true,openOfferIds:[completionId]});
  const root=db.doc('freelanceEngagementRestrictionsV1/'+actor.uid),r=(await root.get()).data()!;
  assert.equal(r.openCancellationOfferIds,undefined);assert.deepEqual(r.openExcessOfferIds,[completionId]);
  await root.set({schemaVersion:1,uid:actor.uid,openOfferIds:[]});
 }
 const additional=await accounting(worker,200,completionId);
 assert.equal(additional.dispute.status,'resolved_voluntarily');assert.equal(additional.restrictionActive,false);
 assert.equal(additional.proposal.amounts.proposedAdditionalMinor,4000);assert.equal(additional.proposal.amounts.proposedRefundMinor,0);
 assert.equal((await finance(payer,200,completionId)).due,false);
 // Historical declarations can invalidate a proposal without erasing it.
 await propose(worker,200,staleId,'stale-proposal',3000,0);
 await finance(payer,200,staleId,'statement',{eventId:'late-paid',statement:'paid'});
 await accept(payer,409,staleId,'stale-proposal');
 const stale=await accounting(worker,200,staleId);assert.equal(stale.proposal.status,'stale');assert.equal(stale.proposal.amounts,null);assert.equal(stale.eligible,false);
 assert.equal((await db.doc('freelanceOffersV1/'+staleId+'/directPayment/cancellationAccounting-stale-proposal').get()).get('status'),'pending');
});

test('counterproposal HTTP: private negotiation, exact selection, release and final obligation',async()=>{
 const {createDirectPaymentTerms}=await import('../shared/directPaymentTerms.js');
 const owner=await account('counter-owner',['requester']),worker=await account('counter-worker',['freelancer']),other=await account('counter-other',['freelancer']);
 const id='http-counter-'+suffix,releaseId='http-counter-release-'+suffix;
 const paymentTerms=createDirectPaymentTerms({method:'external_pix',timing:'on_completion',amountMinor:12000});
 const workTerms={mode:'fixed',location:'remote',estimatedMinutes:360};
 const terms={title:'Edição fictícia de fotos',description:'Somente emulador',requirements:'',paymentMinor:12000,paymentTerms,workTerms};
 const proposal={amountMinor:9000,estimatedMinutes:180};
 const expected={expectedPaymentTerms:paymentTerms,expectedWorkTerms:workTerms};
 await act(owner,id,'publish',200,{terms});
 await act(worker,id,'apply',400,{...expected,counterproposal:{...proposal,location:'on_site'}});
 await act(worker,id,'apply',200,{...expected,counterproposal:proposal});
 await act(worker,id,'apply',200,{...expected,counterproposal:proposal});
 await act(worker,id,'apply',409,{...expected,counterproposal:{...proposal,amountMinor:8000}});
 await act(other,id,'apply',200,expected);
 const detail=async(actor:Actor,offerId=id)=>call(actor,'?view=detail&offerId='+offerId,200);
 assert.deepEqual((await detail(owner)).applications.find((a:any)=>a.applicantUid===worker.uid).counterproposal,proposal);
 assert.equal((await detail(other)).applications.length,1);
 assert.equal((await detail(other)).applications[0].counterproposal,undefined);
 await act(owner,id,'select',409,{applicantUid:worker.uid});
 await act(owner,id,'select',409,{applicantUid:worker.uid,expectedCounterproposal:{...proposal,amountMinor:8000}});
 await act(owner,id,'select',200,{applicantUid:worker.uid,expectedCounterproposal:proposal});
 await act(owner,id,'select',200,{applicantUid:worker.uid,expectedCounterproposal:proposal});
 const ref=db.doc('freelanceOffersV1/'+id);
 assert.equal((await ref.get()).get('paymentMinor'),12000);
 assert.equal((await ref.collection('directPayment').doc('obligation').get()).exists,false);
 assert.deepEqual((await detail(worker)).item.selectedCounterproposal,proposal);
 assert.equal((await detail(other)).item.selectedCounterproposal,undefined);
 await act(worker,id,'confirm',409,{confirmed:true,...expected});
 await act(other,id,'confirm',403,{confirmed:true,...expected});
 const agreed={expectedPaymentTerms:createDirectPaymentTerms({method:'external_pix',timing:'on_completion',amountMinor:9000}),expectedWorkTerms:{...workTerms,estimatedMinutes:180}};
 await act(worker,id,'confirm',200,{confirmed:true,...agreed});
 await act(worker,id,'confirm',200,{confirmed:true,...agreed});
 const saved=(await ref.get()).data()!;
 assert.equal(saved.paymentMinor,9000);assert.deepEqual(saved.originalOfferTerms,{paymentMinor:12000,paymentTerms,workTerms});
 assert.equal((await ref.collection('directPayment').doc('obligation').get()).get('terms.amountMinor'),9000);
 assert.deepEqual((await ref.collection('applications').doc(worker.uid).get()).get('workTerms'),agreed.expectedWorkTerms);
 assert.equal((await detail(other)).item.paymentMinor,12000);
 assert.equal((await detail(other)).item.selectedCounterproposal,undefined);
 const {buildFreelancePaymentObligation}=await import('../shared/freelancePaymentObligation.js');
 const app=(await ref.collection('applications').doc(worker.uid).get()).data()!;
 assert.throws(()=>buildFreelancePaymentObligation({...saved,workTerms:{...saved.workTerms,estimatedMinutes:181}} as any,{...app,workTerms:{...app.workTerms,estimatedMinutes:181}} as any),/OBLIGATION_CONFLICT/);
 await act(owner,releaseId,'publish',200,{terms});
 await act(worker,releaseId,'apply',200,{...expected,counterproposal:proposal});
 await act(other,releaseId,'apply',200,expected);
 await act(owner,releaseId,'select',200,{applicantUid:worker.uid,expectedCounterproposal:proposal});
 await act(owner,releaseId,'release',200,{applicantUid:worker.uid,confirmed:true});
 assert.equal((await detail(owner,releaseId)).item.selectedCounterproposal,undefined);
 await act(owner,releaseId,'select',200,{applicantUid:other.uid});
 await act(other,releaseId,'confirm',200,{confirmed:true,...expected});
 assert.equal((await db.doc('freelanceOffersV1/'+releaseId+'/directPayment/obligation').get()).get('terms.amountMinor'),12000);
});

test('store representation HTTP: owner only, no subscription, pinned identity and revoked authority',async()=>{
 const {createDirectPaymentTerms}=await import('../shared/directPaymentTerms.js');
 const owner=await account('store-owner',['requester']),worker=await account('store-worker',['freelancer']),manager=await account('store-manager',['requester']);
 const storeId='canonical-freela-'+suffix,store={storeId,displayName:'Loja fictícia Free',representativeRole:'owner'};
 const member=db.doc('stores/'+storeId+'/members/'+owner.uid);
 await db.doc('users/'+owner.uid+'/stores/'+owner.uid).set({id:owner.uid,ownerId:owner.uid,canonicalStoreId:storeId,name:store.displayName});
 await db.doc('tenants/'+owner.uid).set({ownerId:owner.uid,canonicalStoreId:storeId});
 await db.doc('stores/'+storeId).set({ownerId:owner.uid,legacyTenantId:owner.uid});
 await member.set({userId:owner.uid,status:'active',role:'owner'});
 await db.doc('stores/'+storeId+'/members/'+manager.uid).set({userId:manager.uid,status:'active',role:'manager'});
 assert.deepEqual((await call(owner,'?view=requester_stores',200)).items,[store]);
 assert.deepEqual((await call(manager,'?view=requester_stores',200)).items,[]);
 const id='http-store-'+suffix,personalId='http-personal-'+suffix;
 const paymentTerms=createDirectPaymentTerms({method:'external_pix',amountMinor:12000});
 const terms={title:'Serviço fictício',description:'Somente emulador',requirements:'',paymentMinor:12000,paymentTerms};
 await act(manager,id,'publish',403,{terms,requesterStoreId:storeId});
 await act(owner,id,'publish',403,{terms,requesterStoreId:'foreign-store'});
 await act(owner,id,'publish',200,{terms,requesterStoreId:storeId});
 await act(owner,id,'publish',409,{terms});
 const detail=(actor:Actor)=>call(actor,'?view=detail&offerId='+id,200);
 assert.deepEqual((await detail(worker)).item.requesterStore,store);
 await act(worker,id,'apply',409,{expectedPaymentTerms:paymentTerms});
 await act(worker,id,'apply',200,{expectedPaymentTerms:paymentTerms,expectedRequesterStore:store});
 await member.update({status:'inactive'});
 await act(owner,id,'select',403,{applicantUid:worker.uid});
 await member.update({status:'active'});
 await act(owner,id,'select',200,{applicantUid:worker.uid});
 await act(worker,id,'confirm',409,{confirmed:true,expectedPaymentTerms:paymentTerms});
 await member.update({status:'inactive'});
 await act(worker,id,'confirm',403,{confirmed:true,expectedPaymentTerms:paymentTerms,expectedRequesterStore:store});
 await member.update({status:'active'});
 await act(worker,id,'confirm',200,{confirmed:true,expectedPaymentTerms:paymentTerms,expectedRequesterStore:store});
 const obligation=(await db.doc('freelanceOffersV1/'+id+'/directPayment/obligation').get()).data()!;
 assert.equal(obligation.requesterStoreId,storeId);
 assert.equal(obligation.requesterUid,owner.uid);
 await member.update({status:'inactive'});
 await act(worker,id,'confirm',200,{confirmed:true,expectedPaymentTerms:paymentTerms,expectedRequesterStore:store});
 await act(manager,personalId,'publish',200,{terms});
 assert.equal((await db.doc('freelanceOffersV1/'+personalId).get()).get('requesterStore'),undefined);
});

test('schedule HTTP: private, bilateral, immutable decisions and server-derived duration',async()=>{
 const {createDirectPaymentTerms}=await import('../shared/directPaymentTerms.js');
 const owner=await account('schedule-owner',['requester']),worker=await account('schedule-worker',['freelancer']),other=await account('schedule-other',['freelancer']);
 const id='http-schedule-'+suffix,paymentTerms=createDirectPaymentTerms({method:'external_pix',amountMinor:12000});
 const workTerms={mode:'fixed',location:'remote',estimatedMinutes:360};
 const terms={title:'Agenda fictícia',description:'Somente emulador',requirements:'',paymentMinor:12000,paymentTerms,workTerms};
 const expected={expectedPaymentTerms:paymentTerms,expectedWorkTerms:workTerms};
 await act(owner,id,'publish',200,{terms});await act(worker,id,'apply',200,expected);await act(owner,id,'select',200,{applicantUid:worker.uid});await act(worker,id,'confirm',200,{confirmed:true,...expected});
 const read=(actor:Actor,status=200)=>call(actor,'?view=attendance_schedule&offerId='+id,status);
 const future=new Date(Date.now()+86400000).toISOString();
 await read(other,403);
 await act(other,id,'propose_schedule',403,{proposalId:'p1',scheduledStartAt:future,confirmed:true});
 await act(owner,id,'propose_schedule',409,{proposalId:'old',scheduledStartAt:'2020-01-01T00:00:00.000Z',confirmed:true});
 await act(owner,id,'propose_schedule',400,{proposalId:'p1',scheduledStartAt:future,confirmed:true,agreedMinutes:1});
 await act(owner,id,'propose_schedule',200,{proposalId:'p1',scheduledStartAt:future,confirmed:true});
 await act(owner,id,'propose_schedule',200,{proposalId:'p1',scheduledStartAt:future,confirmed:true});
 await act(owner,id,'accept_schedule',403,{proposalId:'p1',confirmed:true});
 await act(worker,id,'decline_schedule',200,{proposalId:'p1',confirmed:true});
 await act(worker,id,'propose_schedule',200,{proposalId:'p2',scheduledStartAt:future,confirmed:true});
 await act(owner,id,'accept_schedule',409,{proposalId:'p1',confirmed:true});
 await act(owner,id,'accept_schedule',200,{proposalId:'p2',confirmed:true});
 await act(owner,id,'accept_schedule',200,{proposalId:'p2',confirmed:true});
 const result=await read(worker);
 assert.equal(result.schedule.status,'accepted');assert.deepEqual(result.schedule.schedule,{location:'remote',scheduledStartAt:future,agreedMinutes:360});
 assert.equal(result.executionIntegrated,true);
 assert.equal((await db.doc('freelanceOffersV1/'+id+'/attendance/schedule-p1').get()).get('status'),'declined');
 assert.equal((await db.doc('freelanceOffersV1/'+id+'/directPayment/obligation').get()).get('terms.amountMinor'),12000);
 await act(worker,id,'propose_schedule',409,{proposalId:'p3',scheduledStartAt:future,confirmed:true});
});

test('attendance HTTP: check-in, presence, server timestamps, early authorization, Pix gate and atomic completion',async()=>{
 const {createDirectPaymentTerms}=await import('../shared/directPaymentTerms.js');
 const {changePersonalPixDestination}=await import('../server/payments/personalPixDestinationService.js');
 const owner=await account('attendance-owner',['requester']),worker=await account('attendance-worker',['freelancer']),other=await account('attendance-other',['freelancer']);
 const id='http-attendance-'+suffix,paymentTerms=createDirectPaymentTerms({method:'external_pix',amountMinor:12000});
 const workTerms={mode:'fixed',location:'on_site',estimatedMinutes:360};
 const terms={title:'Jornada fictícia',description:'Somente emulador',requirements:'',paymentMinor:12000,paymentTerms,workTerms};
 const expected={expectedPaymentTerms:paymentTerms,expectedWorkTerms:workTerms};
 await act(owner,id,'publish',200,{terms});await act(worker,id,'apply',200,expected);await act(owner,id,'select',200,{applicantUid:worker.uid});await act(worker,id,'confirm',200,{confirmed:true,...expected});
 const future=new Date(Date.now()+86400000).toISOString();
 await act(owner,id,'propose_schedule',200,{proposalId:'schedule',scheduledStartAt:future,confirmed:true});
 await act(worker,id,'accept_schedule',200,{proposalId:'schedule',confirmed:true});
 const read=(actor:Actor,status=200)=>call(actor,'?view=attendance&offerId='+id,status);
 const event=(actor:Actor,kind:string,eventId:string,expectedSequence:number,status=200)=>act(actor,id,'attendance_event',status,{kind,eventId,expectedSequence,confirmed:true});
 await read(other,403);await event(other,'check_in','x',0,403);
 await event(owner,'check_in','x',0,409);
 await event(worker,'suspend','x',0,400);
 await act(worker,id,'attendance_event',400,{kind:'check_in',eventId:'x',expectedSequence:0,confirmed:true,at:'2020-01-01T00:00:00Z'});
 const before=Date.now();
 await event(worker,'check_in','arrival',0);await event(worker,'check_in','arrival',0);
 let t=await read(worker);assert.equal(t.events.length,1);assert.ok(Date.parse(t.events[0].at)>=before&&Date.parse(t.events[0].at)<=Date.now());
 await event(owner,'confirm_presence','presence',0,409);
 await event(owner,'confirm_presence','presence',1);
 assert.equal((await act(worker,id,'start',409,{confirmed:true})).code,'FREELANCE_PIX_DESTINATION_REQUIRED');
 await changePersonalPixDestination(worker.uid,{action:'declare',expectedRevision:0,confirmed:true,destination:{keyType:'email',key:'attendance-'+suffix+'@example.invalid'}});
 const finance=async(action:string)=>{
  const res=await fetch('http://127.0.0.1:'+address.port+'/api/freelance/finance',{method:'POST',headers:{authorization:'Bearer '+worker.token,'content-type':'application/json'},body:JSON.stringify({action,offerId:id,confirmed:true,expectedRevision:1})});
  const body=await res.json();assert.equal(res.status,200,JSON.stringify(body));
 };
 await finance('bind_pix');await finance('authorize_pix_share');
 assert.equal((await act(worker,id,'start',409,{confirmed:true})).code,'FREELANCE_ATTENDANCE_CONFLICT');
 await event(owner,'authorize_early_start','early',2);
 await act(worker,id,'start',200,{confirmed:true});await act(worker,id,'start',200,{confirmed:true});
 const extensions=(actor:Actor,status=200)=>call(actor,'?view=attendance_extensions&offerId='+id,status);
 await extensions(other,403);
 const proposal={proposalId:'ext1',extraMinutes:60,expectedSequence:4,confirmed:true};
 await act(other,id,'propose_extension',403,proposal);
 await act(worker,id,'propose_extension',409,{...proposal,expectedSequence:3});
 await act(worker,id,'propose_extension',200,proposal);await act(worker,id,'propose_extension',200,proposal);
 await act(worker,id,'accept_extension',403,{proposalId:'ext1',expectedSequence:4,confirmed:true});
 await act(owner,id,'accept_extension',200,{proposalId:'ext1',expectedSequence:4,confirmed:true});
 await act(owner,id,'accept_extension',200,{proposalId:'ext1',expectedSequence:4,confirmed:true});
 assert.equal((await extensions(worker)).authorizedMinutes,420);
 assert.equal((await extensions(owner)).records.length,1);
 await act(owner,id,'propose_extension',200,{proposalId:'ext2',extraMinutes:30,expectedSequence:4,confirmed:true});
 await act(worker,id,'decline_extension',200,{proposalId:'ext2',expectedSequence:4,confirmed:true});
 assert.equal((await extensions(owner)).authorizedMinutes,420);
 await event(worker,'request_break','break',4);await event(owner,'approve_break','approve',5);await event(worker,'resume','resume',6);
 await act(worker,id,'request_completion',200,{confirmed:true});await act(owner,id,'confirm_completion',200,{confirmed:true});await act(owner,id,'confirm_completion',200,{confirmed:true});
 t=await read(owner);
 assert.equal(t.events.length,9);assert.equal(t.projection.status,'confirmed');assert.equal(t.projection.financialSettlement,'not_verified');
 assert.equal((await db.doc('freelanceOffersV1/'+id+'/financialBasis/remuneration').get()).get('confirmedServiceMinor'),12000);
 await event(worker,'resume','late',9,409);
 await act(worker,id,'propose_extension',409,{proposalId:'late',extraMinutes:10,expectedSequence:9,confirmed:true});
 assert.equal((await extensions(owner)).records.length,2);
});

test('variable basis from persisted emulator-only hourly fixture: immutable source, amount and isolation',async t=>{
 const {createDirectPaymentTerms}=await import('../shared/directPaymentTerms.js');
 const {recordFreelanceVariablePaymentBasis}=await import('../server/freelance/freelanceVariablePaymentBasisService.js');
 const owner=await account('variable-owner',['requester']),worker=await account('variable-worker',['freelancer']),other=await account('variable-other',['freelancer']);
 const id='http-variable-'+suffix,ref=db.doc('freelanceOffersV1/'+id);
 const at=(h:string)=>'2026-11-26T'+h+':00.000Z';
 const paymentTerms=createDirectPaymentTerms({method:'external_pix',amountMinor:12000});
 const workTerms={mode:'hourly',location:'remote',estimatedMinutes:360,hourlyRateMinor:2000};
 const common={paymentTerms,workTerms,status:'completed',selectedAt:at('07:10'),contractedAt:at('07:15'),startedAt:at('08:00'),completionRequestedAt:at('15:00'),completedAt:at('15:05')};
 const offer={...common,id,ownerUid:owner.uid,selectedApplicantUid:worker.uid,title:'Fixture horária',description:'Emulador',requirements:'',paymentMinor:12000,createdAt:at('07:00')};
 const application={...common,offerId:id,ownerUid:owner.uid,applicantUid:worker.uid,createdAt:at('07:05')};
 // Prepare the hourly commitment with synthetic contracted records before the completion fixture.
 const {buildFreelanceHourlyCommitment}=await import('../shared/freelanceVariablePaymentBasis.js');
 const {changePersonalPixDestination}=await import('../server/payments/personalPixDestinationService.js');
 const {assertDirectPixStart}=await import('../server/freelance/freelancePixDestinationService.js');
 const {startedAt,completionRequestedAt,completedAt,...preOffer}=offer;
 const {startedAt:sa,completionRequestedAt:ca,completedAt:co,...preApplication}=application;
 const contractedOffer={...preOffer,status:'contracted' as const} as any,contractedApplication={...preApplication,status:'contracted' as const} as any;
 await ref.set(contractedOffer);await ref.collection('applications').doc(worker.uid).set(contractedApplication);
 await ref.collection('directPayment').doc('hourlyCommitment').set(buildFreelanceHourlyCommitment(contractedOffer,contractedApplication));
 const prep=async(a:Actor,status:number,action?:string,extra:Record<string,unknown>={},view='pix_sharing')=>{
  const url='http://127.0.0.1:'+address.port+'/api/freelance/finance'+(action?'':'?view='+view+'&offerId='+id);
  const res=await fetch(url,{method:action?'POST':'GET',headers:{authorization:'Bearer '+a.token,'content-type':'application/json'},...(action?{body:JSON.stringify({offerId:id,action,confirmed:true,...extra})}:{})});
  const body=await res.json();assert.equal(res.status,status,JSON.stringify(body));return body;
 };
 const rev={expectedRevision:1};
 await prep(other,403);
 await changePersonalPixDestination(worker.uid,{action:'declare',expectedRevision:0,confirmed:true,destination:{keyType:'email',key:'hourly-'+suffix+'@example.invalid'}});
 await assert.rejects(db.runTransaction(tx=>assertDirectPixStart(tx,contractedOffer,contractedApplication)),/PIX_DESTINATION_REQUIRED/);
 await prep(worker,200,'bind_pix',rev);
 await prep(worker,200,'authorize_pix_share',rev);
 assert.equal((await prep(owner,200)).due,false);
 await prep(owner,409,'reveal_pix',rev);
 await db.runTransaction(tx=>assertDirectPixStart(tx,contractedOffer,contractedApplication));
 await prep(worker,200,'revoke_pix_share',{...rev,expectedSequence:0});
 await assert.rejects(db.runTransaction(tx=>assertDirectPixStart(tx,contractedOffer,contractedApplication)),/PIX_SHARING_REQUIRED/);
 await prep(worker,200,'restore_pix_share',{...rev,expectedSequence:1});
 await changePersonalPixDestination(worker.uid,{action:'declare',expectedRevision:1,confirmed:true,destination:{keyType:'email',key:'hourly-new-'+suffix+'@example.invalid'}});
 await prep(owner,409);
 await prep(worker,200,'propose_pix_rebind',{oldRevision:1,newRevision:2});
 await prep(owner,200,'accept_pix_rebind',{oldRevision:1,newRevision:2,paymentNotSent:true});
 await prep(worker,200,'authorize_pix_share',{expectedRevision:2});
 await prep(owner,409,'reveal_pix',{expectedRevision:2});
 assert.equal((await ref.collection('directPayment').doc('pixDisclosure').get()).exists,false);
 await db.runTransaction(tx=>assertDirectPixStart(tx,contractedOffer,contractedApplication));
 await ref.set(offer);await ref.collection('applications').doc(worker.uid).set(application);
 await ref.collection('attendance').doc('schedule').set({proposalId:'schedule'});
 await ref.collection('attendance').doc('schedule-schedule').set({id:'schedule',schedule:{location:'remote',scheduledStartAt:at('08:00'),agreedMinutes:360},proposedBy:'requester',proposedAt:at('07:20'),status:'accepted',decidedBy:'worker',decidedAt:at('07:25')});
 const events=[{id:'l-start',kind:'start',actor:'worker',at:at('08:00')},{id:'l-request_completion',kind:'checkout',actor:'worker',at:at('15:00')},{id:'l-confirm_completion',kind:'confirm_checkout',actor:'requester',at:at('15:05')}];
 await ref.collection('attendance').doc('timeline').set({scheduleId:'schedule',events});
 await ref.collection('attendance').doc('extensions').set({scheduleId:'schedule',records:[{id:'ext1',extraMinutes:120,proposedBy:'worker',proposedAt:at('12:00'),status:'accepted',decidedBy:'requester',decidedAt:at('12:05')}]});
 await assert.rejects(recordFreelanceVariablePaymentBasis(other.uid,id),/FORBIDDEN/);
 const {issueFreelanceHourlyFinalObligation}=await import('../server/freelance/freelanceHourlyFinalObligationService.js');
 await assert.rejects(issueFreelanceHourlyFinalObligation(worker.uid,id),/VARIABLE_PAYMENT_CONFLICT/);
 const first=await recordFreelanceVariablePaymentBasis(worker.uid,id);
 assert.equal(first.replay,false);assert.equal(first.basis.commitment.estimatedMinor,12000);
 assert.equal(first.basis.accounting.authorizedCapMinor,16000);
 assert.equal(first.basis.finalAmountMinor,14000);assert.equal(first.basis.payable,false);assert.equal(first.basis.bankVerified,false);
 assert.equal((await recordFreelanceVariablePaymentBasis(owner.uid,id)).replay,true);
 assert.equal((await ref.collection('directPayment').doc('obligation').get()).exists,false);
 assert.equal((await ref.collection('directPayment').doc('externalStatements').get()).exists,false);
 await ref.collection('attendance').doc('extensions').delete();
 await assert.rejects(recordFreelanceVariablePaymentBasis(worker.uid,id),/VARIABLE_PAYMENT_CONFLICT/);
 await ref.collection('financialBasis').doc('hourlyCompletion').delete();
 const excess=await recordFreelanceVariablePaymentBasis(owner.uid,id);
 assert.equal(excess.basis.disposition,'requires_review');assert.equal(excess.basis.finalAmountMinor,null);assert.equal(excess.basis.payable,false);
 await assert.rejects(issueFreelanceHourlyFinalObligation(owner.uid,id),/VARIABLE_PAYMENT_CONFLICT/);
 // Separate synthetic excess case; do not mutate the accepted review to restore the other fixture.
 const excessId=id+'-excess',er=db.doc('freelanceOffersV1/'+excessId);
 await er.set({...offer,id:excessId});await er.collection('applications').doc(worker.uid).set({...application,offerId:excessId});
 for(const name of ['schedule','schedule-schedule','timeline'])await er.collection('attendance').doc(name).set((await ref.collection('attendance').doc(name).get()).data()!);
 const eb=await recordFreelanceVariablePaymentBasis(owner.uid,excessId);
 const excessApi=async(actor:Actor,status:number,action?:string,extra:Record<string,unknown>={},target=excessId)=>{
  const url='http://127.0.0.1:'+address.port+'/api/freelance/finance'+(action?'':'?view=hourly_excess_review&offerId='+target);
  const res=await fetch(url,{method:action?'POST':'GET',headers:{authorization:'Bearer '+actor.token,'content-type':'application/json'},...(action?{body:JSON.stringify({offerId:target,action,confirmed:true,...extra})}:{})});
  const data=await res.json();assert.equal(res.status,status,JSON.stringify(data));return data;
 };
 await excessApi(other,403);
 const ev=await excessApi(worker,200);assert.equal(ev.excessMs,3600000);assert.equal(ev.authorizedMinor,12000);
 const {calculateHourlyExcessResolution}=await import('../shared/freelanceHourlyExcessResolution.js');
 assert.equal(calculateHourlyExcessResolution(eb.basis,0).recognizedServiceMinor,12000);
 assert.equal(calculateHourlyExcessResolution(eb.basis,3600000).recognizedServiceMinor,14000);
 const ep={proposalId:'first',sourceDigest:ev.sourceDigest,recognizedExcessMs:1800000};
 await excessApi(worker,400,'propose_hourly_excess',{...ep,recognizedExcessMs:3600001});
 await excessApi(worker,409,'propose_hourly_excess',{...ep,sourceDigest:'0'.repeat(64)});
 await excessApi(worker,200,'propose_hourly_excess',ep);await excessApi(worker,200,'propose_hourly_excess',ep);
 await excessApi(worker,403,'accept_hourly_excess',{proposalId:'first',sourceDigest:ev.sourceDigest});
 await excessApi(owner,200,'decline_hourly_excess',{proposalId:'first',sourceDigest:ev.sourceDigest});
 assert.equal((await excessApi(owner,200)).restrictionActive,false);
 const restriction=async(actor:Actor)=>{const r=await fetch('http://127.0.0.1:'+address.port+'/api/freelance/finance?view=restrictions',{headers:{authorization:'Bearer '+actor.token}});const v=await r.json();assert.equal(r.status,200,JSON.stringify(v));return v;};
 const ef={sourceDigest:ev.sourceDigest};
 await excessApi(other,403,'dispute_hourly_excess',ef);
 await excessApi(owner,409,'dispute_hourly_excess',{sourceDigest:'0'.repeat(64)});
 await excessApi(worker,200,'dispute_hourly_excess',ef);await excessApi(worker,200,'dispute_hourly_excess',ef);
 for(const actor of [owner,worker])assert.deepEqual(await restriction(actor),{restricted:true,openOfferIds:[excessId]});
 await excessApi(owner,200,'request_hourly_excess_review',ef);await excessApi(owner,200,'request_hourly_excess_review',ef);
 assert.equal((await excessApi(worker,200)).dispute.status,'review_requested');
 assert.equal((await db.doc('freelanceHourlyExcessReviewsV1/'+excessId).get()).get('status'),'pending');
 // Synthetic concurrent cancellation and payment causes on the same offer.
 for(const actor of [owner,worker])await db.doc('freelanceEngagementRestrictionsV1/'+actor.uid).update({openOfferIds:[excessId],openCancellationOfferIds:[excessId]});
 await excessApi(owner,200,'propose_hourly_excess',{...ep,proposalId:'second'});
 await excessApi(worker,409,'accept_hourly_excess',{proposalId:'first',sourceDigest:ev.sourceDigest});
 await excessApi(worker,200,'accept_hourly_excess',{proposalId:'second',sourceDigest:ev.sourceDigest});
 await excessApi(worker,200,'accept_hourly_excess',{proposalId:'second',sourceDigest:ev.sourceDigest});
 const resolved=await excessApi(owner,200);assert.equal(resolved.resolved.recognizedServiceMinor,13000);assert.equal(resolved.resolved.unrecognizedExcessMs,1800000);assert.equal(resolved.payable,true);assert.equal(resolved.restrictionActive,false);assert.equal(resolved.dispute.status,'resolved_voluntarily');
 assert.equal((await db.doc('freelanceHourlyExcessReviewsV1/'+excessId).get()).get('status'),'resolved_voluntarily');
 for(const actor of [owner,worker]){assert.deepEqual(await restriction(actor),{restricted:true,openOfferIds:[excessId]});const root=db.doc('freelanceEngagementRestrictionsV1/'+actor.uid);const stored=(await root.get()).data()!;assert.deepEqual(stored.openOfferIds,[excessId]);assert.deepEqual(stored.openCancellationOfferIds,[excessId]);assert.equal(stored.openExcessOfferIds,undefined);await root.set({schemaVersion:1,uid:actor.uid,openOfferIds:[]});}
 const excessFinal=(await er.collection('directPayment').doc('hourlyFinalObligation').get()).data()!;
 assert.equal(excessFinal.kind,'hourly_excess_obligation');assert.equal(excessFinal.amountMinor,13000);assert.equal(excessFinal.sourceDigest,resolved.resolved.sourceDigest);assert.notEqual(excessFinal.sourceDigest,ev.sourceDigest);
 // Synthetic pre-existing consent copied from the prepared hourly fixture, scoped to this contract.
 for(const name of ['receivingDestination','pixSharing']){
  const saved=(await ref.collection('directPayment').doc(name).get()).data()!;
  await er.collection('directPayment').doc(name).set({...saved,offerId:excessId});
 }
 const excessFinance=async(actor:Actor,status:number,action?:string,extra:Record<string,unknown>={},target=excessId)=>{
  const url='http://127.0.0.1:'+address.port+'/api/freelance/finance'+(action?'':'?view=case&offerId='+target);
  const r=await fetch(url,{method:action?'POST':'GET',headers:{authorization:'Bearer '+actor.token,'content-type':'application/json'},...(action?{body:JSON.stringify({offerId:target,action,confirmed:true,...extra})}:{})});
  const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;
 };
 assert.equal((await excessFinance(owner,200)).amountMinor,13000);
 const disclosed=await excessFinance(owner,200,'reveal_pix',{expectedRevision:2});assert.equal(disclosed.amountMinor,13000);
 const xf={eventId:'excess-paid',statement:'paid',expectedAmountMinor:13000,sourceDigest:excessFinal.sourceDigest};
 await excessFinance(owner,409,'statement',{...xf,sourceDigest:ev.sourceDigest});
 await excessFinance(owner,409,'statement',{...xf,expectedAmountMinor:12000});
 await excessFinance(owner,200,'statement',xf);
 await excessFinance(worker,200,'statement',{...xf,eventId:'excess-received',statement:'received'});
 assert.equal((await excessFinance(owner,200)).financialState,'bilaterally_reported_received');
 await excessApi(owner,409,'propose_hourly_excess',{...ep,proposalId:'third'});
 // Separate excess case for administrative decision, with synthetic MFA only in emulator.
 const adminId=excessId+'-admin',ar=db.doc('freelanceOffersV1/'+adminId);
 await ar.set({...offer,id:adminId});await ar.collection('applications').doc(worker.uid).set({...application,offerId:adminId});
 for(const name of ['schedule','schedule-schedule','timeline'])await ar.collection('attendance').doc(name).set((await er.collection('attendance').doc(name).get()).data()!);
 await recordFreelanceVariablePaymentBasis(owner.uid,adminId);
 const ax=await excessApi(worker,200,undefined,{},adminId),af={sourceDigest:ax.sourceDigest};
 await excessApi(worker,200,'propose_hourly_excess',{...af,proposalId:'first',recognizedExcessMs:1800000},adminId);
 await excessApi(owner,200,'decline_hourly_excess',{...af,proposalId:'first'},adminId);
 await excessApi(worker,200,'dispute_hourly_excess',af,adminId);
 await excessApi(owner,200,'request_hourly_excess_review',af,adminId);
 const admin=await account('excess-review-admin',[]);
 await db.doc('kyrub_admin/control_plane/admins/'+admin.uid).set({uid:admin.uid,role:'super_admin',status:'active'});
 const review=async(actor:Actor,status:number,input?:Record<string,unknown>)=>{
  const r=await fetch('http://127.0.0.1:'+address.port+'/api/admin/freelance-financial-review'+(input?'':'?view=hourly_excess'),{method:input?'POST':'GET',headers:{authorization:'Bearer '+actor.token,'content-type':'application/json'},...(input?{body:JSON.stringify(input)}:{})});
  const v=await r.json();assert.equal(r.status,status,JSON.stringify(v));return v;
 };
 await review(admin,403);
 const original=auth.verifyIdToken.bind(auth);
 const mock=t.mock.method(auth,'verifyIdToken',async(token:string,checkRevoked?:boolean)=>{const d=await original(token,checkRevoked);return token===admin.token?{...d,auth_time:Math.floor(Date.now()/1000),firebase:{...d.firebase,sign_in_second_factor:'totp'}}:d;});
 try{
  const item=(await review(admin,200)).items.find((x:any)=>x.offerId===adminId);assert.ok(item);
  const decision={action:'decide_hourly_excess',offerId:adminId,sourceDigest:ax.sourceDigest,expectedRequestedAt:item.requestedAt,proposalDigest:item.proposalDigest,evidenceDigest:item.evidenceDigest,recognizedExcessMs:1800000,reason:'Decisão fictícia fundamentada do excedente',confirmed:true};
  await excessApi(owner,200,'propose_hourly_excess',{...af,proposalId:'second',recognizedExcessMs:0},adminId);
  await review(admin,409,decision);
  const fresh=(await review(admin,200)).items.find((x:any)=>x.offerId===adminId);
  const note={kind:'excess',sourceDigest:ax.sourceDigest,evidenceId:'note-one',note:'Manifestação fictícia privada do profissional.'};
  await excessApi(other,403,'submit_hourly_review_note',note,adminId);
  await excessApi(worker,200,'submit_hourly_review_note',note,adminId);
  await excessApi(worker,200,'submit_hourly_review_note',note,adminId);
  const own=async(actor:Actor,kind:string,target:string,status=200)=>{const r=await fetch('http://127.0.0.1:'+address.port+'/api/freelance/finance?view=hourly_review_notes&kind='+kind+'&offerId='+target,{headers:{authorization:'Bearer '+actor.token}});const v=await r.json();assert.equal(r.status,status,JSON.stringify(v));return v;};
  assert.equal((await own(worker,'excess',adminId)).notes.length,1);
  assert.deepEqual((await own(owner,'excess',adminId)).notes,[]);
  await own(other,'excess',adminId,403);
  await review(admin,409,{...decision,proposalDigest:fresh.proposalDigest});
  const latest=(await review(admin,200)).items.find((x:any)=>x.offerId===adminId);
  assert.equal(latest.notes.length,1);assert.equal(latest.notes[0].note,note.note);assert.equal('actorUid' in latest.notes[0],false);
  const {receiptFixture}=await import('./fixtures/freelance-receipt-fixture.js');
  const attachment={kind:'excess',sourceDigest:ax.sourceDigest,attachmentId:'attachment-one',pngBase64:receiptFixture()};
  await excessApi(worker,400,'submit_hourly_review_attachment',{...attachment,pngBase64:'YWJjZA=='},adminId);
  await excessApi(other,403,'submit_hourly_review_attachment',attachment,adminId);
  await excessApi(worker,200,'submit_hourly_review_attachment',attachment,adminId);
  await excessApi(worker,200,'submit_hourly_review_attachment',attachment,adminId);
  await excessApi(worker,409,'submit_hourly_review_attachment',{...attachment,attachmentId:'second-attachment'},adminId);
  assert.equal((await own(worker,'excess',adminId)).attachments.length,1);
  assert.deepEqual((await own(owner,'excess',adminId)).attachments,[]);
  const getAttachment=async(actor:Actor,status:number,adminView=false)=>{
   const endpoint=adminView?'/api/admin/freelance-financial-review?view=hourly_attachment':'/api/freelance/finance?view=hourly_review_attachment';
   const r=await fetch('http://127.0.0.1:'+address.port+endpoint+'&kind=excess&offerId='+adminId+'&attachmentId=attachment-one',{headers:{authorization:'Bearer '+actor.token}});const v=await r.json();assert.equal(r.status,status,JSON.stringify(v));return v;
  };
  await getAttachment(owner,403);await getAttachment(other,403,true);
  const img=await getAttachment(worker,200);assert.equal(img.mimeType,'image/png');assert.ok(!Buffer.from(img.pngBase64,'base64').includes(Buffer.from('fixture metadata')));
  assert.equal((await getAttachment(admin,200,true)).pngBase64,img.pngBase64);
  await review(admin,409,{...decision,proposalDigest:latest.proposalDigest,evidenceDigest:latest.evidenceDigest});
  const withAttachment=(await review(admin,200)).items.find((x:any)=>x.offerId===adminId);
  assert.equal(withAttachment.attachments.length,1);assert.ok(!JSON.stringify(withAttachment).includes('pngBase64'));
  const next={...decision,proposalDigest:withAttachment.proposalDigest,evidenceDigest:withAttachment.evidenceDigest};
  await review(admin,409,{...next,recognizedExcessMs:3600001});
  await review(other,403,next);
  assert.equal((await review(admin,200,next)).replay,false);assert.equal((await review(admin,200,next)).replay,true);
  await review(admin,409,{...next,recognizedExcessMs:0});
  await excessApi(worker,409,'accept_hourly_excess',{...af,proposalId:'second'},adminId);
  await excessApi(worker,409,'submit_hourly_review_note',{...note,evidenceId:'late'},adminId);
  await excessApi(worker,409,'submit_hourly_review_attachment',attachment,adminId);await getAttachment(worker,200);await getAttachment(admin,409,true);
  const av=await excessApi(worker,200,undefined,{},adminId);
  assert.equal(av.dispute.status,'resolved_administratively');assert.equal(av.resolved.recognizedServiceMinor,13000);assert.equal(av.restrictionActive,false);assert.equal(av.payable,true);
  assert.equal('actorUid' in av.dispute.decision,false);
  const adminFinal=(await ar.collection('directPayment').doc('hourlyFinalObligation').get()).data()!;assert.equal(adminFinal.kind,'hourly_excess_obligation');assert.equal(adminFinal.amountMinor,13000);assert.equal(adminFinal.sourceDigest,av.resolved.sourceDigest);
  assert.equal((await excessFinance(owner,200,undefined,{},adminId)).amountMinor,13000);
  for(const actor of [owner,worker])assert.deepEqual(await restriction(actor),{restricted:false,openOfferIds:[]});
  assert.ok(!(await review(admin,200)).items.some((x:any)=>x.offerId===adminId));
 }finally{mock.mock.restore();}
 await er.collection('attendance').doc('timeline').delete();await excessApi(worker,409);await excessFinance(owner,409);
 // Positive contracted estimate rounded to zero on a short, bilaterally confirmed journey.
 const zeroId=id+'-zero',zr=db.doc('freelanceOffersV1/'+zeroId);
 const zeroPayment=createDirectPaymentTerms({method:'external_pix',amountMinor:1}),zeroWork={mode:'hourly',location:'remote',estimatedMinutes:60,hourlyRateMinor:1};
 const zeroFields={paymentTerms:zeroPayment,workTerms:zeroWork,completionRequestedAt:at('08:01'),completedAt:at('08:02')};
 await zr.set({...offer,...zeroFields,id:zeroId,paymentMinor:1});
 await zr.collection('applications').doc(worker.uid).set({...application,...zeroFields,offerId:zeroId});
 await zr.collection('attendance').doc('schedule').set({proposalId:'schedule'});
 await zr.collection('attendance').doc('schedule-schedule').set({id:'schedule',schedule:{location:'remote',scheduledStartAt:at('08:00'),agreedMinutes:60},proposedBy:'requester',proposedAt:at('07:20'),status:'accepted',decidedBy:'worker',decidedAt:at('07:25')});
 await zr.collection('attendance').doc('timeline').set({scheduleId:'schedule',events:[events[0],{...events[1],at:at('08:01')},{...events[2],at:at('08:02')}]});
 const zero=await recordFreelanceVariablePaymentBasis(worker.uid,zeroId);
 assert.equal(zero.basis.disposition,'no_payment_required');assert.equal(zero.basis.finalAmountMinor,0);
 assert.equal((await recordFreelanceVariablePaymentBasis(owner.uid,zeroId)).replay,true);
 await excessFinance(other,403,undefined,{},zeroId);
 for(const actor of [owner,worker]){
  const z=await excessFinance(actor,200,undefined,{},zeroId);
  assert.equal(z.amountMode,'hourly_zero');assert.equal(z.amountMinor,0);assert.equal(z.due,false);assert.equal(z.financialState,'no_payment_required');assert.equal(z.bankVerified,false);assert.equal(z.canRequestReview,false);assert.deepEqual(z.statements,[]);
 }
 await excessFinance(owner,409,'reveal_pix',{expectedRevision:2},zeroId);
 await excessFinance(owner,409,'statement',{eventId:'zero-paid',statement:'paid',expectedAmountMinor:1,sourceDigest:zero.basis.sourceDigest},zeroId);
 await excessFinance(worker,409,'request_review',{},zeroId);
 assert.equal((await zr.collection('directPayment').doc('hourlyFinalObligation').get()).exists,false);
 assert.equal((await zr.collection('directPayment').doc('hourlyStatements').get()).exists,false);
 for(const name of ['receivingDestination','pixSharing']){const saved=(await ref.collection('directPayment').doc(name).get()).data()!;await zr.collection('directPayment').doc(name).set({...saved,offerId:zeroId});}
 const withdrawal=async(actor:Actor,status:number)=>{const r=await fetch('http://127.0.0.1:'+address.port+'/api/freelance/finance?view=pix_withdrawal&offerId='+zeroId,{headers:{authorization:'Bearer '+actor.token}});const v=await r.json();assert.equal(r.status,status,JSON.stringify(v));return v;};
 await withdrawal(owner,403);await withdrawal(other,403);
 assert.deepEqual(await withdrawal(worker,200),{revision:2,sharingAuthorized:true,sharingRevoked:false,sharingSequence:0});
 await excessFinance(worker,200,'revoke_pix_share',{expectedRevision:2,expectedSequence:0},zeroId);
 await excessFinance(worker,200,'revoke_pix_share',{expectedRevision:2,expectedSequence:0},zeroId);
 assert.deepEqual(await withdrawal(worker,200),{revision:2,sharingAuthorized:false,sharingRevoked:true,sharingSequence:1});
 await excessFinance(worker,409,'restore_pix_share',{expectedRevision:2,expectedSequence:1},zeroId);
 assert.equal((await excessFinance(worker,200,undefined,{},zeroId)).financialState,'no_payment_required');
 await zr.collection('directPayment').doc('hourlyFinalObligation').set({fixture:true});
 await excessFinance(owner,409,undefined,{},zeroId);
 await zr.collection('directPayment').doc('hourlyFinalObligation').delete();
 await zr.collection('attendance').doc('timeline').delete();await excessFinance(worker,409,undefined,{},zeroId);

 await ref.collection('directPayment').doc('obligation').set({fixture:true});
 await assert.rejects(recordFreelanceVariablePaymentBasis(owner.uid,id),/VARIABLE_PAYMENT_CONFLICT/);
 await act(owner,id,'record_hourly_basis',400,{confirmed:true});
 // Restore the synthetic positive fixture before testing issuance; no production records.
 await ref.collection('directPayment').doc('obligation').delete();
 await ref.collection('financialBasis').doc('hourlyCompletion').delete();
 await ref.collection('attendance').doc('extensions').set({scheduleId:'schedule',records:[{id:'ext1',extraMinutes:120,proposedBy:'worker',proposedAt:at('12:00'),status:'accepted',decidedBy:'requester',decidedAt:at('12:05')}]});
 await recordFreelanceVariablePaymentBasis(owner.uid,id);
 await assert.rejects(issueFreelanceHourlyFinalObligation(other.uid,id),/FORBIDDEN/);
 const issued=await issueFreelanceHourlyFinalObligation(owner.uid,id);
 assert.equal(issued.final.amountMinor,14000);assert.equal(issued.replay,false);
 assert.equal((await issueFreelanceHourlyFinalObligation(worker.uid,id)).replay,true);
 const finance=async(a:Actor,status:number,action?:string,extra:Record<string,unknown>={},view='case')=>{
  const url='http://127.0.0.1:'+address.port+'/api/freelance/finance'+(action?'':'?view='+view+(view==='restrictions'?'':'&offerId='+id));
  const res=await fetch(url,{method:action?'POST':'GET',headers:{authorization:'Bearer '+a.token,'content-type':'application/json'},...(action?{body:JSON.stringify({offerId:id,action,confirmed:true,...extra})}:{})});
  const body=await res.json();assert.equal(res.status,status,JSON.stringify(body));return body;
 };
 await finance(other,403);
 const financial=await finance(owner,200);assert.equal(financial.amountMinor,14000);assert.equal(financial.amountMode,'hourly_final');
 const sharing=await prep(owner,200);assert.equal(sharing.due,true);assert.equal(sharing.revision,2);assert.equal(sharing.sharingAuthorized,true);assert.equal('key' in sharing,false);
 await prep(other,403,'reveal_pix',{expectedRevision:2});
 await prep(worker,403,'reveal_pix',{expectedRevision:2});
 const revealed=await prep(owner,200,'reveal_pix',{expectedRevision:2});
 assert.equal(revealed.amountMinor,14000);assert.equal(revealed.key,'hourly-new-'+suffix+'@example.invalid');assert.equal(revealed.bankVerified,false);
 await prep(worker,200,'revoke_pix_share',{expectedRevision:2,expectedSequence:0});
 await prep(owner,409,'reveal_pix',{expectedRevision:2});
 await prep(worker,200,'restore_pix_share',{expectedRevision:2,expectedSequence:1});
 const statement={eventId:'hourly-paid',statement:'paid',expectedAmountMinor:14000,sourceDigest:issued.final.sourceDigest};
 await finance(owner,409,'statement',{eventId:'legacy',statement:'paid'});
 await finance(owner,409,'statement',{...statement,expectedAmountMinor:12000});
 await finance(owner,409,'statement',{...statement,sourceDigest:'0'.repeat(64)});
 await finance(worker,403,'statement',statement);
 await finance(owner,200,'statement',statement);await finance(owner,200,'statement',statement);
 await prep(owner,409,'reveal_pix',{expectedRevision:2});
 await finance(worker,200,'statement',{...statement,eventId:'hourly-denied',statement:'not_received'});
 for(const a of [owner,worker])assert.deepEqual(await finance(a,200,undefined,{},'restrictions'),{restricted:true,openOfferIds:[id]});
 await finance(worker,200,'request_review');
 await finance(worker,200,'statement',{...statement,eventId:'hourly-received',statement:'received'});
 assert.equal((await finance(owner,200)).reviewStatus,'resolved_voluntarily');
 for(const a of [owner,worker])assert.deepEqual(await finance(a,200,undefined,{},'restrictions'),{restricted:false,openOfferIds:[]});
 const stored=(await ref.collection('directPayment').doc('hourlyStatements').get()).data()!;
 assert.equal(stored.amountMinor,14000);assert.equal(stored.sourceDigest,issued.final.sourceDigest);assert.equal(stored.events.length,3);
 assert.equal((await ref.collection('directPayment').doc('externalStatements').get()).exists,false);
 await ref.collection('attendance').doc('extensions').delete();await finance(owner,409);

});

test('hourly lifecycle test-only opt-in: actual HTTP contracting, Pix preparation, agenda and atomic completion',async()=>{
 const {createDirectPaymentTerms}=await import('../shared/directPaymentTerms.js');
 const {changePersonalPixDestination}=await import('../server/payments/personalPixDestinationService.js');
 const owner=await account('hourly-flow-owner',['requester']),worker=await account('hourly-flow-worker',['freelancer']);
 const id='http-hourly-flow-'+suffix,ref=db.doc('freelanceOffersV1/'+id);
 const paymentTerms=createDirectPaymentTerms({method:'external_pix',amountMinor:360000});
 const workTerms={mode:'hourly',location:'remote',estimatedMinutes:60,hourlyRateMinor:360000};
 const terms={title:'Jornada horária fictícia',description:'Emulador',requirements:'',paymentMinor:360000,paymentTerms,workTerms};
 const expected={expectedPaymentTerms:paymentTerms,expectedWorkTerms:workTerms};
 const gate='KYRUB_FREELANCE_HOURLY_LIFECYCLE_TEST_ONLY',previous=process.env[gate];
 delete process.env[gate];
 try{
  await act(owner,id,'publish',409,{terms});
  process.env[gate]='true';
  await act(owner,id,'publish',200,{terms});
  await act(worker,id,'apply',200,expected);
  await act(owner,id,'select',200,{applicantUid:worker.uid});
  assert.equal((await ref.collection('directPayment').doc('hourlyCommitment').get()).exists,false);
  await act(worker,id,'confirm',200,{confirmed:true,...expected});
  await act(worker,id,'confirm',200,{confirmed:true,...expected});
  assert.equal((await ref.collection('directPayment').doc('hourlyCommitment').get()).get('estimatedMinor'),360000);
  assert.equal((await ref.collection('directPayment').doc('obligation').get()).exists,false);
  const finance=async(a:Actor,status:number,action?:string,extra:Record<string,unknown>={},view='case')=>{
   const url='http://127.0.0.1:'+address.port+'/api/freelance/finance'+(action?'':'?view='+view+'&offerId='+id);
   const res=await fetch(url,{method:action?'POST':'GET',headers:{authorization:'Bearer '+a.token,'content-type':'application/json'},...(action?{body:JSON.stringify({offerId:id,action,confirmed:true,...extra})}:{})});
   const body=await res.json();assert.equal(res.status,status,JSON.stringify(body));return body;
  };
  await changePersonalPixDestination(worker.uid,{action:'declare',expectedRevision:0,confirmed:true,destination:{keyType:'email',key:'hourly-flow-'+suffix+'@example.invalid'}});
  await finance(worker,200,'bind_pix',{expectedRevision:1});await finance(worker,200,'authorize_pix_share',{expectedRevision:1});
  await finance(owner,409,'reveal_pix',{expectedRevision:1});
  await act(worker,id,'start',409,{confirmed:true});
  const future=new Date(Date.now()+86400000).toISOString();
  await act(owner,id,'propose_schedule',200,{proposalId:'schedule',scheduledStartAt:future,confirmed:true});
  await act(worker,id,'accept_schedule',200,{proposalId:'schedule',confirmed:true});
  await act(owner,id,'attendance_event',200,{kind:'authorize_early_start',eventId:'early',expectedSequence:0,confirmed:true});
  await act(worker,id,'start',200,{confirmed:true});
  await new Promise(resolve=>setTimeout(resolve,100));
  await act(worker,id,'request_completion',200,{confirmed:true});
  assert.equal((await ref.collection('financialBasis').doc('hourlyCompletion').get()).exists,false);
  await act(owner,id,'confirm_completion',200,{confirmed:true});
  await act(owner,id,'confirm_completion',200,{confirmed:true});
  const basis=(await ref.collection('financialBasis').doc('hourlyCompletion').get()).data()!;
  const final=(await ref.collection('directPayment').doc('hourlyFinalObligation').get()).data()!;
  assert.ok(final.amountMinor>0&&final.amountMinor<360000);
  assert.equal(final.amountMinor,basis.finalAmountMinor);assert.equal(final.sourceDigest,basis.sourceDigest);
  assert.equal((await ref.get()).get('status'),'completed');
  assert.equal((await ref.collection('financialBasis').doc('remuneration').get()).exists,false);
  const reveal=await finance(owner,200,'reveal_pix',{expectedRevision:1});assert.equal(reveal.amountMinor,final.amountMinor);
  await finance(owner,200,'statement',{eventId:'paid',statement:'paid',expectedAmountMinor:final.amountMinor,sourceDigest:final.sourceDigest});
  await finance(worker,200,'statement',{eventId:'received',statement:'received',expectedAmountMinor:final.amountMinor,sourceDigest:final.sourceDigest});
  assert.equal((await finance(owner,200)).financialState,'bilaterally_reported_received');
 }finally{if(previous===undefined)delete process.env[gate];else process.env[gate]=previous;}
});

test('hourly cancellation: administrative suspension snapshot, pre-start and worked service, no automatic debt',async t=>{
 const {createDirectPaymentTerms}=await import('../shared/directPaymentTerms.js');
 const {changePersonalPixDestination}=await import('../server/payments/personalPixDestinationService.js');
 const owner=await account('hourly-cancel-owner',['requester']),worker=await account('hourly-cancel-worker',['freelancer']),other=await account('hourly-cancel-other',[]),admin=await account('hourly-cancel-admin',[]);
 await db.doc('kyrub_admin/control_plane/admins/'+admin.uid).set({uid:admin.uid,role:'super_admin',status:'active'});
 const gate='KYRUB_FREELANCE_HOURLY_LIFECYCLE_TEST_ONLY',previous=process.env[gate];process.env[gate]='true';
 const original=auth.verifyIdToken.bind(auth);
 t.mock.method(auth,'verifyIdToken',async(token:string,checkRevoked?:boolean)=>{
  const d=await original(token,checkRevoked);return token===admin.token?{...d,auth_time:Math.floor(Date.now()/1000),firebase:{...d.firebase,sign_in_second_factor:'totp'}}:d;
 });
 try{
  const paymentTerms=createDirectPaymentTerms({method:'external_pix',amountMinor:360000});
  const workTerms={mode:'hourly',location:'remote',estimatedMinutes:60,hourlyRateMinor:360000};
  const terms={title:'Cancelamento horário fictício',description:'Emulador',requirements:'',paymentMinor:360000,paymentTerms,workTerms};
  const expected={expectedPaymentTerms:paymentTerms,expectedWorkTerms:workTerms};
  await changePersonalPixDestination(worker.uid,{action:'declare',expectedRevision:0,confirmed:true,destination:{keyType:'email',key:'hourly-cancel-'+suffix+'@example.invalid'}});
  for(const started of [false,true]){
   const id='hourly-cancel-'+started+'-'+suffix,ref=db.doc('freelanceOffersV1/'+id);
   await act(owner,id,'publish',200,{terms});await act(worker,id,'apply',200,expected);await act(owner,id,'select',200,{applicantUid:worker.uid});await act(worker,id,'confirm',200,{confirmed:true,...expected});
   const finance=async(a:Actor,status:number,action?:string,extra:Record<string,unknown>={},view='hourly_cancellation')=>{
    const url='http://127.0.0.1:'+address.port+'/api/freelance/finance'+(action?'':'?view='+view+'&offerId='+id);
    const res=await fetch(url,{method:action?'POST':'GET',headers:{authorization:'Bearer '+a.token,'content-type':'application/json'},...(action?{body:JSON.stringify({offerId:id,action,confirmed:true,...extra})}:{})});
    const b=await res.json();assert.equal(res.status,status,JSON.stringify(b));return b;
   };
   await finance(worker,200,'bind_pix',{expectedRevision:1});await finance(worker,200,'authorize_pix_share',{expectedRevision:1});
   if(started){
    await act(owner,id,'propose_schedule',200,{proposalId:'schedule',scheduledStartAt:new Date(Date.now()+86400000).toISOString(),confirmed:true});
    await act(worker,id,'accept_schedule',200,{proposalId:'schedule',confirmed:true});
    await act(owner,id,'attendance_event',200,{kind:'authorize_early_start',eventId:'early',expectedSequence:0,confirmed:true});
    await act(worker,id,'start',200,{confirmed:true});
    await new Promise(resolve=>setTimeout(resolve,100));
   }
   const occurrenceId='cancel';
   await act(worker,id,'report',200,{kind:'cancellation_requested',occurrenceId,confirmed:true});
   if(!started){await finance(worker,200,'revoke_pix_share',{expectedRevision:1,expectedSequence:0});await finance(worker,409,'restore_pix_share',{expectedRevision:1,expectedSequence:1});}
   const decision={offerId:id,occurrenceId,outcome:'cancel',reason:'Cancelamento fictício fundamentado',confirmed:true};
   const result=await decideFreelanceReview('Bearer '+admin.token,decision);
   assert.equal(result.replay,false);assert.equal((await decideFreelanceReview('Bearer '+admin.token,decision)).replay,true);
   assert.equal((await ref.get()).get('status'),'cancelled');
   const basis=(await ref.collection('financialBasis').doc('hourlyCancellation').get()).data()!;
   assert.equal(basis.finalAmountMinor,null);assert.equal(basis.recognizedServiceMinor,null);assert.equal(basis.payable,false);
   if(started){assert.ok(basis.accounting.workMs>0);assert.equal(basis.accounting.status,'requires_suspension_review');}
   else assert.equal(basis.accounting,null);
   assert.equal((await ref.collection('directPayment').doc('hourlyFinalObligation').get()).exists,false);
   assert.equal((await ref.collection('financialBasis').doc('remuneration').get()).exists,false);
   await finance(other,403);const view=await finance(worker,200);assert.equal(view.finalAmountMinor,null);assert.equal(view.payable,false);
   await finance(owner,409,'reveal_pix',{expectedRevision:1});
   if(!started){await finance(worker,200,'revoke_pix_share',{expectedRevision:1,expectedSequence:0});assert.equal((await finance(worker,200,undefined,{},'pix_withdrawal')).sharingRevoked,true);}
   const agreement=(a:Actor,status:number)=>finance(a,status,undefined,{},'hourly_cancellation_agreement');
   const financeRestrictions=async(a:Actor)=>{const response=await fetch('http://127.0.0.1:'+address.port+'/api/freelance/finance?view=restrictions',{headers:{authorization:'Bearer '+a.token}});const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;};
   await agreement(other,403);
   const a=await agreement(worker,200);
   assert.equal(a.agreedMinor,null);assert.equal(a.payable,false);
   const proposal={proposalId:'p1',sourceDigest:a.sourceDigest,recognizedServiceMinor:started?Math.min(100,a.capMinor):0};
   await finance(worker,400,'propose_hourly_cancellation',{...proposal,recognizedServiceMinor:a.capMinor+1});
   await finance(worker,409,'propose_hourly_cancellation',{...proposal,sourceDigest:'0'.repeat(64)});
   await finance(worker,200,'propose_hourly_cancellation',proposal);
   await finance(worker,200,'propose_hourly_cancellation',proposal);
   const decisionFields={proposalId:'p1',sourceDigest:a.sourceDigest};
   await finance(worker,403,'accept_hourly_cancellation',decisionFields);
   await finance(owner,403,'withdraw_hourly_cancellation',decisionFields);
   await finance(owner,200,'decline_hourly_cancellation',decisionFields);
   assert.equal((await agreement(owner,200)).restrictionActive,false);
   const disputeFields={sourceDigest:a.sourceDigest};
   await finance(other,403,'dispute_hourly_cancellation',disputeFields);
   await finance(owner,409,'dispute_hourly_cancellation',{sourceDigest:'0'.repeat(64)});
   await finance(worker,200,'dispute_hourly_cancellation',disputeFields);
   await finance(worker,200,'dispute_hourly_cancellation',disputeFields);
   for(const actor of [owner,worker]){
    assert.deepEqual(await financeRestrictions(actor),{restricted:true,openOfferIds:[id]});
   }
   assert.equal((await act(owner,id+'-blocked','publish',409,{terms})).code,'FREELANCE_FINANCIAL_RESTRICTION');
   await finance(owner,200,'request_hourly_cancellation_review',disputeFields);
   await finance(owner,200,'request_hourly_cancellation_review',disputeFields);
   assert.equal((await agreement(worker,200)).dispute.status,'review_requested');
   // A synthetic second restriction cause on the same contract must survive this agreement.
   if(started)for(const actor of [owner,worker])await db.doc('freelanceEngagementRestrictionsV1/'+actor.uid).update({openOfferIds:[id]});
   await finance(owner,200,'propose_hourly_cancellation',{...proposal,proposalId:'p2'});
   await finance(worker,409,'accept_hourly_cancellation',decisionFields);
   const second={...decisionFields,proposalId:'p2'};
   const adminReview=async(actor:Actor,status:number,input?:Record<string,unknown>)=>{
    const url='http://127.0.0.1:'+address.port+'/api/admin/freelance-financial-review'+(input?'':'?view=hourly_cancellation');
    const res=await fetch(url,{method:input?'POST':'GET',headers:{authorization:'Bearer '+actor.token,'content-type':'application/json'},...(input?{body:JSON.stringify(input)}:{})});
    const data=await res.json();assert.equal(res.status,status,JSON.stringify(data));return data;
   };
   await adminReview(other,403);
   const queue=await adminReview(admin,200),item=queue.items.find((v:any)=>v.offerId===id);
   assert.ok(item);assert.equal(item.sourceDigest,a.sourceDigest);
   const adminDecision={action:'decide_hourly_cancellation',offerId:id,sourceDigest:a.sourceDigest,expectedRequestedAt:item.requestedAt,proposalDigest:item.proposalDigest,evidenceDigest:item.evidenceDigest,recognizedServiceMinor:proposal.recognizedServiceMinor,reason:'Decisão fictícia fundamentada',confirmed:true};
   if(started){
    const note={kind:'cancellation',sourceDigest:a.sourceDigest,evidenceId:'cancel-note',note:'Manifestação fictícia sobre o cancelamento.'};
    await finance(worker,200,'submit_hourly_review_note',note);
    await finance(worker,200,'submit_hourly_review_note',note);
    await finance(owner,409,'submit_hourly_review_note',note);
    await adminReview(admin,409,adminDecision);
    const fresh=(await adminReview(admin,200)).items.find((v:any)=>v.offerId===id);
    assert.equal(fresh.notes.length,1);assert.equal(fresh.notes[0].note,note.note);
    Object.assign(adminDecision,{evidenceDigest:fresh.evidenceDigest});
    await adminReview(admin,409,{...adminDecision,proposalDigest:'0'.repeat(64)});
    await adminReview(admin,409,{...adminDecision,sourceDigest:'0'.repeat(64)});
    await adminReview(admin,409,{...adminDecision,recognizedServiceMinor:a.capMinor+1});
    assert.equal((await adminReview(admin,200,adminDecision)).replay,false);
    assert.equal((await adminReview(admin,200,adminDecision)).replay,true);
    await adminReview(admin,409,{...adminDecision,reason:'Outra decisão fictícia fundamentada'});
    await finance(worker,409,'accept_hourly_cancellation',second);
   }else{
    await finance(worker,200,'accept_hourly_cancellation',second);
    await finance(worker,200,'accept_hourly_cancellation',second);
    await adminReview(admin,409,adminDecision);
   }
   assert.ok(!(await adminReview(admin,200)).items.some((v:any)=>v.offerId===id));
   const settled=await agreement(owner,200);
   assert.equal(started?settled.administrativeMinor:settled.agreedMinor,proposal.recognizedServiceMinor);
   assert.equal(settled.dispute.status,started?'resolved_administratively':'resolved_voluntarily');assert.equal(settled.restrictionActive,false);
   for(const actor of [owner,worker]){
    assert.deepEqual(await financeRestrictions(actor),{restricted:started,openOfferIds:started?[id]:[]});
    if(started)await db.doc('freelanceEngagementRestrictionsV1/'+actor.uid).update({openOfferIds:[]});
   }
   assert.equal((await ref.collection('directPayment').doc('hourlyCancellationAgreement-p1').get()).get('status'),'declined');
   const resolution=(await ref.collection('directPayment').doc('hourlyCancellationResolution').get()).data()!;
   assert.equal(resolution.recognizedServiceMinor,proposal.recognizedServiceMinor);
   assert.equal(resolution.disposition,started?'positive_amount_calculated':'no_payment_required');
   assert.equal(settled.payable,started);
   assert.equal((await ref.collection('directPayment').doc('hourlyFinalObligation').get()).exists,started);
   if(started){
    const final=(await ref.collection('directPayment').doc('hourlyFinalObligation').get()).data()!;
    assert.equal(final.kind,'hourly_cancellation_obligation');assert.equal(final.amountMinor,proposal.recognizedServiceMinor);
    assert.equal(final.sourceDigest,resolution.sourceDigest);assert.notEqual(final.sourceDigest,a.sourceDigest);
    const financial=await finance(owner,200,undefined,{},'case');assert.equal(financial.amountMinor,final.amountMinor);assert.equal(financial.due,true);
    const reveal=await finance(owner,200,'reveal_pix',{expectedRevision:1});assert.equal(reveal.amountMinor,final.amountMinor);
    const fields={eventId:'cancel-paid',statement:'paid',expectedAmountMinor:final.amountMinor,sourceDigest:final.sourceDigest};
    await finance(owner,409,'statement',{...fields,expectedAmountMinor:360000});
    await finance(owner,409,'statement',{...fields,sourceDigest:a.sourceDigest});
    await finance(owner,200,'statement',fields);
    await finance(worker,200,'statement',{...fields,eventId:'cancel-denied',statement:'not_received'});
    assert.equal((await finance(owner,200,undefined,{},'case')).financialState,'disputed');
    await finance(worker,200,'statement',{...fields,eventId:'cancel-received',statement:'received'});
    assert.equal((await finance(owner,200,undefined,{},'case')).financialState,'bilaterally_reported_received');
    assert.equal((await agreement(owner,200)).restrictionActive,false);
   }else{
    await finance(owner,409,'reveal_pix',{expectedRevision:1});await finance(owner,409,undefined,{},'case');
    await finance(owner,409,'statement',{eventId:'zero-paid',statement:'paid',expectedAmountMinor:0,sourceDigest:resolution.sourceDigest});
   }
   await finance(owner,409,'propose_hourly_cancellation',{...proposal,proposalId:'p3'});
   if(started){
    await ref.collection('attendance').doc('timeline').delete();
    await agreement(worker,409);
    await finance(worker,409);
   }
  }
 }finally{t.mock.restoreAll();if(previous===undefined)delete process.env[gate];else process.env[gate]=previous;}
});
