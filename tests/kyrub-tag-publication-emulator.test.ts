import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TAG_PUBLICATION_TERMS_VERSION } from '../shared/kyrubTagPublicationTerms.js';

test('promotional Tag: concurrent claim, private save, publication, revocation and recovery', async () => {
  // Validate isolation before importing any Firebase-dependent service.
  assert.equal(process.env.NODE_ENV,'test');
  assert.equal(process.env.FIREBASE_PROJECT_ID,'demo-kyrub-onboarding');
  assert.equal(process.env.GCLOUD_PROJECT,'demo-kyrub-onboarding');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8088');
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');
  assert.ok(!process.env.VERCEL && !process.env.FIREBASE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS);
  assert.equal(process.env.KYRUB_TAG_PROMO_FIRST_CLAIM_ENABLED,'true');
  assert.equal(process.env.KYRUB_TAG_PUBLICATION_ENABLED,'true');
  const {adminAuth,adminDb,getFirebaseAdminProjectId}=await import('../server/firebaseAdmin.js');
  const service=await import('../server/identity/kyrubTagService.js');
  assert.equal(getFirebaseAdminProjectId(),'demo-kyrub-onboarding');
  const suffix=Date.now();
  const users=await Promise.all(['a','b'].map(k=>adminAuth.createUser({email:'tag-'+k+'-'+suffix+'@example.invalid',emailVerified:true})));
  const held=await service.provisionPromotionalKyrubTag();
  const heldRef=adminDb.doc('kyrub_official_tags/'+held.id);
  await heldRef.update({manufacturingState:'held',urlMode:'permanent'});
  const {prepareTagMinimalIdentity:prepareHeld}=await import('../server/identity/kyrubTagMinimalIdentityService.js');
  assert.equal((await service.resolveKyrubTag(held.id))?.activation,'setup');
  for(const user of users){
   await assert.rejects(prepareHeld(user.uid,held.id),/TAG_FORBIDDEN/);
   await assert.rejects(service.claimPromotionalKyrubTag(user.uid,held.id,user.email),/TAG_FORBIDDEN/);
   assert.equal((await adminDb.doc('kyrub_tag_minimal_identities/'+user.uid).get()).exists,false);
  }
  assert.equal((await heldRef.get()).get('ownerId'),null);
  await heldRef.delete();
  const {id}=await service.provisionPromotionalKyrubTag();
  assert.equal((await service.resolveKyrubTag(id))?.status,'unclaimed');
  const results=await Promise.allSettled(users.map(u=>service.claimPromotionalKyrubTag(u.uid,id,u.email)));
  const index=results.findIndex(r=>r.status==='fulfilled');
  assert.ok(index>=0);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const winner=users[index],other=users[1-index];
  const successful=results[index];
  assert.equal(successful.status,'fulfilled');
  if(successful.status!=='fulfilled')throw Error('claim failed');
  const code=successful.value.recoveryCode;
  assert.ok(code);
  const presentation={name:'Cartão teste',occupation:'',about:'',emergencyContacts:[]};
  const acceptance={accepted:true,version:TAG_PUBLICATION_TERMS_VERSION};
  const ageRef=adminDb.doc('age_eligibility_private/'+winner.uid);
  const {promoteTagIdentityToKyrub,getTagIdentityMode,prepareTagMinimalIdentity}=await import('../server/identity/kyrubTagMinimalIdentityService.js');
  assert.equal((await getTagIdentityMode(winner.uid)).mode,'tag_only');
  await assert.rejects(promoteTagIdentityToKyrub(winner.uid),/TAG_PROMOTION_AGE_REQUIRED/);
  await assert.rejects(service.configurePromotionalKyrubTag(other.uid,id,presentation),/TAG_FORBIDDEN/);
  assert.equal((await service.configurePromotionalKyrubTag(winner.uid,id,presentation)).enabled,false);
  assert.equal(await service.resolveKyrubTag(id),null);
  await assert.rejects(service.configurePromotionalKyrubTag(winner.uid,id,presentation,acceptance),/TAG_PUBLICATION_AGE_REQUIRED/);
  await ageRef.set({uid:winner.uid,status:'declared_adult'});
  await assert.rejects(service.configurePromotionalKyrubTag(winner.uid,id,presentation,acceptance),/TAG_PUBLICATION_AGE_REQUIRED/);
  // Synthetic server evidence for this test only; not an actual age verification.
  await ageRef.set({uid:winner.uid,status:'verified_adult'});
  // Separate account-promotion gate remains disabled even for a synthetic adult.
  assert.notEqual(process.env.KYRUB_TAG_FULL_ACCOUNT_RELEASE_ENABLED,'true');
  await assert.rejects(promoteTagIdentityToKyrub(winner.uid),/TAG_PROMOTION_AGE_REQUIRED/);
  assert.equal((await getTagIdentityMode(winner.uid)).mode,'tag_only');
  // Even a synthetic verified adult cannot use the isolated promotion gate without current legal receipts.
  process.env.KYRUB_TAG_FULL_ACCOUNT_RELEASE_ENABLED='true';
  try{
   await assert.rejects(promoteTagIdentityToKyrub(winner.uid),/LEGAL_DOCUMENTS_UNAVAILABLE|LEGAL_CURRENT_RECEIPT_REQUIRED/);
   assert.equal((await getTagIdentityMode(winner.uid)).mode,'tag_only');
  }finally{delete process.env.KYRUB_TAG_FULL_ACCOUNT_RELEASE_ENABLED;}
  // Regression: an existing profile or old full marker must not bypass the
  // same age/receipt authority used by getTagIdentityMode.
  const marker=adminDb.doc('kyrub_tag_minimal_identities/'+winner.uid);
  const savedMarker=(await marker.get()).data();
  assert.ok(savedMarker);
  const legacyAccount=adminDb.doc('users/'+winner.uid);
  await legacyAccount.set({uid:winner.uid});
  try{
   assert.equal((await prepareTagMinimalIdentity(winner.uid,id)).mode,'tag_only');
   await marker.update({mode:'full',ingressReceiptId:'stale-receipt'});
   assert.equal((await prepareTagMinimalIdentity(winner.uid,id)).mode,'tag_only');
   process.env.KYRUB_TAG_FULL_ACCOUNT_RELEASE_ENABLED='true';
   await ageRef.update({status:'suspended'});
   assert.equal((await prepareTagMinimalIdentity(winner.uid,id)).mode,'tag_only');
   await ageRef.update({status:'verified_adult'});
   assert.equal((await prepareTagMinimalIdentity(winner.uid,id)).mode,'tag_only');
   await marker.update({uid:other.uid});
   await assert.rejects(prepareTagMinimalIdentity(winner.uid,id),/TAG_FORBIDDEN/);
  }finally{
   delete process.env.KYRUB_TAG_FULL_ACCOUNT_RELEASE_ENABLED;
   await marker.set(savedMarker!);
   await legacyAccount.delete();
   await ageRef.update({status:'verified_adult'});
  }
  await assert.rejects(service.configurePromotionalKyrubTag(winner.uid,id,presentation,{...acceptance,version:'old'}),/TAG_PUBLICATION_TERMS_REQUIRED/);
  assert.equal((await service.configurePromotionalKyrubTag(winner.uid,id,presentation,acceptance)).enabled,true);
  assert.equal((await service.resolveKyrubTag(id))?.presentation?.name,presentation.name);
  await ageRef.update({status:'inconclusive'});
  assert.equal(await service.resolveKyrubTag(id),null);
  await ageRef.update({status:'verified_adult'});
  await service.setPromotionalBlock(winner.uid,id,true);
  assert.equal(await service.resolveKyrubTag(id),null);
  await service.setPromotionalBlock(winner.uid,id,false);
  assert.equal(await service.resolveKyrubTag(id),null);
  await service.configurePromotionalKyrubTag(winner.uid,id,presentation,acceptance);
  const recovered=await service.recoverPromotionalKyrubTag(other.uid,id,other.email,code);
  assert.equal(recovered.tag.enabled,false);
  assert.equal(recovered.tag.blocked,true);
  assert.equal(await service.resolveKyrubTag(id),null);
  await assert.rejects(service.loadOwnedKyrubTag(winner.uid,id),/TAG_FORBIDDEN/);
  assert.equal((await adminDb.doc('kyrub_official_tags/'+id).get()).get('firstOwnerId'),winner.uid);
  assert.equal((await adminDb.doc('users/'+winner.uid).get()).exists,false);
  assert.equal((await adminDb.doc('users/'+other.uid).get()).exists,false);
});
