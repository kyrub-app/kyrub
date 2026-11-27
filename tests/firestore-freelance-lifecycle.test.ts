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

test('workspace pages and visible candidate names do not expose reserved profile data',async()=>{
 const {readFreelanceWorkspace}=await import('../server/freelance/freelanceWorkspaceReadService.js');
 const {readFreelancePersonalSummary}=await import('../server/freelance/freelancePersonalReadService.js');
 const id='fixture-freelance-visible';
 await s.publishFreelanceOffer(owner,id,input);
 await s.applyToFreelanceOffer(worker,id);await s.applyToFreelanceOffer(other,id);
 await adminDb.doc('users/'+worker).set({uid:worker,name:'Nome público',isProfileVisible:true,email:'private-worker@example.invalid'});
 await adminDb.doc('users/'+other).set({uid:other,name:'Nome reservado',isProfileVisible:false,email:'private-other@example.invalid'});
 const result=await readFreelanceWorkspace(owner,'detail',id);
 assert.equal(result.applications?.find(a=>a.applicantUid===worker)?.publicName,'Nome público');
 assert.equal(result.applications?.find(a=>a.applicantUid===other)?.publicName,null);
 assert.doesNotMatch(JSON.stringify(result),/private-worker|private-other|Nome reservado/);
 await s.selectFreelanceApplication(owner,id,worker);await s.confirmFreelanceContract(worker,id,true);
 const alerts=await readFreelancePersonalSummary(other,'alerts');
 assert.ok(alerts.alerts?.some(a=>a.offerId===id&&a.state==='not_selected'));
 for(let i=0;i<21;i++)await s.publishFreelanceOffer(owner,'fixture-page-'+String(i).padStart(2,'0'),input);
 const first=await readFreelanceWorkspace(owner,'owner');
 assert.equal(first.items?.length,20);assert.ok(first.nextCursor);
 const second=await readFreelanceWorkspace(owner,'owner',undefined,first.nextCursor);
 assert.ok(second.items?.length);
 assert.ok(second.items?.every(a=>!first.items?.some(b=>a.id===b.id)));
 await assert.rejects(readFreelanceWorkspace(owner,'owner',undefined,'bad/path'),/FREELANCE_INVALID/);
});

test('private personal receiving destination: declared only, masked response, revision race and revocation',async()=>{
 const {changePersonalPixDestination,readPersonalPixDestination}=await import('../server/payments/personalPixDestinationService.js');
 const uid='fixture-personal-receiving';
 const base='financialProfilesV1/'+uid, path=base+'/receiving/externalPix';
 assert.deepEqual(await readPersonalPixDestination(uid),{revision:0,status:'not_configured',ownershipVerified:false});
 await assert.rejects(changePersonalPixDestination(uid,{action:'declare',expectedRevision:0,confirmed:true,destination:{keyType:'email',key:'bad'}}),/PERSONAL_PIX_INVALID/);
 await assert.rejects(changePersonalPixDestination(uid,{action:'declare',expectedRevision:0,confirmed:true,destination:{keyType:'email',key:'test@example.test'},userId:other}),/PERSONAL_PIX_INVALID/);
 const results=await Promise.allSettled(['one@example.test','two@example.test'].map(key=>changePersonalPixDestination(uid,{action:'declare',expectedRevision:0,confirmed:true,destination:{keyType:'email',key}})));
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 const saved=await readPersonalPixDestination(uid);
 assert.equal(saved.status,'declared');assert.equal(saved.revision,1);assert.equal(saved.ownershipVerified,false);
 assert.equal('key' in saved,false);
 assert.deepEqual((await adminDb.doc(base).get()).get('capabilities'),[]);
 assert.equal((await readPersonalPixDestination(other)).status,'not_configured');
 for(const actor of [uid,other]){
  const db=env.authenticatedContext(actor).firestore();
  await assertFails(getDoc(doc(db,path)));
  await assertFails(getDoc(doc(db,base)));
  await assertFails(setDoc(doc(db,path),{status:'verified'}));
 }
 await assert.rejects(changePersonalPixDestination(uid,{action:'revoke',expectedRevision:0,confirmed:true}),/PERSONAL_PIX_CONFLICT/);
 const revoked=await changePersonalPixDestination(uid,{action:'revoke',expectedRevision:1,confirmed:true});
 assert.equal(revoked.status,'revoked');assert.equal(revoked.revision,2);
 assert.equal((await adminDb.doc(path).get()).get('key'),undefined);
 assert.equal((await adminDb.doc(path).get()).get('keyType'),undefined);
});

