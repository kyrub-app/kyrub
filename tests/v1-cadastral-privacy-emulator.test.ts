import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {after,before,beforeEach,test} from 'node:test';
import {initializeApp,deleteApp,type App} from 'firebase-admin/app';
import {getFirestore,type Firestore} from 'firebase-admin/firestore';
import {initializeTestEnvironment,assertFails,assertSucceeds,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {collection,doc,getDoc,getDocs,setDoc,updateDoc,deleteDoc,serverTimestamp,query,where} from 'firebase/firestore';
import {createStoreStaffInvitation} from '../server/identity/storeStaffDirectoryService';
import {readVisibleSocialDirectoryPage,readVisibleAuthorIdentities} from '../server/identity/socialDiscoveryDirectoryService';
import {consumeDirectoryQuota} from '../server/identity/directoryQuotaService';
import {buildCadastralPrivacyCandidate,candidateSha256} from '../scripts/build-cadastral-privacy-candidate';

const projectId='demo-kyrub-privacy';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8088');
let app:App, db:Firestore, env:RulesTestEnvironment;
before(async()=>{
 const baseline=readFileSync('.firebase/firestore.combined.rules','utf8');
 const rules=buildCadastralPrivacyCandidate(baseline);
 const reviewed=readFileSync('.firebase/privacy-review-only/cadastral-candidate.rules.txt','utf8');
 const manifest=JSON.parse(readFileSync('.firebase/privacy-review-only/manifest.json','utf8'));
 assert.equal(reviewed,rules);
 assert.equal(manifest.baselineSha256,candidateSha256(baseline));
 assert.equal(manifest.candidateSha256,candidateSha256(rules));
 assert.equal(manifest.deployable,false);
 app=initializeApp({projectId},'isolated-privacy-candidate');
 db=getFirestore(app);
 env=await initializeTestEnvironment({projectId,firestore:{rules,host:'127.0.0.1',port:8088}});
});
beforeEach(async()=>env.clearFirestore());
after(async()=>{await env.cleanup();await db.terminate();await deleteApp(app);});
test('candidate protects root and hidden profile while preserving owner and scoped task reads',async()=>{
 await db.doc('users/owner').set({uid:'owner',name:'Nome',email:'private@example.test',isProfileVisible:true});
 await db.doc('users/owner/public_profile/main').set({userId:'owner',name:'Nome',bio:'Apresentação'});
 await db.doc('users/owner/tasks/shared').set({sharedWith:['visitor'],title:'Compartilhada'});
 await db.doc('users/owner/tasks/private').set({sharedWith:[],title:'Privada'});
 const own=env.authenticatedContext('owner').firestore();
 const visitor=env.authenticatedContext('visitor').firestore();
 const admin=env.authenticatedContext('admin',{role:'admin'}).firestore();
 assert.equal((await assertSucceeds(getDoc(doc(own,'users/owner')))).get('email'),'private@example.test');
 for(const client of [visitor,admin,env.unauthenticatedContext().firestore()]){
  await assertFails(getDoc(doc(client,'users/owner')));
  await assertFails(getDocs(collection(client,'users')));
  await assertFails(getDocs(query(collection(client,'users'),where('email','==','private@example.test'))));
 }
 await assertSucceeds(getDoc(doc(visitor,'users/owner/public_profile/main')));
 await db.doc('users/owner').update({isProfileVisible:false});
 await assertFails(getDoc(doc(visitor,'users/owner/public_profile/main')));
 await assertSucceeds(getDoc(doc(own,'users/owner/public_profile/main')));
 await assertSucceeds(getDoc(doc(visitor,'users/owner/tasks/shared')));
 await assertFails(getDoc(doc(visitor,'users/owner/tasks/private')));
});
test('server returns a bounded paginated public projection, never private fields or hidden identities',async()=>{
 const batch=db.batch();
 for(let i=0;i<45;i++){
  const uid='user-'+String(i).padStart(2,'0');
  batch.set(db.doc('users/'+uid),{uid,name:'Nome '+i,photoUrl:'https://example.test/photo',email:'private@example.test',cpf:'synthetic',isProfileVisible:true});
 }
 batch.set(db.doc('users/reserved'),{uid:'reserved',name:'Reserved',isProfileVisible:false,email:'private@example.test'});
 await batch.commit();
 const first=await readVisibleSocialDirectoryPage(db,'viewer');
 assert.equal(first.entries.length,40);
 assert.ok(first.nextCursor);
 const second=await readVisibleSocialDirectoryPage(db,'viewer',first.nextCursor!);
 assert.equal(second.entries.length,5);
 assert.equal(second.nextCursor,null);
 const all=[...first.entries,...second.entries];
 assert.equal(new Set(all.map(x=>x.id)).size,45);
 for(const entry of all)assert.deepEqual(Object.keys(entry).sort(),['id','isProfileVisible','name','photoUrl']);
 assert.deepEqual(await readVisibleAuthorIdentities(db,'viewer',['reserved']),[]);
 await db.doc('users/user-00').update({isProfileVisible:false});
 assert.deepEqual(await readVisibleAuthorIdentities(db,'viewer',['user-00']),[]);
});
test('shared quota is atomic and clients cannot access or manipulate it',async()=>{
 const now=1800000000000;
 for(let i=0;i<11;i++)assert.equal((await consumeDirectoryQuota(db,'viewer','social',now)).allowed,true);
 const last=await Promise.all([consumeDirectoryQuota(db,'viewer','social',now),consumeDirectoryQuota(db,'viewer','social',now)]);
 assert.equal(last.filter(x=>x.allowed).length,1);
 const saved=await db.collection('directory_quota_private').get();
 assert.equal(saved.size,1);
 assert.equal(saved.docs[0].get('count'),12);
 const viewer=env.authenticatedContext('viewer').firestore();
 const ref=doc(viewer,saved.docs[0].ref.path);
 await assertFails(getDoc(ref));
 await assertFails(updateDoc(ref,{count:1}));
 await assertFails(setDoc(doc(viewer,'directory_quota_private/forged'),{count:1}));
 assert.equal((await consumeDirectoryQuota(db,'viewer','social',now+60000)).allowed,true);
});

test('coordinated candidate denies direct professional creation but preserves authorized server invitation and recipient response',async()=>{
 const store=db.doc('stores/store-cutover');
 await store.set({id:'store-cutover',ownerId:'owner',name:'Loja de teste',publicationStatus:'paused'});
 await db.doc('users/recipient').set({uid:'recipient',name:'Reservado',email:'private@example.test',isProfileVisible:false});
 await db.doc('erp_age_release_private/current').set({schemaVersion:1,mode:'verified_adult_only'});
 for(const uid of ['owner','recipient'])await db.doc('age_eligibility_private/'+uid).set({uid,status:'verified_adult'});
 const owner=env.authenticatedContext('owner').firestore();
 const recipient=env.authenticatedContext('recipient').firestore();
 const stranger=env.authenticatedContext('stranger').firestore();
 const memberPath='stores/store-cutover/members/recipient';
 await assertFails(setDoc(doc(owner,memberPath),{
  storeId:'store-cutover',userId:'recipient',role:'seller',status:'invited',invitedBy:'owner',
  invitedAt:serverTimestamp(),createdAt:serverTimestamp(),updatedAt:serverTimestamp()
 }));
 const authority={
  async getUserByEmail(email:string){
   if(email!=='recipient@example.test')throw Object.assign(Error('not found'),{code:'auth/user-not-found'});
   return {uid:'recipient',emailVerified:true,disabled:false};
  },
  async getUser(uid:string){return {uid,emailVerified:true,disabled:false};}
 };
 const result=await createStoreStaffInvitation(db,authority,'owner','store-cutover','recipient','recipient@example.test','seller');
 assert.deepEqual(result,{status:'invited',userId:'recipient'});
 assert.equal((await assertSucceeds(getDoc(doc(recipient,memberPath)))).get('email'),'');
 await assertSucceeds(getDoc(doc(owner,memberPath)));
 await assertFails(getDoc(doc(stranger,memberPath)));
 await assertFails(getDoc(doc(owner,'users/recipient')));
 await assertFails(updateDoc(doc(stranger,memberPath),{status:'active',acceptedAt:serverTimestamp(),updatedAt:serverTimestamp()}));
 await assertSucceeds(updateDoc(doc(recipient,memberPath),{status:'active',acceptedAt:serverTimestamp(),updatedAt:serverTimestamp()}));
 assert.equal((await store.collection('members').doc('recipient').get()).get('status'),'active');
});
test('new social connections honor visibility while existing participants retain scoped access',async()=>{
 await db.doc('users/target').set({uid:'target',name:'Target',isProfileVisible:false});
 const actor=env.authenticatedContext('actor').firestore();
 const target=env.authenticatedContext('target').firestore();
 const other=env.authenticatedContext('other').firestore();
 const path='connections/actor_target';
 const payload=()=>({senderId:'actor',receiverId:'target',participantIds:['actor','target'],status:'pending',createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
 await assertFails(setDoc(doc(actor,path),payload()));
 await db.doc('users/target').update({isProfileVisible:true});
 await assertSucceeds(setDoc(doc(actor,path),payload()));
 await db.doc('users/target').update({isProfileVisible:false});
 await assertFails(getDoc(doc(actor,'users/target')));
 await assertSucceeds(getDoc(doc(actor,path)));
 await assertSucceeds(getDoc(doc(target,path)));
 await assertFails(getDoc(doc(other,path)));
 await assertSucceeds(updateDoc(doc(target,path),{status:'accepted',acceptedAt:serverTimestamp(),updatedAt:serverTimestamp()}));
 assert.equal((await db.doc(path).get()).get('status'),'accepted');
});
test('private age and quota records cannot be read, altered or forged directly by any client',async()=>{
 const age='age_eligibility_private/owner';
 const quota='users/owner/semeaduraDailyUsage/2026-11-26';
 await db.doc(age).set({uid:'owner',status:'declared_underage'});
 await db.doc(quota).set({actorId:'owner',day:'2026-11-26',schemaVersion:1,count:100});
 for(const client of [env.authenticatedContext('owner').firestore(),env.authenticatedContext('other').firestore(),env.authenticatedContext('admin',{role:'admin'}).firestore(),env.unauthenticatedContext().firestore()]){
  for(const path of [age,quota]){
   const ref=doc(client,path);
   await assertFails(getDoc(ref));
   await assertFails(updateDoc(ref,{status:'verified_adult',count:1}));
   await assertFails(deleteDoc(ref));
  }
  await assertFails(setDoc(doc(client,'age_eligibility_private/forged'),{uid:'forged',status:'verified_adult'}));
  await assertFails(setDoc(doc(client,'users/owner/semeaduraDailyUsage/2026-11-27'),{actorId:'owner',count:1}));
 }
 assert.equal((await db.doc(age).get()).get('status'),'declared_underage');
 assert.equal((await db.doc(quota).get()).get('count'),100);
});
