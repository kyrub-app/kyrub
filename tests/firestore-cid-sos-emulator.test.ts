import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {readFileSync} from 'node:fs';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,collection,getDocs} from 'firebase/firestore';
import {assertCidSosEmulator,createCidSosEmulatorStore,CID_EMULATOR_PROJECT} from '../server/identity/cidSosEmulatorStore';
import {prepareCidSosConfig,type ChannelGrant} from '../server/identity/cidSosPrivateConfig';
import {recordSimulatedCidSos} from '../server/identity/cidSosOccurrenceStore';

assertCidSosEmulator();
const app=initializeApp({projectId:CID_EMULATOR_PROJECT},'cid-sos-emulator-fixtures');
const db=getFirestore(app);
const now=Date.UTC(2026,10,26,12);
const tag={tagId:'a'.repeat(32),ownerId:'owner-test',displayName:'CID fictício',active:true};
const root=db.collection('cid_sos_emulator_tags').doc(tag.tagId);
const person=(id:string)=>({id,name:id,channels:[{channel:'email',address:id+'@example.invalid'}]});
const config=prepareCidSosConfig(tag,tag.ownerId,null,{expectedRevision:0,enabled:true,owner:person(tag.ownerId),contacts:[person('contact-test')]});
const grants:ChannelGrant[]=[config.owner,...config.contacts].flatMap(p=>p.channels.map(c=>({...c,tagId:tag.tagId,ownerId:tag.ownerId,participantId:p.id,verifiedAt:now-1000,consent:true})));
const input={id:'b'.repeat(32),confirmed:true,reason:'Animal encontrado',sms:false};
after(async()=>{await deleteApp(app);});

test('emulator guard rejects production, missing flag, remote hosts and explicit credentials',()=>{
 for(const override of [{VERCEL_ENV:'production'},{VERCEL_ENV:'preview'},{KYRUB_CID_SOS_EMULATOR:'false'},{GCLOUD_PROJECT:'kyrub-b8d0e'},{FIRESTORE_EMULATOR_HOST:'example.com:8088'},{GOOGLE_APPLICATION_CREDENTIALS:'/tmp/key'}]){
  assert.throws(()=>assertCidSosEmulator({...process.env,...override}),/EMULATOR_ONLY/);
 }
});
test('real emulator transaction serializes concurrent submissions, rejects duplicates and protects direct client access',async()=>{
 await root.set({tag,revision:0});
 await root.collection('private').doc('config').set({config});
 await root.collection('private').doc('grants').set({grants});
 const store=createCidSosEmulatorStore(tag.tagId);
 const results=await Promise.allSettled([recordSimulatedCidSos(store,tag.tagId,input,now),recordSimulatedCidSos(store,tag.tagId,{...input,id:'c'.repeat(32)},now)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await root.collection('occurrences').get()).size,1);
 assert.equal((await root.collection('outbox').get()).size,2);
 assert.equal((await root.get()).get('revision'),1);
 const actual=(await root.collection('occurrences').get()).docs[0].id;
 await recordSimulatedCidSos(store,tag.tagId,{...input,id:actual},now);
 assert.equal((await root.collection('outbox').get()).size,2);
 await assert.rejects(store.transaction(async tx=>{
  await tx.readTag(tag.tagId);throw Error('simulated rollback');
 }));
 assert.equal((await root.get()).get('revision'),1);
 const env=await initializeTestEnvironment({projectId:CID_EMULATOR_PROJECT,firestore:{host:'127.0.0.1',port:8088,rules:readFileSync('.firebase/firestore.combined.rules','utf8')}});
 try{
  for(const context of [env.unauthenticatedContext(),env.authenticatedContext(tag.ownerId),env.authenticatedContext('stranger')]){
   const client=context.firestore();
   for(const path of [root.path,root.path+'/private/config',root.path+'/private/grants',root.path+'/occurrences/'+actual,'cid_sos_emulator_request_index/'+actual]){
    await assertFails(getDoc(doc(client,path)));await assertFails(setDoc(doc(client,path),{forged:true}));
   }
   await assertFails(getDocs(collection(client,root.path+'/outbox')));
  }
 }finally{await env.cleanup();}
});
