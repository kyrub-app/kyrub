import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { adminDb } from '../server/firebaseAdmin.js';
import { reserveSocialAddress, resolveSocialAddress, getOwnedSocialAddress } from '../server/identity/publicSocialAddressService.js';
import { saveOwnedCard, loadOwnedCard, resolvePublicCard, disableOwnedCard } from '../server/identity/publicVisitCardService.js';
if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST??''))throw Error('LOCAL_FIRESTORE_EMULATOR_REQUIRED');
if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST??''))throw Error('LOCAL_AUTH_EMULATOR_REQUIRED');
const projectId='demo-public-visit-card';
process.env.FIREBASE_PROJECT_ID=projectId;
delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
delete process.env.VERCEL;
let env:RulesTestEnvironment;
before(async()=>{
 env=await initializeTestEnvironment({projectId,firestore:{rules:await readFile('.firebase/firestore.combined.rules','utf8')}});
 await env.clearFirestore();
 await Promise.all([
   adminDb.doc('users/owner-a').set({name:'Alice',isProfileVisible:true,email:'private@example.test'}),
   adminDb.doc('users/owner-a/public_profile/main').set({name:'Alice',bio:'Public bio',photoUrl:''}),
   adminDb.doc('users/owner-b').set({name:'Bob',isProfileVisible:true}),
   adminDb.doc('communities/rock-1').set({ownerId:'owner-a',name:'Rock',visibility:'public',description:'Music'}),
   adminDb.doc('communities/hidden-1').set({ownerId:'owner-a',name:'Private',visibility:'private'}),
   adminDb.doc('tenants/store-a').set({id:'store-a',slug:'shop-a',name:'Shop A',publicationStatus:'published',publicProducts:[]})
 ]);
});
after(async()=>{await env?.cleanup();});
test('isolated lifecycle: collisions, ownership, persistent card, live privacy, store binding and revocation',async()=>{
 const results=await Promise.allSettled([
   reserveSocialAddress('owner-a','profile','unique-alice'),
   reserveSocialAddress('owner-b','profile','unique-alice')
 ]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 const a=await getOwnedSocialAddress('owner-a','profile');
 const alice=a.identifier??'alice-other';
 if(!a.identifier)await reserveSocialAddress('owner-a','profile',alice);
 await reserveSocialAddress('owner-a','profile',alice);
 await assert.rejects(reserveSocialAddress('owner-a','profile','different-alice'),/PUBLIC_ADDRESS_CONFLICT/);
 await assert.rejects(reserveSocialAddress('owner-b','community','rock','rock-1'),/PUBLIC_ADDRESS_FORBIDDEN/);
 await assert.rejects(reserveSocialAddress('owner-a','community','hidden','hidden-1'),/PUBLIC_ADDRESS_FORBIDDEN/);
 await reserveSocialAddress('owner-a','community','rock','rock-1');
 const profile=await resolveSocialAddress('profile',alice);
 assert.equal(profile?.name,'Alice');
 assert.equal(JSON.stringify(profile).includes('private@example.test'),false);
 const urls=['https://kyrub.com/kairubido/'+alice,'https://kyrub.com/@shop-a','https://kyrub.com/comunidade/rock'];
 await assert.rejects(saveOwnedCard('owner-b',[urls[0]]),/CARD_TARGET_UNAVAILABLE/);
 const created=await Promise.all([saveOwnedCard('owner-a',urls),saveOwnedCard('owner-a',urls)]);
 assert.equal(created[0].id,created[1].id);
 const id=created[0].id;
 const result=await resolvePublicCard(id);
 assert.equal(result?.links.length,3);
 assert.deepEqual(result?.links.map(x=>x.url),urls);
 assert.equal(JSON.stringify(result).includes('owner-a'),false);
 for (const link of result?.links??[]) assert.deepEqual(Object.keys(link).sort(),['identifier','kind','name','url']);
 assert.equal(await loadOwnedCard('owner-b'),null);
 assert.equal(await disableOwnedCard('owner-b'),null);
 const browser=env.authenticatedContext('owner-a').firestore();
 const anon=env.unauthenticatedContext().firestore();
 for(const path of ['public_visit_cards/'+id,'public_visit_card_owners/owner-a','public_social_addresses/profile:'+alice,'public_social_address_targets/profile:owner-a']){
   await assertFails(getDoc(doc(anon,path)));
   await assertFails(getDoc(doc(browser,path)));
   await assertFails(setDoc(doc(browser,path),{enabled:true}));
 }
 await adminDb.doc('users/owner-a/public_profile/main').update({name:'Alice renamed'});
 assert.equal((await resolvePublicCard(id))?.links[0].name,'Alice renamed');
 await adminDb.doc('users/owner-a').update({isProfileVisible:false});
 await adminDb.doc('communities/rock-1').update({visibility:'private'});
 assert.deepEqual((await resolvePublicCard(id))?.links.map(x=>x.kind),['store']);
 assert.equal(await resolveSocialAddress('profile',alice),null);
 assert.equal(await resolveSocialAddress('community','rock'),null);
 await adminDb.doc('tenants/store-a').update({publicationStatus:'draft'});
 assert.deepEqual((await resolvePublicCard(id))?.links,[]);
 await adminDb.doc('tenants/store-b').set({id:'store-b',slug:'shop-a',name:'Different shop',publicationStatus:'published',publicProducts:[]});
 assert.deepEqual((await resolvePublicCard(id))?.links,[]);
 assert.equal((await disableOwnedCard('owner-a'))?.enabled,false);
 assert.equal(await resolvePublicCard(id),null);
 await adminDb.doc('users/owner-a').update({isProfileVisible:true});
 const updated=await saveOwnedCard('owner-a',[urls[0]]);
 assert.equal(updated.id,id);
 assert.deepEqual((await loadOwnedCard('owner-a'))?.urls,[urls[0]]);
 assert.equal((await resolvePublicCard(id))?.links.length,1);
});

test('official physical units are permanently bound, private by default and individually revocable',async()=>{
 const {provisionKyrubTag,claimKyrubTag,configureKyrubTag,disableKyrubTag,resolveKyrubTag,listOwnedKyrubTags}=await import('../server/identity/kyrubTagService.js');
 const {resolveKyrubAppRoute}=await import('../src/utils/appRoutes.js');
 const a=await provisionKyrubTag('pitanga'),b=await provisionKyrubTag('pulseira');
 assert.notEqual(a.id,b.id);assert.equal(resolveKyrubAppRoute('/tag/'+a.id).kind,'public-tag');
 assert.equal((await resolveKyrubTag(a.id))?.status,'unclaimed');
 assert.equal(JSON.stringify(await resolveKyrubTag(a.id)).includes(a.code),false);
 await assert.rejects(claimKyrubTag('owner-a',a.id,'0'.repeat(32)),/TAG_FORBIDDEN/);
 const claims=await Promise.allSettled([claimKyrubTag('owner-a',a.id,a.code),claimKyrubTag('owner-b',a.id,a.code)]);
 assert.equal(claims.filter(x=>x.status==='fulfilled').length,1);
 const actor=claims[0].status==='fulfilled'?'owner-a':'owner-b',other=actor==='owner-a'?'owner-b':'owner-a';
 assert.equal(await resolveKyrubTag(a.id),null);
 assert.equal((await adminDb.doc('kyrub_official_tags/'+a.id).get()).data()?.activationHash,null);
 await assert.rejects(claimKyrubTag(other,a.id,a.code),/TAG_FORBIDDEN/);
 await claimKyrubTag(actor,b.id,b.code);
 await adminDb.doc('communities/rock-1').update({visibility:'public'});
 const urls=['https://kyrub.com/comunidade/rock'];
 await configureKyrubTag(actor,a.id,urls);await configureKyrubTag(actor,b.id,urls);
 await assert.rejects(configureKyrubTag(other,a.id,urls),/TAG_FORBIDDEN/);
 await assert.rejects(disableKyrubTag(other,a.id),/TAG_FORBIDDEN/);
 const projected=await resolveKyrubTag(a.id);
 assert.deepEqual(Object.keys(projected??{}).sort(),['id','links','model','status']);
 for(const link of projected?.links??[])assert.deepEqual(Object.keys(link).sort(),['identifier','kind','name','url']);
 await disableKyrubTag(actor,a.id);
 assert.equal(await resolveKyrubTag(a.id),null);assert.equal((await resolveKyrubTag(b.id))?.links.length,1);
 await assert.rejects(claimKyrubTag(other,a.id,a.code),/TAG_FORBIDDEN/);
 await configureKyrubTag(actor,a.id,urls);assert.equal((await resolveKyrubTag(a.id))?.links.length,1);
 assert.equal((await listOwnedKyrubTags(actor)).tags.length,2);
 const browser=env.authenticatedContext(actor).firestore(),anon=env.unauthenticatedContext().firestore();
 const path='kyrub_official_tags/'+a.id;
 await assertFails(getDoc(doc(browser,path)));await assertFails(getDoc(doc(anon,path)));await assertFails(setDoc(doc(browser,path),{ownerId:other}));
});

test('pilot issuance authority, one unit, code recovery and audit are transactionally enforced',async()=>{
 const {readPilot,mutatePilot,handlePilot}=await import('../server/admin/kyrubTagPilotService.js');
 const {claimKyrubTag,claimReservedKyrubTag,resolveKyrubTag,loadOwnedKyrubTag}=await import('../server/identity/kyrubTagService.js');
 const {adminAuth}=await import('../server/firebaseAdmin.js');
 if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST??''))throw Error('LOCAL_AUTH_EMULATOR_REQUIRED');
 const password='pilot-emulator-only-password';
 async function login(uid:string,role:string,status:string){
  const email=uid+'@example.test';
  await adminAuth.createUser({uid,email,password,emailVerified:true});
  await adminDb.doc('kyrub_admin/control_plane/admins/'+uid).set({uid,role,status});
  const res=await fetch('http://'+process.env.FIREBASE_AUTH_EMULATOR_HOST+'/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
  assert.equal(res.ok,true);const data=await res.json() as {idToken:string};assert.ok(data.idToken);return 'Bearer '+data.idToken;
 }
 const admin=await login('pilot-admin','super_admin','active'),user=await login('pilot-user','operations','active'),suspended=await login('pilot-suspended','super_admin','suspended');
 const action={action:'issue',email:'owner-a@example.test'};
 assert.equal((await handlePilot('','POST',action)).status,401);
 assert.equal((await handlePilot(user,'POST',action)).status,403);
 assert.equal((await handlePilot(suspended,'POST',action)).status,403);
 assert.deepEqual(await readPilot('pilot-admin'),{unit:null});
 const issued=await Promise.all([handlePilot(admin,'POST',action),handlePilot(admin,'POST',action)]);
 assert.deepEqual(issued.map(x=>x.status).sort(),[200,409]);
 const fresh=issued.find(x=>x.status===200)?.body as Awaited<ReturnType<typeof mutatePilot>>;
 assert.equal(fresh.unit.reserved,true);assert.equal(fresh.unit.model,'adesivo');
 assert.equal((await resolveKyrubTag(fresh.unit.id))?.activation,'account');
 assert.equal((await adminDb.doc('kyrub_official_tags/'+fresh.unit.id).get()).get('activationHash'),null);
 // Reset only this isolated emulator slot to exercise upgrade of an existing physical tag.
 await adminDb.doc('kyrub_official_tags/'+fresh.unit.id).delete();
 await adminDb.doc('kyrub_tag_pilot_lots/experimental-001/units/001').delete();
 // Simulate a previously issued code-only pilot, with the real immutable tag ID.
 const legacy=await (await import('../server/identity/kyrubTagService.js')).provisionKyrubTag('adesivo');
 await adminDb.doc('kyrub_official_tags/'+legacy.id).update({pilotBatch:'experimental-001',pilotSlot:'001'});
 await adminDb.doc('kyrub_tag_pilot_lots/experimental-001/units/001').set({tagId:legacy.id});
 assert.equal((await resolveKyrubTag(legacy.id))?.activation,'code');
 const reserve=await handlePilot(admin,'POST',{action:'reserve',email:'owner-a@example.test'});
 assert.equal(reserve.status,200);
 const id=legacy.id;
 assert.equal((await readPilot('pilot-admin')).unit?.id,id);
 assert.equal((await readPilot('pilot-admin')).unit?.reserved,true);
 assert.equal((await resolveKyrubTag(id))?.activation,'account');
 assert.equal(JSON.stringify(await resolveKyrubTag(id)).includes('owner-a@example.test'),false);
 assert.equal(JSON.stringify(reserve.body).includes('email'),false);
 assert.equal((await handlePilot(admin,'POST',action)).status,409);
 await assert.rejects(claimKyrubTag('owner-b',id,legacy.code),/TAG_FORBIDDEN/);
 await assert.rejects(claimReservedKyrubTag('owner-b',id,'wrong@example.test'),/TAG_FORBIDDEN/);
 const recipient=await login('pilot-recipient','operations','active');
 await adminDb.doc('users/pilot-recipient').set({name:'Recipient'});
 await mutatePilot('pilot-admin','reserve','pilot-recipient@example.test');
 await assert.rejects(claimReservedKyrubTag('owner-a',id,'owner-a@example.test'),/TAG_FORBIDDEN/);
 await assert.rejects(claimReservedKyrubTag('owner-b',id,'pilot-recipient@example.test'),/TAG_FORBIDDEN/);
 const api=(await import('../api/health.js')).default;
 async function runClaim(authorization:string){
  let status=0,body:unknown;
  const response={setHeader(){},status(n:number){status=n;return response;},json(value:unknown){body=value;}};
  await api({method:'POST',headers:{authorization},query:{transport:'manage-kyrub-tag',id},body:{action:'claim-reserved'}} as never,response as never);
  return {status,body};
 }
 assert.equal((await runClaim('')).status,401);
 assert.equal((await runClaim(user)).status,403);
 const claims=await Promise.all([runClaim(recipient),runClaim(recipient)]);
 assert.deepEqual(claims.map(x=>x.status),[200,200]);
 assert.equal((await loadOwnedKyrubTag('pilot-recipient',id)).id,id);
 await assert.rejects(loadOwnedKyrubTag('owner-b',id),/TAG_FORBIDDEN/);
 await assert.rejects(mutatePilot('pilot-admin','reserve','owner-b@example.test'),/PILOT_ALREADY_CLAIMED/);
 const events=await adminDb.collection('kyrub_admin/control_plane/audit_logs').where('targetId','==',id).get();
 assert.equal(events.size,2);assert.equal(JSON.stringify(events.docs.map(d=>d.data())).includes('@example.test'),false);
 const browser=env.authenticatedContext('pilot-admin').firestore(),anon=env.unauthenticatedContext().firestore();
 const path='kyrub_tag_pilot_lots/experimental-001/units/001';
 await assertFails(setDoc(doc(browser,path),{tagId:'fake'}));await assertFails(getDoc(doc(anon,path)));
 await adminDb.doc('kyrub_admin/control_plane/admins/pilot-admin').update({status:'revoked'});
 assert.equal((await handlePilot(admin,'GET',null)).status,403);
});