test('CID personal Pix import: authoritative linkage, masked choices, source version and explicit replacement',async()=>{
 const {listPersonalCidPixCandidates,importPersonalCidPixDestination,readPersonalPixDestination}=await import('../server/payments/personalPixDestinationService.js');
 const uid='fixture-cid-import',outsider='fixture-cid-outsider',tagId='a'.repeat(32),corporateId='b'.repeat(32);
 const tag=adminDb.doc('kyrub_official_tags/'+tagId),corporate=adminDb.doc('kyrub_official_tags/'+corporateId);
 const ownerId='tagpk_'+'x'.repeat(43),pix={keyType:'email',key:'fixture-cid@example.invalid',recipientName:'Pessoa Teste',recipientCity:'BRASILIA',publicConsent:true};
 const card={distribution:'promotional',model:'adesivo',manufacturingState:'released',ownerAuthMode:'passkey',ownerId,firstOwnerId:ownerId,linkedAccountId:uid,linkedAccountAt:'2026-11-27T00:00:00Z',enabled:true,blocked:false,presentation:{name:'Teste',occupation:'',about:'',pix}};
 await Promise.all([adminDb.doc('users/'+uid).set({uid}),adminDb.doc('users/'+outsider).set({uid:outsider}),...([uid,outsider].map(id=>adminDb.doc('identity_verifications/'+id).set({status:'approved',approvedProfiles:['freelancer']}))),tag.set(card),corporate.set({...card,presentation:{...card.presentation,pix:{...pix,keyType:'cnpj',key:'04.252.011/0001-10'}}})]);
 try{
  const list=await listPersonalCidPixCandidates(uid);
  assert.equal(list.candidates.length,1);
  const choice=list.candidates[0];
  assert.equal(choice.cidId,tagId);assert.equal(choice.keyType,'email');assert.equal(choice.maskedKey,'••••alid');assert.equal(choice.ownershipVerified,false);
  assert.ok(!JSON.stringify(list).includes(pix.key));assert.deepEqual(await listPersonalCidPixCandidates(outsider),{candidates:[]});
  const request={action:'import_cid',cidId:choice.cidId,sourceVersion:choice.sourceVersion,expectedRevision:0,confirmed:true,replaceExisting:false};
  await assert.rejects(importPersonalCidPixDestination(outsider,request),/PERSONAL_CID_UNAVAILABLE/);
  await assert.rejects(importPersonalCidPixDestination(uid,{...request,key:pix.key}),/PERSONAL_PIX_INVALID/);
  await assert.rejects(importPersonalCidPixDestination(uid,{...request,confirmed:false}),/PERSONAL_PIX_INVALID/);
  await tag.update({blocked:true,enabled:false});
  await assert.rejects(importPersonalCidPixDestination(uid,request),/PERSONAL_CID_UNAVAILABLE/);
  await tag.update({blocked:false,enabled:true});
  await assert.rejects(importPersonalCidPixDestination(uid,request),/PERSONAL_CID_CHANGED/);
  const next=(await listPersonalCidPixCandidates(uid)).candidates[0];
  const fresh={...request,sourceVersion:next.sourceVersion};
  const races=await Promise.allSettled([importPersonalCidPixDestination(uid,fresh),importPersonalCidPixDestination(uid,fresh)]);
  assert.equal(races.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await readPersonalPixDestination(uid)).revision,1);
  await assert.rejects(importPersonalCidPixDestination(uid,{...fresh,expectedRevision:1}),/PERSONAL_PIX_CONFLICT/);
  const changed={...pix,key:'replacement@example.invalid'};
  await tag.update({'presentation.pix':changed});
  const financial=adminDb.doc('financialProfilesV1/'+uid+'/receiving/externalPix');
  assert.equal((await financial.get()).get('key'),pix.key);
  const updated=(await listPersonalCidPixCandidates(uid)).candidates[0];
  await importPersonalCidPixDestination(uid,{...fresh,expectedRevision:1,sourceVersion:updated.sourceVersion,replaceExisting:true});
  assert.equal((await financial.get()).get('key'),changed.key);
  await tag.update({'presentation.pix':null});
  assert.deepEqual(await listPersonalCidPixCandidates(uid),{candidates:[]});
  assert.equal((await financial.get()).get('key'),changed.key);
  await assert.rejects(importPersonalCidPixDestination(uid,{...fresh,expectedRevision:2,replaceExisting:true,sourceVersion:updated.sourceVersion}),/PERSONAL_CID_UNAVAILABLE/);
 }finally{await Promise.all([tag.delete(),corporate.delete()]);}
});

