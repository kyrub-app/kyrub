import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {after,before,test} from 'node:test';
import {initializeTestEnvironment,assertFails,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,updateDoc} from 'firebase/firestore';

if(!/^(127\.0\.0\.1|localhost):8088$/.test(process.env.FIRESTORE_EMULATOR_HOST??''))throw Error('LOCAL_FIRESTORE_EMULATOR_REQUIRED');
process.env.FIREBASE_PROJECT_ID='kyrub-security-test';
process.env.GCLOUD_PROJECT='kyrub-security-test';
delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
delete process.env.VERCEL;
delete process.env.VERCEL_ENV;
const {adminDb,getFirebaseAdminProjectId}=await import('../server/firebaseAdmin.js');
const s=await import('../server/freelance/freelanceLifecycleService.js');
const funding=await import('../server/freelance/freelanceFundingService.js');
let env:RulesTestEnvironment;
const owner='fixture-freelance-owner',worker='fixture-freelance-worker',other='fixture-freelance-other';
const input={title:'Serviço de teste',description:'Somente emulador',requirements:'',paymentMinor:15000};
const ref=(id:string)=>adminDb.doc('freelanceOffersV1/'+id);
before(async()=>{
  assert.equal(getFirebaseAdminProjectId(),'kyrub-security-test');
  env=await initializeTestEnvironment({projectId:'kyrub-security-test',firestore:{host:'127.0.0.1',port:8088,rules:readFileSync('.firebase/firestore.combined.rules','utf8')}});
  await env.clearFirestore();
  await Promise.all([adminDb.doc('identity_verifications/'+owner).set({status:'approved',approvedProfiles:['requester']}),
    ...[worker,other].map(uid=>adminDb.doc('identity_verifications/'+uid).set({status:'approved',approvedProfiles:['freelancer']}))]);
});
after(async()=>{if(env)await env.cleanup();await adminDb.terminate();});
test('verified publication, application race, exclusive selection and one remuneration basis',async()=>{
 const id='fixture-freelance-normal';
 await assert.rejects(s.publishFreelanceOffer('unverified',id,input),/IDENTITY_VERIFICATION_REQUIRED/);
 const publications=await Promise.all([s.publishFreelanceOffer(owner,id,input),s.publishFreelanceOffer(owner,id,input)]);
 assert.deepEqual(publications.map(x=>x.created).sort(),[false,true]);
 await assert.rejects(s.publishFreelanceOffer(owner,id,{...input,paymentMinor:1}),/FREELANCE_CONFLICT/);
 await assert.rejects(s.applyToFreelanceOffer('unverified',id),/IDENTITY_VERIFICATION_REQUIRED/);
 const apps=await Promise.all([s.applyToFreelanceOffer(worker,id),s.applyToFreelanceOffer(worker,id)]);
 assert.deepEqual(apps.map(x=>x.created).sort(),[false,true]);
 await s.applyToFreelanceOffer(other,id);
 const selections=await Promise.allSettled([s.selectFreelanceApplication(owner,id,worker),s.selectFreelanceApplication(owner,id,other)]);
 assert.equal(selections.filter(x=>x.status==='fulfilled').length,1);
 const selected=(await ref(id).get()).get('selectedApplicantUid') as string;
 assert.ok([worker,other].includes(selected));
 const loser=selected===worker?other:worker;
 await assert.rejects(s.confirmFreelanceContract(loser,id,true),/FREELANCE_FORBIDDEN/);
 await s.confirmFreelanceContract(selected,id,true);
 await assert.rejects(s.recordFreelanceExecution(selected,id,'start',true),/FREELANCE_FUNDING_REQUIRED/);
 await assert.rejects(funding.confirmSimulatedFreelanceFunding(id,'fixture-payment-normal',1,owner,selected),/FREELANCE_FUNDING_CONFLICT/);
 await assert.rejects(funding.confirmSimulatedFreelanceFunding(id,'fixture-payment-normal',15000,owner,loser),/FREELANCE_FUNDING_CONFLICT/);
 const payments=await Promise.all([funding.confirmSimulatedFreelanceFunding(id,'fixture-payment-normal',15000,owner,selected),funding.confirmSimulatedFreelanceFunding(id,'fixture-payment-normal',15000,owner,selected)]);
 assert.deepEqual(payments.map(x=>x.created).sort(),[false,true]);
 await s.recordFreelanceExecution(selected,id,'start',true);
 await assert.rejects(funding.revokeSimulatedFreelanceFunding(id,'fixture-payment-normal'),/FREELANCE_FUNDING_CONFLICT/);
 await s.recordFreelanceExecution(selected,id,'request_completion',true);
 await assert.rejects(s.recordFreelanceExecution(selected,id,'confirm_completion',true),/FREELANCE_FORBIDDEN/);
 const completions=await Promise.all([s.recordFreelanceExecution(owner,id,'confirm_completion',true),s.recordFreelanceExecution(owner,id,'confirm_completion',true)]);
 assert.deepEqual(completions.map(x=>x.changed).sort(),[false,true]);
 const basis=await ref(id).collection('financialBasis').get();
 assert.equal(basis.size,1);
 assert.equal(basis.docs[0].get('confirmedServiceMinor'),15000);
 assert.equal(basis.docs[0].get('beneficiaryUid'),selected);
 assert.equal(basis.docs[0].get('settlement'),'not_verified');
 assert.equal(basis.docs[0].get('responsibility'),'not_determined');
 assert.equal((await ref(id).get()).get('status'),'completed');
});
test('occurrence and completion compete atomically; browser cannot bypass server',async()=>{
 const id='fixture-freelance-race';
 await s.publishFreelanceOffer(owner,id,input);
 await s.applyToFreelanceOffer(worker,id);
 await s.selectFreelanceApplication(owner,id,worker);
 await s.confirmFreelanceContract(worker,id,true);
 await assert.rejects(funding.confirmSimulatedFreelanceFunding(id,'fixture-payment-normal',15000,owner,worker),/FREELANCE_FUNDING_CONFLICT/);
 await funding.confirmSimulatedFreelanceFunding(id,'fixture-payment-race',15000,owner,worker);
 await s.recordFreelanceExecution(worker,id,'start',true);
 await s.recordFreelanceExecution(worker,id,'request_completion',true);
 const race=await Promise.allSettled([s.reportFreelanceOccurrence(worker,id,'service_disputed',true,'fixture-review'),s.recordFreelanceExecution(owner,id,'confirm_completion',true)]);
 assert.equal(race.filter(x=>x.status==='fulfilled').length,1);
 const status=(await ref(id).get()).get('status');
 const bases=await ref(id).collection('financialBasis').get(),occurrences=await ref(id).collection('occurrences').get();
 assert.ok(['under_review','completed'].includes(status));
 assert.equal(bases.size,status==='completed'?1:0);
 assert.equal(occurrences.size,status==='under_review'?1:0);
 for(const uid of [owner,worker,'unrelated']){
   const db=env.authenticatedContext(uid).firestore();
   const path='freelanceOffersV1/'+id;
   await assertFails(getDoc(doc(db,path)));
   await assertFails(updateDoc(doc(db,path),{status:'completed'}));
   await assertFails(setDoc(doc(db,path+'/financialBasis/remuneration'),{confirmedServiceMinor:1}));
   await assertFails(setDoc(doc(db,path+'/funding/confirmation'),{status:'confirmed'}));
   await assertFails(getDoc(doc(db,path+'/funding/confirmation')));
   await assertFails(setDoc(doc(db,path+'/applications/'+uid),{status:'contracted'}));
   await assertFails(setDoc(doc(db,path+'/occurrences/forged'),{status:'resolved'}));
 }
});