test('visual tag destinations use public names, opt-in and safe external links without changing ownership',async()=>{
 const {provisionKyrubTag,claimKyrubTag,loadTagDestinationCatalog,configureKyrubTag,resolveKyrubTag,loadOwnedKyrubTag,disableKyrubTag}=await import('../server/identity/kyrubTagService.js');
 const {buildTagExternalUrl,parseTagExternalUrl}=await import('../shared/kyrubTagContract.js');
 const a=await provisionKyrubTag('adesivo');
 await claimKyrubTag('owner-a',a.id,a.code);
 await adminDb.doc('users/owner-a').update({isProfileVisible:true});
 await adminDb.doc('communities/rock-1').update({visibility:'public'});
 const list=await loadTagDestinationCatalog('owner-a',a.id);
 assert.ok(list.options.some(o=>o.kind==='profile'));
 assert.ok(list.options.some(o=>o.kind==='community'&&o.name==='Rock'));
 assert.equal(new Set(list.options.map(o=>o.url)).size,list.options.length);
 assert.equal(JSON.stringify(list).includes('private@example.test'),false);
 assert.equal(JSON.stringify(list).includes('bindingId'),false);
 await assert.rejects(loadTagDestinationCatalog('owner-b',a.id),/TAG_FORBIDDEN/);
 const wa=buildTagExternalUrl('whatsapp','+55 11 99999-9999')!;
 const ig=buildTagExternalUrl('instagram','@example.name')!;
 assert.equal(wa,'https://wa.me/5511999999999');
 assert.equal(ig,'https://www.instagram.com/example.name/');
 for(const bad of ['javascript:alert(1)','https://wa.me.evil.test/5511999999999','https://wa.me/5511999999999?text=spam','https://www.instagram.com/accounts/login/','https://www.instagram.com/accounts/','https://user@wa.me/5511999999999','https://evil.test/']){
  assert.equal(parseTagExternalUrl(bad),null);
  await assert.rejects(configureKyrubTag('owner-a',a.id,[bad]),/INVALID_CARD/);
 }
 const profile=list.options.find(o=>o.kind==='profile')!;
 await configureKyrubTag('owner-a',a.id,[profile.url,wa,ig]);
 assert.equal((await resolveKyrubTag(a.id))?.links.length,3);
 assert.deepEqual((await loadOwnedKyrubTag('owner-a',a.id)).urls,[profile.url,wa,ig]);
 await adminDb.doc('users/owner-a').update({isProfileVisible:false});
 assert.deepEqual((await resolveKyrubTag(a.id))?.links.map(l=>l.kind),['whatsapp','instagram']);
 const refreshed=await loadTagDestinationCatalog('owner-a',a.id);
 assert.equal(refreshed.profile.eligible,false);
 assert.ok(refreshed.unavailable.includes(profile.url));
 await configureKyrubTag('owner-a',a.id,[wa]);
 assert.equal((await resolveKyrubTag(a.id))?.links.length,1);
 await disableKyrubTag('owner-a',a.id);
 assert.equal(await resolveKyrubTag(a.id),null);
 assert.deepEqual((await loadOwnedKyrubTag('owner-a',a.id)).urls,[wa]);
 await assert.rejects(configureKyrubTag('owner-b',a.id,[ig]),/TAG_FORBIDDEN/);
 await adminDb.doc('users/owner-a').update({isProfileVisible:true});
});