test('direct freelance terms: exact immutable offer and application snapshot; no funding bypass',async()=>{
 const {createDirectPaymentTerms}=await import('../shared/directPaymentTerms.js');
 const {normalizeFreelanceOffer}=await import('../shared/freelanceLifecycle.js');
 const {readFreelanceWorkspace}=await import('../server/freelance/freelanceWorkspaceReadService.js');
 const {executeFreelanceWorkspaceAction}=await import('../server/freelance/freelanceWorkspaceTransport.js');
 const id='fixture-direct-terms',paymentTerms=createDirectPaymentTerms({method:'external_pix',amountMinor:input.paymentMinor});
 const direct={...input,paymentTerms};
 assert.equal(paymentTerms.timing,'on_completion');assert.equal(paymentTerms.platformCommissionMinor,0);
 for(const patch of [{platformCommissionMinor:1},{amountMinor:1},{providerFeeResponsibility:'kyrub'},{settlement:'verified'},{timing:'partial'}])assert.throws(()=>normalizeFreelanceOffer({...direct,paymentTerms:{...paymentTerms,...patch}}),/FREELANCE_INVALID/);
 await assert.rejects(executeFreelanceWorkspaceAction(owner,{action:'publish',offerId:id,terms:direct}),/FREELANCE_DIRECT_PAYMENT_NOT_ENABLED/);
 assert.equal((await ref(id).get()).exists,false);
 await s.publishFreelanceOffer(owner,id,direct);
 const terms=(await ref(id).get()).get('paymentTerms');
 assert.deepEqual(terms,paymentTerms);
 const visible=await readFreelanceWorkspace(worker,'detail',id);
 assert.deepEqual((visible as {item?:{paymentTerms?:unknown}}).item?.paymentTerms,paymentTerms);
 await assert.rejects(s.publishFreelanceOffer(owner,id,input),/FREELANCE_CONFLICT/);
 await assert.rejects(s.publishFreelanceOffer(owner,id,{...direct,paymentTerms:{...paymentTerms,timing:'advance'}}),/FREELANCE_CONFLICT/);
 const application=(await s.applyToFreelanceOffer(worker,id)).application;
 assert.deepEqual(application.paymentTerms,paymentTerms);
 const app=ref(id).collection('applications').doc(worker);
 await app.update({'paymentTerms.method':'mercado_pago'});
 await assert.rejects(s.applyToFreelanceOffer(worker,id),/FREELANCE_CONFLICT/);
 await assert.rejects(s.selectFreelanceApplication(owner,id,worker),/FREELANCE_CONFLICT/);
 await app.update({paymentTerms});
 await s.selectFreelanceApplication(owner,id,worker);
 await s.confirmFreelanceContract(worker,id,true);
 assert.deepEqual((await ref(id).get()).get('paymentTerms'),paymentTerms);
 assert.deepEqual((await app.get()).get('paymentTerms'),paymentTerms);
 await assert.rejects(s.recordFreelanceExecution(worker,id,'start',true),/FREELANCE_DIRECT_PAYMENT_NOT_ENABLED/);
 assert.equal((await ref(id).get()).get('status'),'contracted');
 assert.equal((await ref(id).collection('financialBasis').get()).size,0);
});