test('funding revocation races with start, and simulation cannot run in Vercel',async()=>{
 const id='fixture-freelance-funding-race',paymentId='fixture-payment-revocation';
 await s.publishFreelanceOffer(owner,id,input);
 await s.applyToFreelanceOffer(worker,id);
 await s.selectFreelanceApplication(owner,id,worker);
 await s.confirmFreelanceContract(worker,id,true);
 process.env.VERCEL_ENV='production';
 try{
  await assert.rejects(funding.confirmSimulatedFreelanceFunding(id,paymentId,15000,owner,worker),/FREELANCE_FUNDING_PROVIDER_NOT_ENABLED/);
  await assert.rejects(s.recordFreelanceExecution(worker,id,'start',true),/FREELANCE_FUNDING_PROVIDER_NOT_ENABLED/);
 }finally{delete process.env.VERCEL_ENV;}
 await funding.confirmSimulatedFreelanceFunding(id,paymentId,15000,owner,worker);
 const race=await Promise.allSettled([funding.revokeSimulatedFreelanceFunding(id,paymentId),s.recordFreelanceExecution(worker,id,'start',true)]);
 assert.equal(race.filter(x=>x.status==='fulfilled').length,1);
 const offer=(await ref(id).get()).data(),saved=(await ref(id).collection('funding').doc('confirmation').get()).data();
 if(offer?.status==='contracted'){
  assert.equal(saved?.status,'revoked');
  await assert.rejects(s.recordFreelanceExecution(worker,id,'start',true),/FREELANCE_FUNDING_REQUIRED/);
 }else{
  assert.equal(offer?.status,'in_progress');assert.equal(saved?.status,'confirmed');
 }
});