test('official test history cleanup archives atomically and refuses provider, inventory and finance evidence',async()=>{
 const {createHash}=await import('node:crypto');
 const {inspectOfficialTestHistory}=await import('../server/admin/mercadoPagoTestHistoryCleanupService.js');
 const official='store-ae53dc42e57eb9d5c3f7151c1431',tenant='cleanup-tenant';
 await adminDb.doc('kyrub_admin/control_plane/admins/cleanup-admin').set({uid:'cleanup-admin',role:'super_admin',status:'active'});
 await adminDb.doc('kyrub_admin/control_plane/admins/cleanup-reader').set({uid:'cleanup-reader',role:'operations',status:'active'});
 await adminDb.doc('tenants/'+tenant).set({id:tenant,ownerId:tenant,publicationStatus:'published',name:'Kyrub Oficial'});
 await adminDb.doc('stores/'+official).set({id:official,ownerId:tenant,legacyTenantId:tenant,name:'Kyrub Oficial'});
 for(let i=0;i<5;i++)await adminDb.doc('artifacts/'+tenant+'/public/data/customerOrders/o'+i).set({
  id:'o'+i,storeId:tenant,status:i===4?'pending':'completed',paymentStatus:i===4?'unpaid':'paid',total:10
 });
 for(let i=0;i<2;i++)await adminDb.doc('stores/'+official+'/paymentIntents/i'+i).set({
  id:'i'+i,storeId:official,status:i===0?'pending':'expired',provider:'',providerIntentId:''
 });
 for(let i=0;i<4;i++)await adminDb.doc('stores/'+official+'/payments/p'+i).set({
  id:'p'+i,storeId:official,status:i===0?'pending':'expired',provider:'',providerPaymentId:''
 });
 await adminDb.doc('stores/'+official+'/orders/o0').set({id:'o0',storeId:official,status:'completed',paymentStatus:'paid'});
 await assert.rejects(inspectOfficialTestHistory('cleanup-reader'),/TEST_HISTORY_FORBIDDEN/);
 const ready=await inspectOfficialTestHistory('cleanup-admin');
 assert.deepEqual(ready.counts,{orders:5,intents:2,payments:4});
 assert.deepEqual(ready.blocked,[]);
 assert.equal(ready.canExecute,true);
 const payment=adminDb.doc('stores/'+official+'/payments/p0');
 await payment.update({providerPaymentId:'EXTERNAL-PAYMENT-DO-NOT-DELETE'});
 const external=await inspectOfficialTestHistory('cleanup-admin');
 assert.ok(external.blocked.includes('REFERENCIA_EXTERNA'));
 await assert.rejects(inspectOfficialTestHistory('cleanup-admin',ready.digest,true),/TEST_HISTORY_STALE_PREVIEW/);
 assert.equal((await payment.get()).exists,true);
 await payment.update({providerPaymentId:''});
 const ledger=adminDb.doc('stores/'+official+'/economicLedger/test-entry');
 await ledger.set({orderId:'o0',kind:'payment_capture'});
 const ledgerPreflight=await inspectOfficialTestHistory('cleanup-admin');
 assert.ok(ledgerPreflight.blocked.includes('HISTORICO_FINANCEIRO_ASSOCIADO'));
 assert.equal(ledgerPreflight.evidence.find(x=>x.kind==='economicLedger')?.count,1);
 assert.equal(ledgerPreflight.evidence.find(x=>x.kind==='economicLedger')?.explicitLinks,1);
 await ledger.delete();
 const reservationId=createHash('sha256').update(tenant+':o1').digest('hex');
 const reservation=adminDb.doc('inventoryOrderReservations/'+reservationId);
 await reservation.set({tenantId:tenant,orderId:'o1',status:'reserved'});
 assert.ok((await inspectOfficialTestHistory('cleanup-admin')).blocked.includes('RESERVA_ESTOQUE_ASSOCIADA'));
 await reservation.delete();
 const safe=await inspectOfficialTestHistory('cleanup-admin');
 assert.deepEqual(safe.blocked,[]);
 const success=await inspectOfficialTestHistory('cleanup-admin',safe.digest,true);
 assert.equal(success.archived,true);
 assert.deepEqual(success.counts,{orders:5,intents:2,payments:4});
 assert.equal((await adminDb.collection('artifacts/'+tenant+'/public/data/customerOrders').get()).size,0);
 assert.equal((await adminDb.collection('stores/'+official+'/paymentIntents').get()).size,0);
 assert.equal((await adminDb.collection('stores/'+official+'/payments').get()).size,0);
 assert.equal((await adminDb.doc('stores/'+official+'/orders/o0').get()).exists,false);
 const archive='kyrub_admin/control_plane/financial_test_cleanup_runs/kyrub-oficial-test-history-2026-11-v1';
 assert.equal((await adminDb.doc(archive).get()).exists,true);
 assert.equal((await adminDb.collection(archive+'/records').get()).size,12);
 assert.equal((await adminDb.doc('stores/'+official).get()).exists,true);
 assert.equal((await adminDb.doc('tenants/'+tenant).get()).exists,true);
 await assert.rejects(inspectOfficialTestHistory('cleanup-admin',safe.digest,true),/TEST_HISTORY_STALE_PREVIEW|TEST_HISTORY_BLOCKED/);
 assert.ok((await inspectOfficialTestHistory('cleanup-admin')).blocked.includes('LIMPEZA_ANTERIOR'));
});