test('direct payment obligation is created atomically with bilateral contract, not settlement',async()=>{
 const {createDirectPaymentTerms}=await import('../shared/directPaymentTerms.js');
 for(const timing of ['advance','on_completion'] as const){
  const id='fixture-obligation-'+timing,offer=ref(id),obligation=offer.collection('directPayment').doc('obligation');
  const terms=createDirectPaymentTerms({method:'external_pix',timing,amountMinor:input.paymentMinor});
  await s.publishFreelanceOffer(owner,id,{...input,paymentTerms:terms});
  await s.applyToFreelanceOffer(worker,id);await s.selectFreelanceApplication(owner,id,worker);
  assert.equal((await obligation.get()).exists,false);
  await assert.rejects(s.confirmFreelanceContract(owner,id,true),/FREELANCE_FORBIDDEN/);
  await assert.rejects(s.confirmFreelanceContract(worker,id,false),/FREELANCE_INVALID/);
  assert.equal((await obligation.get()).exists,false);
  const results=await Promise.all([s.confirmFreelanceContract(worker,id,true),s.confirmFreelanceContract(worker,id,true)]);
  assert.deepEqual(results.map(x=>x.changed).sort(),[false,true]);
  const snapshot=(await obligation.get()).data()!;
  assert.deepEqual(snapshot,{schemaVersion:1,offerId:id,requesterUid:owner,beneficiaryUid:worker,
   terms,contractedAt:(await offer.get()).get('contractedAt'),dueTrigger:timing==='advance'?'contract_confirmation':'bilateral_service_completion',custody:'none'});
  assert.equal((await offer.collection('directPayment').get()).size,1);
  assert.equal((await offer.collection('financialBasis').get()).size,0);
  assert.equal((await offer.collection('funding').get()).size,0);
  await assert.rejects(funding.confirmSimulatedFreelanceFunding(id,'fixture-direct-funding-'+timing,input.paymentMinor,owner,worker),/FREELANCE_FUNDING_CONFLICT/);
  await assert.rejects(s.recordFreelanceExecution(worker,id,'start',true),/FREELANCE_DIRECT_PAYMENT_NOT_ENABLED/);
  for(const uid of [owner,worker,other]){
   const db=env.authenticatedContext(uid).firestore();
   await assertFails(getDoc(doc(db,obligation.path)));
   await assertFails(setDoc(doc(db,obligation.path),{settlement:'verified'}));
  }
  await obligation.update({'terms.amountMinor':1});
  await assert.rejects(s.confirmFreelanceContract(worker,id,true),/FREELANCE_PAYMENT_OBLIGATION_CONFLICT/);
  await obligation.set(snapshot);
  assert.equal((await s.confirmFreelanceContract(worker,id,true)).changed,false);
 }
 const legacy='fixture-obligation-legacy';
 await s.publishFreelanceOffer(owner,legacy,input);await s.applyToFreelanceOffer(worker,legacy);
 await s.selectFreelanceApplication(owner,legacy,worker);await s.confirmFreelanceContract(worker,legacy,true);
 assert.equal((await ref(legacy).collection('directPayment').doc('obligation').get()).exists,false);
});

