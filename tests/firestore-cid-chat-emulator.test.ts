import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {initializeApp,getApps,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,collection,getDocs} from 'firebase/firestore';
import {assertCidSosEmulator,CID_EMULATOR_PROJECT} from '../server/identity/cidSosEmulatorStore';
import {createCidChatEmulatorStore} from '../server/identity/cidChatEmulatorStore';
import {planCidSosAlert} from '../server/identity/cidSosAlertPolicy';

assertCidSosEmulator();
const app=initializeApp({projectId:CID_EMULATOR_PROJECT},'cid-chat-emulator-fixtures');
const db=getFirestore(app);
const now=Date.UTC(2026,10,26,12);
const tagId='a'.repeat(32),occurrenceId='b'.repeat(32);
const participant=(id:string)=>({id,channels:[{channel:'email' as const,address:id+'@example.invalid',verifiedAt:now-1000,consent:true}]});
const profile={tagId,ownerId:'owner-test',displayName:'CID fictício',active:true,enabled:true,owner:participant('owner-test'),contacts:[participant('contact-a'),participant('contact-b')]};
const occurrence=planCidSosAlert(profile,{id:occurrenceId,confirmed:true,reason:'Animal encontrado',sms:false},now,[]).occurrence;
const occurrenceRef=db.collection('cid_sos_emulator_tags').doc(tagId).collection('occurrences').doc(occurrenceId);
const chatRef=occurrenceRef.collection('chat').doc('state');
const token=()=>randomBytes(32).toString('base64url');
async function fixtureProof(kind:string,memberId:string){
 const id=token(),secret=token();
 await chatRef.collection('fixtureProofs').doc(id).set({kind,memberId,chatId:occurrenceId,tagId,digest:createHash('sha256').update(secret).digest('hex'),expiresAt:now+600000});
 return {id,secret};
}
after(async()=>{for(const candidate of getApps().filter(a=>a.name==='cid-chat-emulator-fixtures'||a.name==='cid-chat-local-emulator'))await deleteApp(candidate);});

test('chat persisted with scoped fixture proofs, single-use invitations, safe projection and closed history',async()=>{
 await occurrenceRef.set(occurrence);
 const store=createCidChatEmulatorStore(tagId,occurrenceId);
 const emitterProof=await fixtureProof('emitter-session','emitter-test');
 await assert.rejects(store.start({...emitterProof,secret:token()},now));
 const emitter=await store.start(emitterProof,now);
 await assert.rejects(store.start(emitterProof,now));
 const ownerProof=await fixtureProof('owner-passkey','owner-test');
 const owner=await store.openOwner(ownerProof,now+1);
 await assert.rejects(store.openOwner(ownerProof,now+1));
 const delivery=await fixtureProof('delivery-service','contact-a');
 await assert.rejects(store.issueInvite(delivery,'contact-b',now+2));
 const invite=await store.issueInvite(delivery,'contact-a',now+2);
 const wrong=await fixtureProof('contact-channel','contact-b');
 await assert.rejects(store.redeem(invite,wrong,now+3));
 const proof=await fixtureProof('contact-channel','contact-a');
 const anotherProof=await fixtureProof('contact-channel','contact-a');
 const redeemed=await Promise.allSettled([store.redeem(invite,proof,now+4),store.redeem(invite,anotherProof,now+4)]);
 assert.equal(redeemed.filter(r=>r.status==='fulfilled').length,1);
 const contact=redeemed.find(r=>r.status==='fulfilled');
 assert.ok(contact&&contact.status==='fulfilled');
 const session=contact.value;
 const input={id:'msg-a',body:'Encontrei o animal.'};
 const sent=await Promise.all([store.send(emitter,input,now+5),store.send(emitter,input,now+5)]);
 assert.equal(sent.filter(r=>r.duplicate).length,1);
 await assert.rejects(store.send(session,input,now+6));
 await assert.rejects(store.send(emitter,{...input,body:'outro texto'},now+6));
 await assert.rejects(store.send(emitter,{id:'msg-b',body:'texto',authorId:'owner-test'},now+6));
 const view=await store.read(owner,now+6);
 assert.equal(view.reason,'Animal encontrado');assert.equal(view.participantCount,4);
 assert.equal(view.messages.length,2);assert.equal(view.messages[1].authorLabel,'Emissor do alerta');
 assert.equal(view.hasOlderMessages,false);
 assert.ok(!JSON.stringify(view).includes('@example.invalid'));
 assert.ok(!JSON.stringify(view).includes(emitter.secret));
 assert.ok(!JSON.stringify(view).includes('emitter-test'));
 assert.ok(!JSON.stringify((await chatRef.collection('sessions').doc(owner.id).get()).data()).includes(owner.secret));
 await assert.rejects(store.close(session,now+7));
 await store.revokeOwnSession(session,now+7);
 await assert.rejects(store.read(session,now+8));
 await store.close(owner,now+8);
 await assert.rejects(store.send(emitter,{id:'msg-c',body:'texto'},now+9));
 assert.equal((await store.read(owner,now+9)).closed,true);
 const rules=await initializeTestEnvironment({projectId:CID_EMULATOR_PROJECT,firestore:{host:'127.0.0.1',port:8088,rules:readFileSync('.firebase/firestore.combined.rules','utf8')}});
 try{
  for(const context of [rules.unauthenticatedContext(),rules.authenticatedContext('owner-test'),rules.authenticatedContext('stranger')]){
   const client=context.firestore();
   for(const path of [chatRef.path,chatRef.path+'/sessions/'+owner.id,chatRef.path+'/invites/'+invite.id,chatRef.path+'/fixtureProofs/'+ownerProof.id,chatRef.path+'/messages/msg-a']){
    await assertFails(getDoc(doc(client,path)));await assertFails(setDoc(doc(client,path),{forged:true}));
   }
   await assertFails(getDocs(collection(client,chatRef.path+'/messages')));
  }
 }finally{await rules.cleanup();}
});