test('promotional first-claimer and recovery end-to-end through Firebase Auth + Firestore emulators',async()=>{
 if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST??''))throw Error('LOCAL_AUTH_EMULATOR_REQUIRED');
 const {
  provisionPromotionalKyrubTag,provisionKyrubTag,
  configureKyrubTag,loadTagDestinationCatalog,
  loadOwnedKyrubTag,resolveKyrubTag,rotatePromotionalRecoveryCode
 }=await import('../server/identity/kyrubTagService.js');
 const {adminAuth}=await import('../server/firebaseAdmin.js');
 const api=(await import('../api/health.js')).default;
 const originalFlag=process.env.KYRUB_TAG_PROMO_FIRST_CLAIM_ENABLED;
 async function createIdentity(uid:string,verified:boolean){
  const email=uid+'@example.test',password='isolated-strong-password-only';
  await adminAuth.createUser({uid,email,password,emailVerified:verified});
  const response=await fetch('http://'+process.env.FIREBASE_AUTH_EMULATOR_HOST+'/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{
   method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})
  });
  assert.equal(response.ok,true);
  const result=await response.json() as {idToken:string};
  assert.ok(result.idToken);
  return {uid,email,token:result.idToken};
 }
 async function http(tagId:string,method:'GET'|'POST',token:string|null,body?:Record<string,unknown>,publicView=false){
  let status=0,result:unknown;
  const response={
   setHeader(_name:string,_value:string){},
   status(n:number){status=n;return response;},
   json(value:unknown){result=value;}
  };
  await api({
   method,
   headers:token?{authorization:'Bearer '+token}:{},
   query:{transport:publicView?'public-kyrub-tag':'manage-kyrub-tag',id:tagId},
   ...(body?{body}:{}),
  } as never,response as never);
  return {status,body:result};
 }
 try{
  delete process.env.KYRUB_TAG_PROMO_FIRST_CLAIM_ENABLED;
  await assert.rejects(provisionPromotionalKyrubTag(),/TAG_PROMO_DISABLED/);
  process.env.KYRUB_TAG_PROMO_FIRST_CLAIM_ENABLED='true';
  const promo=await provisionPromotionalKyrubTag(),legacy=await provisionKyrubTag('adesivo');
  assert.notEqual(promo.id,legacy.id);
  assert.equal((await resolveKyrubTag(promo.id))?.activation,'email');
  assert.equal((await resolveKyrubTag(legacy.id))?.activation,'code');
  assert.equal((await http(promo.id,'GET',null,undefined,true)).status,200);
  const [one,two,third,unverified]=await Promise.all([
   createIdentity('tag-promo-one',true),
   createIdentity('tag-promo-two',true),
   createIdentity('tag-promo-third',true),
   createIdentity('tag-promo-unverified',false),
  ]);
  assert.equal((await http(promo.id,'POST',unverified.token,{action:'claim-promotional'})).status,403);
  assert.equal((await http(legacy.id,'POST',one.token,{action:'claim-promotional'})).status,403);
  const fresh=await provisionPromotionalKyrubTag();
  const draft={name:'Cartão antes do e-mail',occupation:'Autônomo',about:'Rascunho preservado'};
  const [pubOne,pubTwo]=await Promise.all([createIdentity('tag-pub-one',true),createIdentity('tag-pub-two',true)]);
  assert.equal((await http(fresh.id,'POST',unverified.token,{action:'claim-and-publish-promotional',presentation:draft})).status,403);
  assert.equal((await http(legacy.id,'POST',one.token,{action:'claim-and-publish-promotional',presentation:draft})).status,403);
  assert.equal((await resolveKyrubTag(fresh.id))?.activation,'email');
  const publishRace=await Promise.all([pubOne,pubTwo].map(identity=>http(fresh.id,'POST',identity.token,{action:'claim-and-publish-promotional',presentation:draft})));
  assert.deepEqual(publishRace.map(r=>r.status).sort(),[200,403]);
  const publisher=publishRace[0].status===200?pubOne:pubTwo;
  const published=publishRace.find(r=>r.status===200)!.body as {tag:{enabled:boolean;presentation:unknown};recoveryCode:string};
  assert.equal(published.tag.enabled,true);
  assert.deepEqual(published.tag.presentation,draft);
  assert.match(published.recoveryCode,/^[a-f0-9]{48}$/);
  const repeated=await http(fresh.id,'POST',publisher.token,{action:'claim-and-publish-promotional',presentation:{...draft,name:'Não sobrescrever'}});
  assert.equal(repeated.status,200);
  assert.equal((repeated.body as {recoveryCode:unknown}).recoveryCode,null);
  assert.deepEqual((repeated.body as {tag:{presentation:unknown}}).tag.presentation,draft);
  const losingPublisher=publisher.uid===pubOne.uid?pubTwo:pubOne;
  const listBefore=await http('','GET',publisher.token);
  assert.equal(listBefore.status,200);
  assert.ok((listBefore.body as {tags:{id:string}[]}).tags.some(tag=>tag.id===fresh.id));
  const otherList=await http('','GET',losingPublisher.token);
  assert.equal(otherList.status,200);
  assert.ok(!(otherList.body as {tags:{id:string}[]}).tags.some(tag=>tag.id===fresh.id));
  assert.equal((await adminDb.doc('users/'+publisher.uid).get()).exists,false);
  assert.equal((await http('','POST',losingPublisher.token,{action:'promote-tag-identity-with-presentation',sourceTagId:fresh.id})).status,409);
  assert.equal((await adminDb.doc('users/'+publisher.uid+'/public_profile/main').get()).exists,false);
  const promoted=await http('','POST',publisher.token,{action:'promote-tag-identity-with-presentation',sourceTagId:fresh.id});
  assert.equal(promoted.status,200);
  assert.equal((promoted.body as {mode:string}).mode,'full');
  const imported=(await adminDb.doc('users/'+publisher.uid+'/public_profile/main').get()).data()!;
  assert.equal(imported.name,draft.name);
  assert.equal(imported.bio,draft.about);
  assert.equal(imported.occupation,draft.occupation);
  assert.deepEqual(Object.keys(imported).sort(),['bio','name','occupation','photoUrl','updatedAt','userId']);
  assert.equal((await http('','POST',publisher.token,{action:'promote-tag-identity-with-presentation',sourceTagId:fresh.id})).status,200);
  const listAfter=await http('','GET',publisher.token);
  assert.equal(listAfter.status,200);
  assert.ok((listAfter.body as {tags:{id:string}[]}).tags.some(tag=>tag.id===fresh.id));
  assert.equal((await adminDb.doc('kyrub_official_tags/'+fresh.id).get()).get('ownerId'),publisher.uid);
  await adminDb.doc('users/'+publisher.uid).set({name:'Kairubido de teste'});
  await adminDb.doc('communities/tag-spaces-test').set({ownerId:publisher.uid,name:'Comunidade teste',visibility:'public'});
  await reserveSocialAddress(publisher.uid,'community','tag-spaces-test','tag-spaces-test');
  const space='https://kyrub.com/comunidade/tag-spaces-test';
  await saveOwnedCard(publisher.uid,[space]);
  const second=await provisionPromotionalKyrubTag(),thirdTag=await provisionPromotionalKyrubTag();
  for(const unit of [second,thirdTag])assert.equal((await http(unit.id,'POST',publisher.token,{action:'claim-and-publish-promotional',presentation:draft})).status,200);
  assert.equal((await http(fresh.id,'POST',losingPublisher.token,{action:'rename-tag',nickname:'Não autorizado'})).status,403);
  assert.equal((await http(fresh.id,'POST',publisher.token,{action:'rename-tag',nickname:'Meu capacete'})).status,200);
  assert.equal((await loadOwnedKyrubTag(publisher.uid,fresh.id)).nickname,'Meu capacete');
  assert.equal(JSON.stringify(await resolveKyrubTag(fresh.id)).includes('Meu capacete'),false);
  const attach={action:'add-card-spaces-to-tags',tagIds:[fresh.id,second.id],urls:[space]};
  assert.equal((await http('','POST',losingPublisher.token,attach)).status,409);
  assert.equal((await http('','POST',publisher.token,{...attach,tagIds:[fresh.id,promo.id]})).status,403);
  assert.deepEqual((await resolveKyrubTag(fresh.id))?.links,[]);
  assert.equal((await http('','POST',publisher.token,attach)).status,200);
  assert.equal((await http('','POST',publisher.token,attach)).status,200);
  assert.deepEqual((await resolveKyrubTag(fresh.id))?.links.map(l=>l.url),[space]);
  assert.deepEqual((await resolveKyrubTag(second.id))?.links.map(l=>l.url),[space]);
  assert.deepEqual((await resolveKyrubTag(thirdTag.id))?.links,[]);
  assert.deepEqual((await loadOwnedKyrubTag(publisher.uid,fresh.id)).presentation,draft);
  const expected={name:'Novo nome',occupation:'Comerciante',bio:'Apresentação atualizada',photoUrl:'',coverUrl:'',backgroundUrl:''};
  await adminDb.doc('users/'+publisher.uid+'/public_profile/main').update(expected);
  const beforeSync=(await adminDb.doc('kyrub_official_tags/'+fresh.id).get()).data()!;
  const sync={action:'sync-profile-presentation',input:{tagIds:[fresh.id,second.id],expected,fields:['text'],media:{}}};
  assert.equal((await http('','POST',publisher.token,{...sync,input:{...sync.input,expected:{...expected,bio:'Desatualizada'}}})).status,409);
  assert.equal((await http('','POST',publisher.token,{...sync,input:{...sync.input,tagIds:[fresh.id,promo.id]}})).status,403);
  assert.deepEqual((await loadOwnedKyrubTag(publisher.uid,fresh.id)).presentation,draft);
  assert.equal((await http('','POST',publisher.token,sync)).status,200);
  const afterSync=(await adminDb.doc('kyrub_official_tags/'+fresh.id).get()).data()!;
  assert.equal(afterSync.ownerId,beforeSync.ownerId);
  assert.equal(afterSync.recoveryHash,beforeSync.recoveryHash);
  assert.deepEqual(afterSync.targets,beforeSync.targets);
  assert.equal((await loadOwnedKyrubTag(publisher.uid,fresh.id)).presentation?.name,expected.name);
  assert.equal((await loadOwnedKyrubTag(publisher.uid,second.id)).presentation?.about,expected.bio);
  assert.deepEqual((await loadOwnedKyrubTag(publisher.uid,thirdTag.id)).presentation,draft);
  const removal={action:'remove-promotional-space',url:space};
  assert.equal((await http(fresh.id,'POST',losingPublisher.token,removal)).status,403);
  assert.equal((await http(fresh.id,'POST',publisher.token,removal)).status,200);
  assert.equal((await http(fresh.id,'POST',publisher.token,removal)).status,200);
  assert.deepEqual((await resolveKyrubTag(fresh.id))?.links,[]);
  assert.deepEqual((await resolveKyrubTag(second.id))?.links.map(l=>l.url),[space]);
  assert.equal((await loadOwnedKyrubTag(publisher.uid,fresh.id)).presentation?.name,expected.name);
  assert.equal((await adminDb.doc('kyrub_official_tags/'+fresh.id).get()).get('recoveryHash'),beforeSync.recoveryHash);
  await adminDb.doc('communities/tag-spaces-test').update({visibility:'private'});
  assert.deepEqual((await resolveKyrubTag(fresh.id))?.links,[]);
  assert.equal((await http('','POST',publisher.token,attach)).status,409);
  const race=await Promise.all([
   http(promo.id,'POST',one.token,{action:'claim-promotional'}),
   http(promo.id,'POST',two.token,{action:'claim-promotional'}),
  ]);
  assert.deepEqual(race.map(r=>r.status).sort(),[200,403]);
  const winnerIndex=race.findIndex(r=>r.status===200);
  const owner=winnerIndex===0?one:two,attacker=winnerIndex===0?two:one;
  const victory=race[winnerIndex].body as {tag:{id:string;distribution:string};recoveryCode:string};
  assert.equal(victory.tag.id,promo.id);
  assert.equal(victory.tag.distribution,'promotional');
  assert.match(victory.recoveryCode,/^[a-f0-9]{48}$/);
  const stored=(await adminDb.doc('kyrub_official_tags/'+promo.id).get()).data()!;
  assert.equal(stored.ownerId,owner.uid);
  assert.equal(stored.firstOwnerId,owner.uid);
  assert.equal(stored.distribution,'promotional');
  assert.equal(stored.enabled,false);
  assert.equal(stored.activationHash,null);
  assert.equal(typeof stored.recoveryHash,'string');
  assert.equal(JSON.stringify(stored).includes(victory.recoveryCode),false);
  assert.equal(JSON.stringify(stored).includes(owner.email),false);
  assert.equal((await http(promo.id,'POST',owner.token,{action:'claim-promotional'})).status,200);
  const replay=await http(promo.id,'POST',owner.token,{action:'claim-promotional'});
  assert.deepEqual((replay.body as {recoveryCode:unknown}).recoveryCode,null);
  assert.equal((await http(promo.id,'GET',attacker.token)).status,403);
  assert.equal((await http(promo.id,'POST',attacker.token,{
   action:'configure-promotional',presentation:{name:'Fraude',occupation:'',about:''}
  })).status,403);
  await assert.rejects(configureKyrubTag(owner.uid,promo.id,['https://kyrub.com/@shop-a']),/TAG_FORBIDDEN/);
  await assert.rejects(loadTagDestinationCatalog(owner.uid,promo.id),/TAG_FORBIDDEN/);
  assert.equal((await http(promo.id,'GET',null,undefined,true)).status,404);
  const presentation={name:'Entregador A',occupation:'Entregas',about:'Meu cartão público sem contato privado'};
  // Updating a Firebase Auth email verification status must immediately revoke
  // the ability to edit or block this tag even with an older signed ID token.
  await adminAuth.updateUser(owner.uid,{emailVerified:false});
  assert.equal((await http(promo.id,'POST',owner.token,{action:'configure-promotional',presentation})).status,403);
  assert.equal((await http(promo.id,'POST',owner.token,{action:'block-promotional'})).status,403);
  await adminAuth.updateUser(owner.uid,{emailVerified:true});
  const configured=await http(promo.id,'POST',owner.token,{action:'configure-promotional',presentation});
  assert.equal(configured.status,200);
  const publicCard=await http(promo.id,'GET',null,undefined,true);
  assert.equal(publicCard.status,200);
  const projected=publicCard.body as {status:string;presentation:unknown;links:unknown[]};
  assert.equal(projected.status,'active');
  assert.deepEqual(projected.presentation,{...presentation,hasCover:false,hasAvatar:false,sosContacts:[]});
  assert.deepEqual(projected.links,[]);
  assert.equal(JSON.stringify(projected).includes(owner.uid),false);
  assert.equal(JSON.stringify(projected).includes(owner.email),false);
  assert.equal(JSON.stringify(projected).includes('recoveryHash'),false);
  const privateAndPublic={
   ...presentation,emergencyContacts:[
    {name:'Família A',relationship:'Irmã',phone:'11987654321',whatsapp:true,shareInSos:false,consentConfirmed:false},
    {name:'Contato B',relationship:'Amigo',phone:'11991234567',whatsapp:true,shareInSos:true,consentConfirmed:true}
   ]
  };
  assert.equal((await http(promo.id,'POST',owner.token,{action:'configure-promotional',presentation:privateAndPublic})).status,200);
  const sosCard=await http(promo.id,'GET',null,undefined,true);
  assert.equal(sosCard.status,200);
  const safeSos=(sosCard.body as {presentation:{sosContacts:{name:string;phone:string}[]}}).presentation.sosContacts;
  assert.deepEqual(safeSos,[{name:'Contato B',relationship:'Amigo',phone:'+5511991234567',whatsapp:true}]);
  assert.equal(JSON.stringify(sosCard.body).includes('Família A'),false);
  assert.equal(JSON.stringify(sosCard.body).includes('11987654321'),false);
  const unconsented={...privateAndPublic,emergencyContacts:[
   {...privateAndPublic.emergencyContacts[0],shareInSos:true}
  ]};
  assert.equal((await http(promo.id,'POST',owner.token,{action:'configure-promotional',presentation:unconsented})).status,400);
  // Images cannot be attached by arbitrary path or external URL.
  assert.equal((await http(promo.id,'POST',owner.token,{action:'configure-promotional',presentation:{
   ...presentation,coverPath:'https://example.com/foreign-photo.jpg'
  }})).status,400);
  const rot=await http(promo.id,'POST',owner.token,{action:'rotate-promotional-recovery'});
  assert.equal(rot.status,200);
  const newCode=(rot.body as {recoveryCode:string}).recoveryCode;
  assert.match(newCode,/^[a-f0-9]{48}$/);
  assert.notEqual(newCode,victory.recoveryCode);
  assert.equal((await http(promo.id,'POST',third.token,{
   action:'recover-promotional',recoveryCode:victory.recoveryCode
  })).status,403);
  assert.equal((await http(promo.id,'POST',attacker.token,{action:'block-promotional'})).status,403);
  assert.equal((await http(promo.id,'POST',owner.token,{action:'block-promotional'})).status,200);
  assert.equal(await resolveKyrubTag(promo.id),null);
  assert.equal((await http(promo.id,'POST',owner.token,{action:'configure-promotional',presentation})).status,403);
  assert.equal((await http(promo.id,'POST',owner.token,{action:'unblock-promotional'})).status,200);
  assert.equal((await http(promo.id,'GET',null,undefined,true)).status,404);
  assert.equal((await http(promo.id,'POST',owner.token,{action:'configure-promotional',presentation})).status,200);
  const recovery=await http(promo.id,'POST',third.token,{action:'recover-promotional',recoveryCode:newCode});
  assert.equal(recovery.status,200);
  const rotatedAgain=(recovery.body as {recoveryCode:string;tag:{blocked:boolean}}).recoveryCode;
  assert.notEqual(rotatedAgain,newCode);
  assert.equal((recovery.body as {tag:{blocked:boolean}}).tag.blocked,true);
  const recoveredStored=(await adminDb.doc('kyrub_official_tags/'+promo.id).get()).data()!;
  assert.equal(recoveredStored.ownerId,third.uid);
  assert.equal(recoveredStored.firstOwnerId,owner.uid);
  assert.equal(recoveredStored.enabled,false);
  assert.equal(recoveredStored.blocked,true);
  assert.equal((await adminDb.doc('kyrub_tag_minimal_identities/'+third.uid).get()).get('mode'),'tag_only');
  assert.equal((await adminDb.doc('users/'+third.uid).get()).exists,false);
  assert.equal((await http(promo.id,'GET',owner.token)).status,403);
  assert.equal((await http(promo.id,'POST',owner.token,{action:'unblock-promotional'})).status,403);
  assert.equal((await http(promo.id,'POST',owner.token,{action:'rotate-promotional-recovery'})).status,403);
  assert.equal((await http(promo.id,'POST',owner.token,{action:'recover-promotional',recoveryCode:newCode})).status,403);
  assert.equal((await http(promo.id,'POST',third.token,{action:'unblock-promotional'})).status,200);
  assert.equal((await http(promo.id,'POST',third.token,{action:'configure-promotional',presentation})).status,200);
  assert.equal((await loadOwnedKyrubTag(third.uid,promo.id)).enabled,true);
  assert.equal((await http(legacy.id,'GET',null,undefined,true)).status,200);
  const browser=env.authenticatedContext(third.uid).firestore(),anon=env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(browser,'kyrub_official_tags/'+promo.id)));
  await assertFails(getDoc(doc(anon,'kyrub_official_tags/'+promo.id)));
  await assertFails(setDoc(doc(browser,'kyrub_official_tags/'+promo.id),{ownerId:owner.uid}));
  delete process.env.KYRUB_TAG_PROMO_FIRST_CLAIM_ENABLED;
  const extra=await adminDb.doc('kyrub_official_tags/'+'a'.repeat(32)).create({
   model:'adesivo',distribution:'promotional',ownerId:null,enabled:false,blocked:false,
   activationHash:null,reservedEmailHash:null,targets:[],externalUrls:[],presentation:{name:'',occupation:'',about:''}
  });
  assert.ok(extra.writeTime);
  assert.equal((await http('a'.repeat(32),'POST',owner.token,{action:'claim-promotional'})).status,409);
  assert.equal((await resolveKyrubTag('a'.repeat(32)))?.activation,'setup');
 }finally{
  if(originalFlag===undefined)delete process.env.KYRUB_TAG_PROMO_FIRST_CLAIM_ENABLED;
  else process.env.KYRUB_TAG_PROMO_FIRST_CLAIM_ENABLED=originalFlag;
 }
});


