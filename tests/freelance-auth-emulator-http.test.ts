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
 const {recordFreelanceExternalPaymentStatement:record}=await import('../server/freelance/freelanceExternalPaymentStatementService.js');
 await record(payer.uid,id,{eventId:'paid',statement:'paid',confirmed:true});
 await call(payer,409,id,'reveal_pix');
 for(const otherId of ids.slice(1)){await call(worker,200,otherId,'bind_pix');await call(worker,200,otherId,'authorize_pix_share');}
 assert.equal((await call(payer,200,ids[1])).due,false);await call(payer,409,ids[1],'reveal_pix');
 await changePersonalPixDestination(worker.uid,{action:'declare',expectedRevision:1,confirmed:true,destination:{keyType:'email',key:'new-'+key}});
 await call(payer,409,ids[2],'reveal_pix');
 await changePersonalPixDestination(worker.uid,{action:'revoke',expectedRevision:2,confirmed:true});
 await call(payer,409,ids[2],'reveal_pix');
 assert.equal((await db.doc('freelanceOffersV1/'+ids[2]+'/directPayment/pixDisclosure').get()).exists,false);
});

test('direct publication HTTP: canonical terms, explicit acceptance, immutable obligation, execution still gated',async()=>{
 const {createDirectPaymentTerms}=await import('../shared/directPaymentTerms.js');
 const payer=await account('terms-payer',['requester']),worker=await account('terms-worker',['freelancer']);
 const id='http-direct-terms-'+suffix,base={title:'Freela Pix fictício',description:'Somente emulador',requirements:'',paymentMinor:15000};
 const terms=createDirectPaymentTerms({method:'external_pix',amountMinor:15000});
 const advance=createDirectPaymentTerms({method:'external_pix',timing:'advance',amountMinor:15000});
 const mp=createDirectPaymentTerms({method:'mercado_pago',amountMinor:15000});
 await act(payer,id,'publish',409,{terms:{...base,paymentTerms:mp}});
 await act(payer,id,'publish',400,{terms:{...base,paymentTerms:{...terms,platformCommissionMinor:10}}});
 await act(payer,id,'publish',200,{terms:{...base,paymentTerms:terms}});
 await act(payer,id,'publish',409,{terms:{...base,paymentTerms:advance}});
 const visible=(await call(worker,'?view=detail&offerId='+id,200)).item;
 assert.deepEqual(visible.paymentTerms,terms);
 await act(worker,id,'apply',409);await act(worker,id,'apply',409,{expectedPaymentTerms:advance});
 await act(worker,id,'apply',200,{expectedPaymentTerms:terms});
 await act(payer,id,'select',200,{applicantUid:worker.uid});
 await act(worker,id,'confirm',409,{confirmed:true,expectedPaymentTerms:advance});
 await act(worker,id,'confirm',409,{confirmed:true});
 await act(worker,id,'confirm',200,{confirmed:true,expectedPaymentTerms:terms});
 const ref=db.doc('freelanceOffersV1/'+id);
 assert.deepEqual((await ref.collection('directPayment').doc('obligation').get()).get('terms'),terms);
 assert.deepEqual((await ref.collection('applications').doc(worker.uid).get()).get('paymentTerms'),terms);
 assert.equal((await act(worker,id,'start',409,{confirmed:true})).code,'FREELANCE_DIRECT_PAYMENT_NOT_ENABLED');
});
