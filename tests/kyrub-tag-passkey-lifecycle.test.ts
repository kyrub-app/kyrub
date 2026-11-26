import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertPasskeyTagState,isPasskeyMutation,normalizePasskeyMutation,assertSamePasskeyCredential} from '../server/identity/kyrubTagPasskeyState';
const virgin={distribution:'promotional',model:'adesivo',ownerId:null,activationHash:null,enabled:false,manufacturingState:'released'};
const owned={...virgin,ownerAuthMode:'passkey',ownerId:'tagpk_'+'x'.repeat(43),enabled:true};
test('only open stock may register and only passkey-owned stock may mutate',()=>{
 assert.doesNotThrow(()=>assertPasskeyTagState(virgin,'register'));
 for(const data of [{...virgin,manufacturingState:'held'},{...virgin,pilotBatch:'experimental-001'},{...virgin,ownerId:'email-user'},{...virgin,ownerAuthMode:'passkey'},owned])assert.throws(()=>assertPasskeyTagState(data,'register'));
 assert.doesNotThrow(()=>assertPasskeyTagState(owned,'edit'));
 assert.throws(()=>assertPasskeyTagState({...owned,ownerAuthMode:'email'},'edit'));
 assert.throws(()=>assertPasskeyTagState({...owned,blocked:true},'edit'));
 assert.doesNotThrow(()=>assertPasskeyTagState({...owned,blocked:true},'unblock'));
 assert.throws(()=>assertPasskeyTagState(owned,'unblock'));
 assert.equal(isPasskeyMutation('link-account'),false);
});
test('payload is bounded to the authenticated operation and public text',()=>{
 const card={name:'Ana',occupation:'Autônoma',about:'Olá'};
 assert.deepEqual(normalizePasskeyMutation('register',card),card);
 assert.throws(()=>normalizePasskeyMutation('register',{...card,name:''}));
 assert.throws(()=>normalizePasskeyMutation('edit',{...card,emergencyContacts:[]}));
 assert.throws(()=>normalizePasskeyMutation('block',card));
 assert.equal(normalizePasskeyMutation('block',null),null);
});
test('credential changes invalidate stale authentication',()=>{
 const c={id:'key',publicKey:'YWJj',counter:1,userHandle:'x'.repeat(43),backedUp:false};
 assert.doesNotThrow(()=>assertSamePasskeyCredential(c,{...c}));
 assert.throws(()=>assertSamePasskeyCredential(c,{...c,counter:2}));
 assert.throws(()=>assertSamePasskeyCredential(c,{...c,id:'finder'}));
});
test('internal transaction consumes proof with mutation, legacy paths cannot bypass',()=>{
 const svc=readFileSync('server/identity/kyrubTagPasskeyLifecycle.ts','utf8');
 assert.match(svc,/assertTagPilotWriteIsolated\(\)/);
 assert.match(svc,/KYRUB_TAG_PASSKEY_PILOT_ENABLED/);
 assert.match(svc,/tx.create\(marker/);
 assert.match(svc,/tx.update\(challengeRef,\{usedAt:now,presentation:null\}\)/);
 assert.doesNotMatch(svc,/createCustomToken\(|createUser\(/);
 const legacy=readFileSync('server/identity/kyrubTagService.ts','utf8');
 for(const method of ['claimPromotionalKyrubTag','recoverPromotionalKyrubTag','rotatePromotionalRecoveryCode','configurePromotionalKyrubTag','setPromotionalBlock','disableKyrubTag']){
  const section=legacy.split('export async function '+method)[1].split('export async function ')[0];
  assert.match(section,/ownerAuthMode==='passkey'/);
 }
});