test('promotional Super Admin batch issuance: no recipient, authenticated, idempotent and isolated from pilot',async()=>{
 if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST??''))throw Error('LOCAL_AUTH_EMULATOR_REQUIRED');
 const {adminAuth}=await import('../server/firebaseAdmin.js');
 const {handlePromotionalBatch}=await import('../server/admin/kyrubTagPromotionalBatchService.js');
 const {resolveKyrubTag}=await import('../server/identity/kyrubTagService.js');
 const prev=process.env.KYRUB_TAG_PROMO_ISSUANCE_ENABLED;
 const previousHost=process.env.VERCEL_URL;
 const password='isolated-promotional-issuer-only';
 async function login(uid:string,role:string,status:string){
  const email=uid+'@example.test';
  await adminAuth.createUser({uid,email,password,emailVerified:true});
  await adminDb.doc('kyrub_admin/control_plane/admins/'+uid).set({uid,role,status});
  const response=await fetch('http://'+process.env.FIREBASE_AUTH_EMULATOR_HOST+
   '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({email,password,returnSecureToken:true})
  });
  assert.equal(response.ok,true);
  const result=await response.json() as {idToken:string};
  return 'Bearer '+result.idToken;
 }
 try{
  const admin=await login('promo-admin','super_admin','active');
  const other=await login('promo-member','operations','active');
  const suspended=await login('promo-suspended','super_admin','suspended');
  const req={action:'issue',count:3,requestId:'b'.repeat(32)};
  delete process.env.KYRUB_TAG_PROMO_ISSUANCE_ENABLED;
  assert.equal((await handlePromotionalBatch(admin,'POST',req)).status,409);
  process.env.KYRUB_TAG_PROMO_ISSUANCE_ENABLED='true';
  assert.equal((await handlePromotionalBatch('','POST',req)).status,401);
  assert.equal((await handlePromotionalBatch(other,'POST',req)).status,403);
  assert.equal((await handlePromotionalBatch(suspended,'POST',req)).status,403);
  assert.equal((await handlePromotionalBatch(admin,'POST',{...req,count:11})).status,400);
  const first=await Promise.all([handlePromotionalBatch(admin,'POST',req),handlePromotionalBatch(admin,'POST',req)]);
  assert.deepEqual(first.map(x=>x.status).sort(),[200,201]);
  const created=first.find(x=>x.status===201)?.body as {batch:{
   id:string;count:number;model:string;units:{id:string;url:string;physicalStatus:string}[]
  };replay:boolean};
  assert.equal(created.batch.id,req.requestId);
  assert.equal(created.batch.count,3);
  assert.equal(created.replay,false);
  assert.equal(created.batch.units.length,3);
  assert.equal(new Set(created.batch.units.map(x=>x.id)).size,3);
  for(const unit of created.batch.units){
   assert.match(unit.id,/^[a-f0-9]{32}$/);
   assert.equal(unit.url,'https://kyrub.com/tag/'+unit.id);
   assert.equal(unit.physicalStatus,'not_verified');
   const record=(await adminDb.doc('kyrub_official_tags/'+unit.id).get()).data()!;
   assert.equal(record.model,'adesivo');
   assert.equal(record.distribution,'promotional');
   assert.equal(record.ownerId,null);
   assert.equal(record.activationHash,null);
   assert.equal(record.reservedEmailHash,null);
   assert.equal(record.promotionalBatchId,req.requestId);
   assert.equal((await resolveKyrubTag(unit.id))?.status,'unclaimed');
   assert.equal(JSON.stringify(record).includes('promo-admin@example.test'),false);
  }
  assert.equal((await handlePromotionalBatch(admin,'POST',{...req,count:2})).status,409);
  const listed=await handlePromotionalBatch(admin,'GET',undefined);
  assert.equal(listed.status,200);
  const ready=(listed.body as {readiness:{isolation:string;canIssue:boolean;clientProjectMatchesServer:boolean}}).readiness;
  assert.equal(ready.isolation,'emulator');
  assert.equal(ready.clientProjectMatchesServer,true);
  assert.equal(ready.canIssue,true);
  const list=listed.body as {batches:typeof created.batch[]};
  assert.equal(list.batches.filter(b=>b.id===req.requestId).length,1);
  assert.equal((await handlePromotionalBatch(other,'GET',undefined)).status,403);
  const audit=await adminDb.collection('kyrub_admin/control_plane/audit_logs')
   .where('targetId','==',req.requestId).get();
  assert.equal(audit.size,1);
  assert.equal(audit.docs[0].get('action'),'admin.kyrub_tag.promotional_batch_issued');
  process.env.VERCEL_URL='kyrub-pilot-safe.vercel.app';
  const unitId=created.batch.units[0].id;
  const url='https://kyrub-pilot-safe.vercel.app/tag/'+unitId;
  const readback={action:'confirm-readback',batchId:req.requestId,tagId:unitId,readUrl:url};
  assert.equal((await handlePromotionalBatch(other,'POST',readback)).status,403);
  assert.equal((await handlePromotionalBatch(admin,'POST',{...readback,readUrl:'https://kyrub.com/tag/'+unitId})).status,409);
  assert.equal((await handlePromotionalBatch(admin,'POST',{...readback,readUrl:url+'?wrong=1'})).status,409);
  assert.equal((await handlePromotionalBatch(admin,'POST',{...readback,tagId:'f'.repeat(32)})).status,409);
  const verified=await handlePromotionalBatch(admin,'POST',readback);
  assert.equal(verified.status,200);
  const verifiedBody=verified.body as {batch:{units:{id:string;physicalStatus:string}[]};replay:boolean};
  assert.equal(verifiedBody.replay,false);
  assert.equal(verifiedBody.batch.units.find(item=>item.id===unitId)?.physicalStatus,'readback_confirmed');
  const repeated=await handlePromotionalBatch(admin,'POST',readback);
  assert.equal(repeated.status,200);
  assert.equal((repeated.body as {replay:boolean}).replay,true);
  const nextInventory=await handlePromotionalBatch(admin,'GET',undefined);
  const observedBatch=(nextInventory.body as {batches:typeof created.batch[]}).batches
   .find(batch=>batch.id===req.requestId);
  assert.equal(observedBatch?.units.filter(item=>item.physicalStatus==='readback_confirmed').length,1);
  assert.equal(observedBatch?.units.filter(item=>item.physicalStatus==='not_verified').length,2);
  const readbackAudit=await adminDb.collection('kyrub_admin/control_plane/audit_logs')
   .where('targetId','==',unitId).get();
  assert.equal(readbackAudit.size,1);
  assert.equal(readbackAudit.docs[0].get('action'),'admin.kyrub_tag.promotional_readback_confirmed');
  assert.equal(readbackAudit.docs[0].get('verificationMethod'),'browser-reported-ndef-readback');
  // Independent pilot inventory still exists and is not reissued or reassigned.
  const pilot=(await adminDb.doc('kyrub_tag_pilot_lots/experimental-001/units/001').get()).data();
  if(pilot?.tagId){
   assert.ok(!created.batch.units.some(unit=>unit.id===pilot.tagId));
   assert.equal((await adminDb.doc('kyrub_official_tags/'+pilot.tagId).get()).get('distribution'),undefined);
  }
 }finally{
  if(prev===undefined)delete process.env.KYRUB_TAG_PROMO_ISSUANCE_ENABLED;
  else process.env.KYRUB_TAG_PROMO_ISSUANCE_ENABLED=prev;
  if(previousHost===undefined)delete process.env.VERCEL_URL;
  else process.env.VERCEL_URL=previousHost;
 }
});


