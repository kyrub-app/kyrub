import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {after,before,beforeEach,test} from 'node:test';
import {initializeApp,deleteApp,type App} from 'firebase-admin/app';
import {getFirestore,type Firestore} from 'firebase-admin/firestore';
import {initializeTestEnvironment,assertFails,assertSucceeds,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {collection,doc,getDoc,getDocs,setDoc,updateDoc,query,where} from 'firebase/firestore';
import {readVisibleSocialDirectoryPage,readVisibleAuthorIdentities} from '../server/identity/socialDiscoveryDirectoryService';
import {consumeDirectoryQuota} from '../server/identity/directoryQuotaService';

const projectId='demo-kyrub-privacy';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8088');
let app:App, db:Firestore, env:RulesTestEnvironment;
before(async()=>{
 const baseline=readFileSync('.firebase/firestore.combined.rules','utf8');
 const root=/match \/users\/\{userId\}\s*\{\s*allow read: if isSignedIn\(\);/g;
 assert.equal([...baseline.matchAll(root)].length,1);
 // Do not change the actual rules artifact or deploy the candidate.
 let rules=baseline.replace(root,"match /users/{userId} {\n allow get: if isSignedIn() && request.auth.uid == userId;\n allow list: if false;");
 const start=rules.indexOf('match /users/{userId}/public_profile/{profileId}');
 assert.ok(start>=0);
 const end=rules.indexOf('allow read: if isSignedIn();',start);
 assert.ok(end>=0&&end-start<3000);
 rules=rules.slice(0,end)+`allow get: if isSignedIn() && profileId == 'main' &&
 (request.auth.uid == userId || (exists(/databases/$(database)/documents/users/$(userId)) &&
 get(/databases/$(database)/documents/users/$(userId)).data.isProfileVisible == true));
 allow list: if false;`+rules.slice(end+'allow read: if isSignedIn();'.length);
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
