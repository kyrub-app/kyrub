import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { adminDb } from '../server/firebaseAdmin.js';
import { reserveSocialAddress, resolveSocialAddress, getOwnedSocialAddress } from '../server/identity/publicSocialAddressService.js';
import { saveOwnedCard, loadOwnedCard, resolvePublicCard, disableOwnedCard } from '../server/identity/publicVisitCardService.js';
if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST??''))throw Error('LOCAL_FIRESTORE_EMULATOR_REQUIRED');
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