test('tag-only authentication prepares no Kyrub account; explicit promotion is required',async()=>{
 if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST??''))throw Error('LOCAL_AUTH_EMULATOR_REQUIRED');
 const {adminAuth}=await import('../server/firebaseAdmin.js');
 const {provisionPromotionalKyrubTag,provisionKyrubTag}=await import('../server/identity/kyrubTagService.js');
 const {getTagIdentityMode}=await import('../server/identity/kyrubTagMinimalIdentityService.js');
 const api=(await import('../api/health.js')).default;
 const original=process.env.KYRUB_TAG_PROMO_FIRST_CLAIM_ENABLED;
 const password='isolated-tag-only-identity';
 async function authToken(uid:string,verified:boolean){
  const email=uid+'@example.test';
  await adminAuth.createUser({uid,email,password,emailVerified:verified});
  const response=await fetch('http://'+process.env.FIREBASE_AUTH_EMULATOR_HOST+
    '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email,password,returnSecureToken:true})
  });
  assert.equal(response.ok,true);
  const data=await response.json() as {idToken:string};
  return data.idToken;
 }
 async function route(uidToken:string,tagId:string,method:'GET'|'POST',body?:Record<string,unknown>,view='identity'){
  let status=0,value:unknown;
  const response={setHeader(){},status(n:number){status=n;return response;},json(data:unknown){value=data;}};
  await api({method,headers:{authorization:'Bearer '+uidToken},
    query:{transport:'manage-kyrub-tag',id:tagId,view},...(body?{body}:{})} as never,response as never);
  return {status,body:value};
 }
 try{
  process.env.KYRUB_TAG_PROMO_FIRST_CLAIM_ENABLED='true';
  const unit=await provisionPromotionalKyrubTag(),protectedUnit=await provisionKyrubTag('adesivo');
  const ownerToken=await authToken('tag-minimal-owner',true);
  const unverifiedToken=await authToken('tag-minimal-unverified',false);
  assert.deepEqual(await getTagIdentityMode('tag-minimal-owner'),{mode:'unclassified'});
  assert.equal((await route(unverifiedToken,unit.id,'POST',{action:'prepare-promotional-identity'})).status,403);
  assert.equal((await route(ownerToken,protectedUnit.id,'POST',{action:'prepare-promotional-identity'})).status,403);
  const prepared=await route(ownerToken,unit.id,'POST',{action:'prepare-promotional-identity'});
  assert.deepEqual(prepared,{status:200,body:{mode:'tag_only'}});
  assert.equal((await route(ownerToken,unit.id,'POST',{action:'prepare-promotional-identity'})).status,200);
  assert.deepEqual((await route(ownerToken,'','GET')).body,{mode:'tag_only'});
  assert.equal((await adminDb.doc('users/tag-minimal-owner').get()).exists,false);
  assert.equal((await adminDb.doc('users/tag-minimal-owner/stores/tag-minimal-owner').get()).exists,false);
  assert.equal((await adminDb.doc('kyrub_tag_minimal_identities/tag-minimal-owner').get()).get('mode'),'tag_only');
  const claimed=await route(ownerToken,unit.id,'POST',{action:'claim-promotional'});
  assert.equal(claimed.status,200);
  const afterClaim=await adminDb.doc('kyrub_tag_minimal_identities/tag-minimal-owner').get();
  assert.equal(afterClaim.get('mode'),'tag_only');
  assert.equal((await adminDb.doc('users/tag-minimal-owner').get()).exists,false);
  assert.equal((await adminDb.doc('users/tag-minimal-owner/stores/tag-minimal-owner').get()).exists,false);
  // No anonymous or unrelated user can promote a different identity.
  assert.equal((await route(unverifiedToken,'','POST',{action:'promote-tag-identity'})).status,409);
  const promoted=await route(ownerToken,'','POST',{action:'promote-tag-identity'});
  assert.equal(promoted.status,200);
  assert.deepEqual((promoted.body as {mode:string;replay:boolean}),{mode:'full',replay:false});
  assert.deepEqual((await route(ownerToken,'','POST',{action:'promote-tag-identity'})).body,{mode:'full',replay:true});
  assert.deepEqual((await route(ownerToken,'','GET')).body,{mode:'full'});
  // Only the explicit app bootstrap may create the user/store after consent.
  assert.equal((await adminDb.doc('users/tag-minimal-owner').get()).exists,false);
  assert.equal((await adminDb.doc('users/tag-minimal-owner/stores/tag-minimal-owner').get()).exists,false);
 }finally{
  if(original===undefined)delete process.env.KYRUB_TAG_PROMO_FIRST_CLAIM_ENABLED;
  else process.env.KYRUB_TAG_PROMO_FIRST_CLAIM_ENABLED=original;
 }
});

 test('presentation picker lists only owned reachable communities and stores',async()=>{
 const {listOwnedPresentationSpaces}=await import('../server/identity/publicVisitCardService.js');
 await adminDb.doc('users/picker-owner').set({name:'Picker',isProfileVisible:true});
 await adminDb.doc('communities/picker-public').set({ownerId:'picker-owner',name:'Minha comunidade',visibility:'public'});
 await adminDb.doc('communities/picker-private').set({ownerId:'picker-owner',name:'Privada',visibility:'private'});
 await adminDb.doc('tenants/picker-store').set({ownerId:'picker-owner',id:'picker-store',slug:'picker-store',name:'Minha loja',publicationStatus:'published',publicProducts:[]});
 await reserveSocialAddress('picker-owner','community','picker-public','picker-public');
 const result=await listOwnedPresentationSpaces('picker-owner');
 assert.deepEqual(result.map(link=>link.kind).sort(),['community','store']);
 assert.ok(result.every(link=>!('bindingId' in link)));
 assert.deepEqual(await listOwnedPresentationSpaces('unrelated-picker-user'),[]);
 await adminDb.doc('communities/picker-public').update({visibility:'private'});
 assert.deepEqual((await listOwnedPresentationSpaces('picker-owner')).map(link=>link.kind),['store']);
 });

test('contact presentation uses live public profile and card destinations, not private fields or posts',async()=>{
 const {resolveContactPresentation}=await import('../server/identity/publicVisitCardService.js');
 const owner='presentation-owner';
 await adminDb.doc('users/'+owner).set({name:'Public name',email:'private@example.test',isProfileVisible:true});
 await adminDb.doc('users/'+owner+'/public_profile/main').set({name:'Apresentação',occupation:'Autônomo',bio:'Olá',photoUrl:'',privateField:'secret'});
 await adminDb.doc('communities/presentation-community').set({ownerId:owner,name:'Comunidade pública',visibility:'public'});
 await reserveSocialAddress(owner,'community','presentation-community','presentation-community');
 await saveOwnedCard(owner,['https://kyrub.com/comunidade/presentation-community']);
 const result=await resolveContactPresentation(owner);
 assert.equal(result?.name,'Apresentação');assert.equal(result?.occupation,'Autônomo');
 assert.equal(result?.links.length,1);
 assert.deepEqual(Object.keys(result!).sort(),['backgroundUrl','bio','coverUrl','links','name','occupation','photoUrl']);
 assert.equal(JSON.stringify(result).includes('private@example.test'),false);
 await adminDb.doc('communities/presentation-community').update({visibility:'private'});
 assert.deepEqual((await resolveContactPresentation(owner))?.links,[]);
 await adminDb.doc('users/'+owner).update({isProfileVisible:false});
 assert.equal(await resolveContactPresentation(owner),null);
 assert.equal(await resolveContactPresentation('not-existing-presentation'),null);
});

 test('optional promotional background is scoped to its own media slot and never leaks storage paths',async()=>{
 const {normalizePromotionalPresentation,publicPromotionalPresentation,isPromotionalMediaPath,promotionalMediaPath}=await import('../shared/kyrubTagPromotional.js');
 const id='a'.repeat(32),asset='b'.repeat(32),path=promotionalMediaPath(id,'background',asset);
 const base={name:'Teste',occupation:'',about:''};
 assert.equal(isPromotionalMediaPath(path,id,'background'),true);
 assert.equal(isPromotionalMediaPath(path,id,'cover'),false);
 assert.equal(isPromotionalMediaPath(path,'c'.repeat(32),'background'),false);
 const normalized=normalizePromotionalPresentation({...base,backgroundPath:path});
 assert.equal(publicPromotionalPresentation(normalized).hasBackground,true);
 assert.equal(JSON.stringify(publicPromotionalPresentation(normalized)).includes(path),false);
 assert.throws(()=>normalizePromotionalPresentation({...base,backgroundPath:promotionalMediaPath(id,'cover',asset)}),/TAG_PRESENTATION_INVALID/);
 });

 test('public permanent address presents the same safe identity as the social card',async()=>{
 const {resolvePublicPresentationByIdentifier,resolveContactPresentation}=await import('../server/identity/publicVisitCardService.js');
 const uid='share-presentation-owner';
 await adminDb.doc('users/'+uid).set({name:'Share',isProfileVisible:true,email:'private@example.test'});
 await adminDb.doc('users/'+uid+'/public_profile/main').set({name:'Share',bio:'Sobre',occupation:'Autônomo',photoUrl:'',coverUrl:'',backgroundUrl:''});
 await reserveSocialAddress(uid,'profile','share-presentation');
 const result=await resolvePublicPresentationByIdentifier('share-presentation');
 assert.deepEqual(result,await resolveContactPresentation(uid));assert.equal(result?.name,'Share');
 assert.equal(JSON.stringify(result).includes('private@example.test'),false);
 assert.equal(await resolvePublicPresentationByIdentifier(uid),null);
 await adminDb.doc('users/'+uid).update({isProfileVisible:false});
 assert.equal(await resolvePublicPresentationByIdentifier('share-presentation'),null);
 });