test('direct contract Pix destination pins revision, rejects foreign actors and never copies raw key',async()=>{
 const {createDirectPaymentTerms}=await import('../shared/directPaymentTerms.js');
 const {changePersonalPixDestination}=await import('../server/payments/personalPixDestinationService.js');
 const {bindFreelancePixDestination}=await import('../server/freelance/freelancePixDestinationService.js');
 const id='fixture-pinned-pix',offer=ref(id),binding=offer.collection('directPayment').doc('receivingDestination');
 const terms=createDirectPaymentTerms({method:'external_pix',amountMinor:input.paymentMinor});
 await s.publishFreelanceOffer(owner,id,{...input,paymentTerms:terms});
 await s.applyToFreelanceOffer(worker,id);await s.selectFreelanceApplication(owner,id,worker);await s.confirmFreelanceContract(worker,id,true);
 const request={expectedRevision:1,confirmed:true};
 await assert.rejects(bindFreelancePixDestination(owner,id,request),/FREELANCE_FORBIDDEN/);
 await assert.rejects(bindFreelancePixDestination(other,id,request),/FREELANCE_FORBIDDEN/);
 await assert.rejects(bindFreelancePixDestination(worker,id,request),/FREELANCE_PIX_DESTINATION_REQUIRED/);
 const key='pinned-fixture@example.invalid';
 await changePersonalPixDestination(worker,{action:'declare',expectedRevision:0,confirmed:true,destination:{keyType:'email',key}});
 await assert.rejects(bindFreelancePixDestination(worker,id,{...request,confirmed:false}),/FREELANCE_INVALID/);
 await assert.rejects(bindFreelancePixDestination(worker,id,{...request,key}),/FREELANCE_INVALID/);
 const results=await Promise.all([bindFreelancePixDestination(worker,id,request),bindFreelancePixDestination(worker,id,request)]);
 assert.deepEqual(results.map(x=>x.created).sort(),[false,true]);
 const saved=(await binding.get()).data()!;
 assert.equal(saved.destinationRevision,1);assert.equal(saved.beneficiaryUid,worker);assert.equal(saved.ownershipVerified,false);
 assert.ok(!JSON.stringify(saved).includes(key));assert.equal('key' in saved,false);
 for(const uid of [owner,worker,other]){
  const db=env.authenticatedContext(uid).firestore();
  await assertFails(getDoc(doc(db,binding.path)));
  await assertFails(setDoc(doc(db,binding.path),{destinationRevision:2}));
 }
 await changePersonalPixDestination(worker,{action:'declare',expectedRevision:1,confirmed:true,destination:{keyType:'random',key:'123e4567-e12b-12d1-a456-426655440000'}});
 await assert.rejects(bindFreelancePixDestination(worker,id,request),/FREELANCE_PIX_DESTINATION_CHANGED/);
 await assert.rejects(bindFreelancePixDestination(worker,id,{...request,expectedRevision:2}),/FREELANCE_PIX_DESTINATION_CHANGED/);
 await changePersonalPixDestination(worker,{action:'revoke',expectedRevision:2,confirmed:true});
 await assert.rejects(bindFreelancePixDestination(worker,id,{...request,expectedRevision:3}),/FREELANCE_PIX_DESTINATION_REQUIRED/);
 assert.deepEqual((await binding.get()).data(),saved);
});

