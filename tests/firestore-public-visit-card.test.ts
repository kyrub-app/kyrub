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