test('presentation relationship uses one canonical connection and excludes minimal tag identities',async()=>{
 const {presentationRelationship}=await import('../server/identity/presentationRelationshipService.js');
 const sender='relationship-sender',receiver='relationship-receiver',minimal='relationship-minimal';
 for(const uid of [sender,receiver])await adminDb.doc('users/'+uid).set({name:uid,isProfileVisible:true});
 await adminDb.doc('kyrub_tag_minimal_identities/'+minimal).set({uid:minimal,mode:'tag_only'});
 const id='a1'.repeat(16);
 await adminDb.doc('kyrub_official_tags/'+id).set({distribution:'promotional',ownerId:minimal,enabled:true,blocked:false,socialEnabled:true});
 assert.equal((await presentationRelationship(sender,'tag',id)).state,'tag_only');
 await adminDb.doc('kyrub_official_tags/'+id).update({ownerId:receiver,socialEnabled:false});
 assert.equal((await presentationRelationship(sender,'tag',id)).state,'unavailable');
 await adminDb.doc('kyrub_official_tags/'+id).update({socialEnabled:true});
 assert.equal((await presentationRelationship(null,'tag',id)).state,'guest');
 assert.equal((await presentationRelationship(minimal,'tag',id)).state,'join');
 const attempts=await Promise.all([presentationRelationship(sender,'tag',id,'connect'),presentationRelationship(sender,'contact',receiver,'connect')]);
 assert.ok(attempts.every(x=>x.state==='pending_sent'));
 const pair=[sender,receiver].sort().join('_');
 assert.equal((await adminDb.doc('connections/'+pair).get()).get('status'),'pending');
 await assert.rejects(presentationRelationship(sender,'tag',id,'accept'),/RELATIONSHIP_CHANGED/);
 assert.equal((await presentationRelationship(receiver,'contact',sender,'accept')).state,'accepted');
 assert.equal((await presentationRelationship(sender,'tag',id)).state,'accepted');
 await adminDb.doc('kyrub_official_tags/'+id).update({blocked:true});
 assert.equal((await presentationRelationship(sender,'tag',id)).state,'unavailable');
 assert.equal((await adminDb.doc('connections/'+pair).get()).get('status'),'accepted');
});

test('private persistent contact blocks prevent reconnection and chat from either side',async()=>{
 const {presentationRelationship,setSocialContactBlock}=await import('../server/identity/presentationRelationshipService.js');
 const first='blocking-first',second='blocking-second';
 for(const uid of [first,second])await adminDb.doc('users/'+uid).set({name:uid,isProfileVisible:true});
 const pair=[first,second].sort().join('_'),connection=adminDb.doc('connections/'+pair);
 await presentationRelationship(first,'contact',second,'connect');
 await presentationRelationship(second,'contact',first,'accept');
 await adminDb.doc('social_chats/'+pair+'/messages/old').set({senderId:first,receiverId:second,text:'histórico',createdAt:new Date()});
 await Promise.all([setSocialContactBlock(first,second,true),setSocialContactBlock(first,second,true)]);
 assert.equal((await connection.get()).exists,false);
 assert.equal((await adminDb.doc('social_chats/'+pair+'/messages/old').get()).exists,true);
 assert.equal((await presentationRelationship(second,'contact',first,'connect')).state,'unavailable');
 assert.equal((await presentationRelationship(first,'contact',second)).state,'unavailable');
 const peer=env.authenticatedContext(second).firestore(),owner=env.authenticatedContext(first).firestore();
 const path='social_contact_blocks/'+first+'/blocked/'+second;
 const ownBlock=await assertSucceeds(getDoc(doc(owner,path)));
 assert.equal(ownBlock.exists(),true);
 assert.equal(ownBlock.data()?.targetId,second);
 await assertFails(getDoc(doc(peer,path)));
 await assertFails(setDoc(doc(owner,path),{targetId:second}));
 await assertFails(setDoc(doc(peer,'connections/'+pair),{senderId:second,receiverId:first,participantIds:[first,second].sort(),status:'pending',createdAt:serverTimestamp(),updatedAt:serverTimestamp()}));
 await assertFails(getDoc(doc(peer,'social_chats/'+pair+'/messages/old')));
 await setSocialContactBlock(second,first,true);
 await setSocialContactBlock(first,second,false);
 assert.equal((await presentationRelationship(first,'contact',second)).state,'unavailable');
 await setSocialContactBlock(second,first,false);
 assert.equal((await presentationRelationship(first,'contact',second)).state,'none');
 assert.equal((await connection.get()).exists,false);
 await assertSucceeds(setDoc(doc(peer,'connections/'+pair),{senderId:second,receiverId:first,participantIds:[first,second].sort(),status:'pending',createdAt:serverTimestamp(),updatedAt:serverTimestamp()}));
 await presentationRelationship(first,'contact',second,'accept');
 const history=await assertSucceeds(getDoc(doc(peer,'social_chats/'+pair+'/messages/old')));
 assert.equal(history.data()?.text,'histórico');
});

test('follow-profile is explicit per unit and privacy pauses identity without disabling SOS',async()=>{
 const {setPromotionalPresentationMode,resolveKyrubTag,loadOwnedKyrubTag}=await import('../server/identity/kyrubTagService.js');
 const uid='follow-profile-owner',other='follow-profile-other',id='c3'.repeat(16),second='c4'.repeat(16);
 await adminDb.doc('users/'+uid).set({name:'Original',isProfileVisible:true});
 const profile=adminDb.doc('users/'+uid+'/public_profile/main');
 await profile.set({name:'Public name',occupation:'Public work',bio:'Public bio',photoUrl:'https://example.test/photo.webp',coverUrl:'',backgroundUrl:''});
 const custom={name:'Custom name',occupation:'Custom work',about:'Custom bio',emergencyContacts:[{name:'Contato',relationship:'Amigo',phone:'+5511999999999',whatsapp:false,shareInSos:true,consentConfirmed:true}]};
 for(const unit of [id,second])await adminDb.doc('kyrub_official_tags/'+unit).set({model:'adesivo',distribution:'promotional',ownerId:uid,enabled:true,blocked:false,targets:[],externalUrls:[],presentation:custom});
 assert.equal((await resolveKyrubTag(id))?.presentation?.name,'Custom name');
 await assert.rejects(setPromotionalPresentationMode(other,id,'follow-profile'),/TAG_FORBIDDEN/);
 await setPromotionalPresentationMode(uid,id,'follow-profile');
 assert.equal((await resolveKyrubTag(id))?.presentation?.name,'Public name');
 await profile.update({name:'New public name',photoUrl:''});
 assert.equal((await resolveKyrubTag(id))?.presentation?.name,'New public name');
 assert.equal((await resolveKyrubTag(second))?.presentation?.name,'Custom name');
 await adminDb.doc('users/'+uid).update({isProfileVisible:false});
 const paused=await resolveKyrubTag(id);
 assert.equal(paused?.presentation?.profilePaused,true);
 assert.equal(paused?.presentation?.name,'');
 assert.equal(paused?.presentation?.profileMedia,undefined);
 assert.equal(paused?.presentation?.sosContacts.length,1);
 assert.equal((await loadOwnedKyrubTag(uid,id)).presentation?.name,'Custom name');
 await setPromotionalPresentationMode(uid,id,'custom');
 assert.equal((await resolveKyrubTag(id))?.presentation?.name,'Custom name');
});