test('read workspace excludes other participants private records',async()=>{
 const {readFreelanceWorkspace}=await import('../server/freelance/freelanceWorkspaceReadService.js');
 const id='fixture-freelance-read';
 await s.publishFreelanceOffer(owner,id,input);
 await s.applyToFreelanceOffer(worker,id);
 await s.applyToFreelanceOffer(other,id);
 const mine=await readFreelanceWorkspace(worker,'detail',id);
 assert.deepEqual(mine.applications?.map(a=>a.applicantUid),[worker]);
 const own=await readFreelanceWorkspace(owner,'detail',id);
 assert.equal(own.applications?.length,2);
 assert.equal(JSON.stringify(mine).includes(other),false);
 await s.selectFreelanceApplication(owner,id,worker);
 await assert.rejects(readFreelanceWorkspace('unrelated','detail',id),/FREELANCE_FORBIDDEN/);
 const workerList=await readFreelanceWorkspace(worker,'applications');
 assert.ok(workerList.items?.some(i=>i.id===id));
 const ownerList=await readFreelanceWorkspace(owner,'owner');
 assert.ok(ownerList.items?.some(i=>i.id===id));
});

test('personal earnings and alerts expose only authenticated participant records',async()=>{
 const {readFreelancePersonalSummary}=await import('../server/freelance/freelancePersonalReadService.js');
 const id='fixture-freelance-summary';
 await s.publishFreelanceOffer(owner,id,input);await s.applyToFreelanceOffer(worker,id);
 const initial=await readFreelancePersonalSummary(owner,'alerts');
 assert.ok(initial.alerts?.some(a=>a.offerId===id&&a.state==='applications_pending'));
 await s.selectFreelanceApplication(owner,id,worker);await s.confirmFreelanceContract(worker,id,true);
 const projected=await readFreelancePersonalSummary(worker,'earnings');
 assert.ok(projected.entries?.some(e=>e.offerId===id&&e.state==='projected'&&e.receivedMinor===null));
 await funding.confirmSimulatedFreelanceFunding(id,'fixture-summary-payment',15000,owner,worker);
 await s.recordFreelanceExecution(worker,id,'start',true);await s.recordFreelanceExecution(worker,id,'request_completion',true);await s.recordFreelanceExecution(owner,id,'confirm_completion',true);
 const earned=await readFreelancePersonalSummary(worker,'earnings');
 assert.ok(earned.entries?.some(e=>e.offerId===id&&e.confirmedServiceMinor===15000&&e.receivedMinor===null));
 assert.equal(earned.receivedMinor,null);
 const unrelated=await readFreelancePersonalSummary('unrelated','earnings');
 assert.deepEqual(unrelated.entries,[]);assert.equal(unrelated.receivedMinor,null);
 const own=await readFreelancePersonalSummary(owner,'earnings');
 assert.ok(!own.entries?.some(e=>e.offerId===id));
});