test('bilateral financial restriction blocks new engagement in either role; each open case must be resolved',async()=>{
 const {createDirectPaymentTerms}=await import('../shared/directPaymentTerms.js');
 const {prepareVoluntaryDisputeRestriction}=await import('../server/freelance/freelanceEngagementRestrictionService.js');
 const {buildFreelancePaymentObligation}=await import('../shared/freelancePaymentObligation.js');
 const {appendExternalPixStatement}=await import('../shared/freelanceExternalPaymentStatements.js');
 const payer='fixture-restricted-payer',beneficiary='fixture-restricted-worker',unrelated='fixture-restricted-unrelated';
 for(const uid of [payer,beneficiary,unrelated])await adminDb.doc('identity_verifications/'+uid).set({status:'approved',approvedProfiles:['requester','freelancer']});
 const cases=[];
 for(const id of ['fixture-restriction-first','fixture-restriction-second']){
  await s.publishFreelanceOffer(payer,id,{...input,paymentTerms:createDirectPaymentTerms({method:'external_pix',timing:'advance',amountMinor:input.paymentMinor})});
  await s.applyToFreelanceOffer(beneficiary,id);await s.selectFreelanceApplication(payer,id,beneficiary);
  const result=await s.confirmFreelanceContract(beneficiary,id,true);
  cases.push(buildFreelancePaymentObligation(result.offer,result.application));
 }
 await s.publishFreelanceOffer(unrelated,'fixture-restriction-available',input);
 await s.publishFreelanceOffer(payer,'fixture-restriction-open',input);
 await s.applyToFreelanceOffer(beneficiary,'fixture-restriction-available');
 await s.publishFreelanceOffer(unrelated,'fixture-restriction-selected',input);
 await s.applyToFreelanceOffer(beneficiary,'fixture-restriction-selected');
 await s.selectFreelanceApplication(unrelated,'fixture-restriction-selected',beneficiary);
 const histories=new Map<string,import('../shared/freelanceExternalPaymentStatements.js').ExternalPixEvent[]>();
 async function statement(o:typeof cases[number],kind:'paid'|'not_received'|'received',uid:string){
  const before=histories.get(o.offerId)??[];
  const next=appendExternalPixStatement(o,before,{id:'event-'+(before.length+1),actorUid:uid,statement:kind,recordedAt:new Date().toISOString()});
  await adminDb.runTransaction(async tx=>{const write=await prepareVoluntaryDisputeRestriction(tx,o,before,next.events);write();});
  histories.set(o.offerId,next.events);
 }
 await statement(cases[0],'paid',payer);await statement(cases[0],'not_received',beneficiary);
 await statement(cases[1],'not_received',beneficiary);await statement(cases[1],'paid',payer);
 for(const uid of [payer,beneficiary]){
  const restriction=adminDb.doc('freelanceEngagementRestrictionsV1/'+uid);
  assert.equal((await restriction.get()).get('openOfferIds').length,2);
  await assert.rejects(s.publishFreelanceOffer(uid,'fixture-block-'+uid,input),/FREELANCE_FINANCIAL_RESTRICTION/);
  await s.publishFreelanceOffer(unrelated,'fixture-new-application-'+uid,input);
  await assert.rejects(s.applyToFreelanceOffer(uid,'fixture-new-application-'+uid),/FREELANCE_FINANCIAL_RESTRICTION/);
  const db=env.authenticatedContext(uid).firestore();
  await assertFails(getDoc(doc(db,restriction.path)));
  await assertFails(setDoc(doc(db,restriction.path),{openOfferIds:[]}));
 }
 await assert.rejects(s.applyToFreelanceOffer(unrelated,'fixture-restriction-open'),/FREELANCE_FINANCIAL_RESTRICTION/);
 await assert.rejects(s.selectFreelanceApplication(unrelated,'fixture-restriction-available',beneficiary),/FREELANCE_FINANCIAL_RESTRICTION/);
 await assert.rejects(s.confirmFreelanceContract(beneficiary,'fixture-restriction-selected',true),/FREELANCE_FINANCIAL_RESTRICTION/);
 await s.withdrawPendingFreelanceApplication(beneficiary,'fixture-restriction-available',true);
 await s.releaseFreelanceReservation(unrelated,'fixture-restriction-selected',beneficiary,true);
 await statement(cases[0],'received',beneficiary);
 await assert.rejects(s.publishFreelanceOffer(payer,'fixture-still-blocked',input),/FREELANCE_FINANCIAL_RESTRICTION/);
 await statement(cases[1],'received',beneficiary);
 for(const uid of [payer,beneficiary]){
  assert.deepEqual((await adminDb.doc('freelanceEngagementRestrictionsV1/'+uid).get()).get('openOfferIds'),[]);
  await s.publishFreelanceOffer(uid,'fixture-restored-'+uid,input);
 }
});