test('image import rejects invalid selection, wrong owner and missing source before storage access',async()=>{
 const {importTagProfileImages}=await import('../server/identity/kyrubTagMediaService.js');
 const uid='image-import-owner',other='image-import-other',id='d1'.repeat(16);
 await adminDb.doc('users/'+uid).set({name:'Owner',isProfileVisible:true});
 await adminDb.doc('users/'+other).set({name:'Other',isProfileVisible:true});
 const profile=adminDb.doc('users/'+uid+'/public_profile/main');
 await profile.set({userId:uid,name:'Owner',bio:'',photoUrl:'',updatedAt:new Date()});
 await adminDb.doc('users/'+other+'/public_profile/main').set({userId:other,name:'Other',photoUrl:''});
 await adminDb.doc('kyrub_official_tags/'+id).set({ownerId:uid,distribution:'promotional',model:'adesivo',enabled:true,blocked:false,presentation:{name:'Tag',occupation:'',about:''},targets:[]});
 await assert.rejects(importTagProfileImages(uid,id,[]),/TAG_INVALID/);
 await assert.rejects(importTagProfileImages(uid,id,['avatar','avatar']),/TAG_INVALID/);
 await assert.rejects(importTagProfileImages(other,id,['avatar']),/TAG_FORBIDDEN/);
 await assert.rejects(importTagProfileImages(uid,id,['avatar']),/TAG_MEDIA_INVALID/);
 await profile.update({photoUrl:'https://example.test/existing.webp'});
 assert.deepEqual(await importTagProfileImages(uid,id,['avatar']),{images:{},skipped:['avatar']});
 assert.equal((await profile.get()).get('photoUrl'),'https://example.test/existing.webp');
});

test('profile identifiers may contain dots; minimal identities cannot bypass account promotion',async()=>{
 const {presentationRelationship}=await import('../server/identity/presentationRelationshipService.js');
 const {getTagIdentityMode}=await import('../server/identity/kyrubTagMinimalIdentityService.js');
 const target='dotted-address-owner',minimal='minimal-bootstrap-denied';
 await adminDb.doc('users/'+target).set({name:'Public profile',isProfileVisible:true});
 await reserveSocialAddress(target,'profile','owner.dotted');
 assert.equal((await presentationRelationship(null,'profile','owner.dotted')).state,'guest');
 await adminDb.doc('kyrub_tag_minimal_identities/'+minimal).set({uid:minimal,mode:'tag_only'});
 const browser=env.authenticatedContext(minimal).firestore();
 await assertFails(setDoc(doc(browser,'users/'+minimal),{uid:minimal,name:'Test',email:'test@example.test',photoUrl:'',isProfileVisible:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()}));
 await adminDb.doc('users/'+minimal).set({name:'Unexpected existing account'});
 assert.deepEqual(await getTagIdentityMode(minimal),{mode:'tag_only'});
});
test('selected Tag image bytes arrive in independent profile objects through Storage emulator',async()=>{
 if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIREBASE_STORAGE_EMULATOR_HOST??''))throw Error('LOCAL_STORAGE_EMULATOR_REQUIRED');
 const {adminStorage}=await import('../server/firebaseAdmin.js');
 const {importTagProfileImages}=await import('../server/identity/kyrubTagMediaService.js');
 const uid='media-copy-owner',id='d2'.repeat(16),asset='e2'.repeat(16);
 const bucket=adminStorage.bucket(projectId+'.firebasestorage.app');
 const src='kyrub-tag-media/'+id+'/avatar/'+asset;
 // Valid tiny WebP, generated fixture; no external media.
 const bytes=Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA','base64');
 await adminDb.doc('users/'+uid).set({name:'Test',isProfileVisible:true});
 const profile=adminDb.doc('users/'+uid+'/public_profile/main');
 await profile.set({userId:uid,name:'Test',bio:'',photoUrl:'',updatedAt:new Date()});
 const tag=adminDb.doc('kyrub_official_tags/'+id);
 await tag.set({ownerId:uid,model:'adesivo',distribution:'promotional',enabled:true,blocked:false,presentation:{name:'Tag',occupation:'',about:'',avatarPath:src},targets:[]});
 await bucket.file(src).save(bytes,{resumable:false,metadata:{contentType:'image/webp',metadata:{ownerId:uid,tagId:id,purpose:'avatar'}}});
 const copied=await importTagProfileImages(uid,id,['avatar']);
 const url=copied.images.photoUrl;
 assert.ok(url&&url.startsWith('https://firebasestorage.googleapis.com/'));
 const path=decodeURIComponent(new URL(url).pathname.split('/o/')[1]);
 assert.ok(path.startsWith('profile-images/'+uid+'/avatar-'));
 assert.notEqual(path,src);
 assert.deepEqual((await bucket.file(path).download())[0],bytes);
 assert.equal((await profile.get()).get('photoUrl'),url);
 assert.equal((await adminDb.doc('users/'+uid).get()).get('photoUrl'),url);
 assert.equal((await tag.get()).get('presentation').avatarPath,src);
 assert.deepEqual(await importTagProfileImages(uid,id,['avatar']),{images:{},skipped:['avatar']});
 await bucket.file(path).delete();
 await bucket.file(src).delete();
});


test('presentation routes share reserved privacy, block semantics and bilateral revisions',async()=>{
 const {presentationRelationship,setSocialContactBlock}=await import('../server/identity/presentationRelationshipService.js');
 const {initializeReservedTribe,unlockReservedTribe,setReservedTribeContact,getReservedTribeDirectory,getReservedTribeSetupStatus,getOrdinaryTribeDirectory}=await import('../server/identity/reservedTribeService.js');
 const owner='integration-privacy-owner',peer='integration-privacy-peer',unit='f4'.repeat(16);
 await Promise.all([owner,peer].map(uid=>adminDb.doc('users/'+uid).set({name:uid,isProfileVisible:true})));
 await reserveSocialAddress('integration-privacy-peer','profile','integration-privacy-peer');
 await adminDb.doc('kyrub_official_tags/'+unit).set({distribution:'promotional',ownerId:peer,enabled:true,blocked:false,socialEnabled:true});
 const initialOwner=(await getReservedTribeSetupStatus(owner)).revision;
 const initialPeer=(await getReservedTribeSetupStatus(peer)).revision;
 assert.equal((await presentationRelationship(owner,'tag',unit,'connect')).state,'pending_sent');
 assert.equal((await getReservedTribeSetupStatus(owner)).revision,initialOwner+1);
 assert.equal((await getReservedTribeSetupStatus(peer)).revision,initialPeer+1);
 assert.equal((await presentationRelationship(peer,'contact',owner,'accept')).state,'accepted');
 await initializeReservedTribe(owner,'integration!fixture');
 const session=await unlockReservedTribe(owner,'integration!fixture');assert.ok(session.ok);
 if(!session.ok)throw Error('SESSION_MISSING');
 await setReservedTribeContact(owner,session.token,peer,true);
 for(const [source,id] of [['contact',peer],['tag',unit],['profile','integration-privacy-peer']]){
  assert.deepEqual(await presentationRelationship(owner,source,id),{state:'unavailable'});
  assert.deepEqual(await presentationRelationship(owner,source,id,'connect'),{state:'unavailable'});
 }
 assert.equal((await presentationRelationship(peer,'contact',owner)).state,'accepted');
 assert.equal((await getReservedTribeDirectory(owner,session.token)).connections.length,1);
 await assert.rejects(setSocialContactBlock(owner,peer,true),/RELATIONSHIP_INVALID/);
 const pair=[owner,peer].sort().join('_');
 const message=adminDb.doc('social_chats/'+pair+'/messages/integration-fixture');
 await message.set({senderId:owner,receiverId:peer,text:'fixture',createdAt:new Date()});
 const before=(await getReservedTribeSetupStatus(owner)).revision;
 assert.deepEqual(await setSocialContactBlock(peer,owner,true),{blocked:true});
 assert.equal((await getReservedTribeSetupStatus(owner)).revision,before+1);
 assert.equal((await getReservedTribeDirectory(owner,session.token)).connections.length,0);
 assert.equal((await getOrdinaryTribeDirectory(peer)).blockedContacts[0].id,owner);
 assert.equal((await adminDb.doc('connections/'+pair).get()).exists,false);
 assert.equal((await message.get()).exists,true);
 assert.deepEqual(await setSocialContactBlock(peer,owner,false),{blocked:false});
 assert.equal((await getReservedTribeSetupStatus(owner)).revision,before+2);
 assert.equal((await adminDb.doc('connections/'+pair).get()).exists,false);
 assert.deepEqual(await presentationRelationship(owner,'tag',unit),{state:'unavailable'});
 assert.equal((await message.get()).exists,true);
});


test('authenticated ordinary presentation shares the reserved boundary but public address remains public',async()=>{
 const {resolveOrdinaryContactPresentation,setSocialContactBlock}=await import('../server/identity/presentationRelationshipService.js');
 const {resolvePublicPresentationByIdentifier}=await import('../server/identity/publicVisitCardService.js');
 const {initializeReservedTribe,unlockReservedTribe,setReservedTribeContact}=await import('../server/identity/reservedTribeService.js');
 const actor='card-boundary-owner',peer='card-boundary-peer',address='card-boundary-peer';
 await Promise.all([actor,peer].map(uid=>adminDb.doc('users/'+uid).set({name:uid,isProfileVisible:true})));
 await adminDb.doc('users/'+peer+'/public_profile/main').set({name:'Public card fixture',bio:'Public fixture',privateField:'not projected'});
 await reserveSocialAddress(peer,'profile',address);
 const pair=[actor,peer].sort().join('_');
 await adminDb.doc('connections/'+pair).set({senderId:actor,receiverId:peer,participantIds:[actor,peer].sort(),status:'accepted'});
 assert.equal((await resolveOrdinaryContactPresentation(actor,peer)).presentation?.name,'Public card fixture');
 await initializeReservedTribe(actor,'card!fixture');
 const session=await unlockReservedTribe(actor,'card!fixture');assert.ok(session.ok);
 if(!session.ok)throw Error('SESSION_MISSING');
 await setReservedTribeContact(actor,session.token,peer,true);
 assert.deepEqual(await resolveOrdinaryContactPresentation(actor,peer),{presentation:null});
 assert.equal((await resolveOrdinaryContactPresentation(peer,actor)).presentation?.name,actor);
 assert.equal((await resolvePublicPresentationByIdentifier(address))?.name,'Public card fixture');
 await setSocialContactBlock(peer,actor,true);
 assert.deepEqual(await resolveOrdinaryContactPresentation(peer,actor),{presentation:null});
 assert.deepEqual(await resolveOrdinaryContactPresentation(actor,peer),{presentation:null});
 assert.equal((await resolvePublicPresentationByIdentifier(address))?.name,'Public card fixture');
});