test('external statements persist with bilateral restrictions atomically, including concurrent declarations and voluntary release',async()=>{
 const {recordFreelanceExternalPaymentStatement:record}=await import('../server/freelance/freelanceExternalPaymentStatementService.js');
 const {createDirectPaymentTerms}=await import('../shared/directPaymentTerms.js');
 const payer='fixture-statement-payer',beneficiary='fixture-statement-worker',outsider='fixture-statement-outsider';
 for(const uid of [payer,beneficiary,outsider])await adminDb.doc('identity_verifications/'+uid).set({status:'approved',approvedProfiles:['requester','freelancer']});
 const create=async(id:string,timing:'advance'|'on_completion')=>{
  await s.publishFreelanceOffer(payer,id,{...input,paymentTerms:createDirectPaymentTerms({method:'external_pix',timing,amountMinor:input.paymentMinor})});
  await s.applyToFreelanceOffer(beneficiary,id);await s.selectFreelanceApplication(payer,id,beneficiary);await s.confirmFreelanceContract(beneficiary,id,true);
 };
 const id='fixture-real-statements',hist=ref(id).collection('directPayment').doc('externalStatements');
 await create(id,'advance');await create('fixture-statements-not-due','on_completion');
 const paid={eventId:'payer-paid',statement:'paid',confirmed:true},notReceived={eventId:'worker-not-received',statement:'not_received',confirmed:true};
 await assert.rejects(record(payer,'fixture-statements-not-due',paid),/FREELANCE_PAYMENT_NOT_DUE/);
 await assert.rejects(record(outsider,id,paid),/FREELANCE_FORBIDDEN/);
 await assert.rejects(record(beneficiary,id,paid),/FREELANCE_FORBIDDEN/);
 await assert.rejects(record(payer,id,{...paid,amountMinor:1}),/FREELANCE_INVALID/);
 assert.equal((await hist.get()).exists,false);
 const results=await Promise.all([record(payer,id,paid),record(beneficiary,id,notReceived)]);
 assert.ok(results.some(r=>r.state==='disputed'));assert.ok(results.every(r=>r.bankVerified===false));
 const initial=(await hist.get()).get('events');assert.equal(initial.length,2);
 for(const uid of [payer,beneficiary]){
  assert.deepEqual((await adminDb.doc('freelanceEngagementRestrictionsV1/'+uid).get()).get('openOfferIds'),[id]);
  await assert.rejects(s.publishFreelanceOffer(uid,'fixture-statement-blocked-'+uid,input),/FREELANCE_FINANCIAL_RESTRICTION/);
  const db=env.authenticatedContext(uid).firestore();
  await assertFails(getDoc(doc(db,hist.path)));await assertFails(setDoc(doc(db,hist.path),{events:[]}));
 }
 const replay=await record(payer,id,paid);assert.equal(replay.changed,false);assert.equal(replay.state,'disputed');
 await assert.rejects(record(payer,id,{...paid,eventId:'payer-second-paid'}),/FREELANCE_PAYMENT_STATEMENT_CONFLICT/);
 assert.deepEqual((await hist.get()).get('events'),initial);
 const received={eventId:'worker-received',statement:'received',confirmed:true};
 const resolved=await record(beneficiary,id,received);assert.equal(resolved.state,'bilaterally_reported_received');
 assert.equal(resolved.hadDisagreement,true);assert.equal(resolved.bankVerified,false);
 const final=(await hist.get()).get('events');assert.equal(final.length,3);assert.deepEqual(final.slice(0,2),initial);
 assert.equal((await record(beneficiary,id,received)).changed,false);
 for(const uid of [payer,beneficiary]){
  assert.deepEqual((await adminDb.doc('freelanceEngagementRestrictionsV1/'+uid).get()).get('openOfferIds'),[]);
  await s.publishFreelanceOffer(uid,'fixture-statement-restored-'+uid,input);
 }
 assert.equal((await ref(id).get()).get('status'),'contracted');
});
