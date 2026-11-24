import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createTribeVerifier,verifyTribeCode,validTribeCode,failedTribeAttempt,tribeAttemptLocked,issueTribeSession,validTribeSession,TRIBE_LOCK_MS,TRIBE_SESSION_MS} from '../server/identity/reservedTribeSecurity';
test('reserved tribe codes are exact, salted and never stored as plaintext',async()=>{
 const code='tribo!9421';
 const [a,b]=await Promise.all([createTribeVerifier(code),createTribeVerifier(code)]);
 assert.notEqual(a.salt,b.salt);assert.notEqual(a.digest,b.digest);
 assert.equal(JSON.stringify(a).includes(code),false);
 assert.equal(await verifyTribeCode(code,a),true);
 assert.equal(await verifyTribeCode('Tribo!9421',a),false);
 for(const invalid of ['1234',' '+code,code+' ','x'.repeat(65),'code\n1234'])assert.equal(validTribeCode(invalid),false);
 await assert.rejects(createTribeVerifier('1234'),/TRIBE_CODE_INVALID/);
});
test('five failed attempts lock the account; expiry starts a new attempt window',()=>{
 const now=1000000;let state={failures:0,lockedUntil:0};
 for(let i=0;i<4;i++){state=failedTribeAttempt(state,now);assert.equal(tribeAttemptLocked(state,now),false);}
 state=failedTribeAttempt(state,now);assert.equal(state.lockedUntil,now+TRIBE_LOCK_MS);
 assert.equal(tribeAttemptLocked(state,now+1),true);
 assert.deepEqual(failedTribeAttempt(state,now+1),state);
 assert.deepEqual(failedTribeAttempt(state,now+TRIBE_LOCK_MS),{failures:1,lockedUntil:0});
});
test('session expires, is opaque and cannot be reused with a different digest',()=>{
 const now=2000000,a=issueTribeSession(now),b=issueTribeSession(now);
 assert.notEqual(a.token,a.digest);
 assert.equal(a.expiresAt,now+TRIBE_SESSION_MS);
 assert.equal(validTribeSession(a.token,a.digest,a.expiresAt,now),true);
 assert.equal(validTribeSession(a.token,b.digest,b.expiresAt,now),false);
 assert.equal(validTribeSession(a.token,a.digest,a.expiresAt,a.expiresAt),false);
 assert.equal(validTribeSession(a.token,'',0,now),false);
});
test('vault is server-only and the foundation is not exposed prematurely',()=>{
 const rules=readFileSync('firestore.contact-groups.fragment.rules','utf8');
 const api=readFileSync('api/health.ts','utf8');
 const service=readFileSync('server/identity/reservedTribeService.ts','utf8');
 assert.match(rules,/match \/reserved_tribe_vaults\/\{userId\} \{\s*allow read, write: if false;/);
 assert.match(service,/runTransaction/);
 assert.doesNotMatch(api,/reservedTribeService/);
});

test('reserved membership is server-only and the directory projection is gated',()=>{
 const rules=readFileSync('firestore.contact-groups.fragment.rules','utf8');
 const service=readFileSync('server/identity/reservedTribeService.ts','utf8');
 assert.match(rules,/match \/reserved_tribe_vaults\/\{userId\}\/contacts\/\{peerId\} \{\s*allow read, write: if false;/);
 assert.match(service,/listOrdinaryTribeConnections/);
 assert.match(service,/listReservedTribeConnections/);
 assert.match(service,/authorizeTribeRelationship/);
 assert.match(service,/requireSession\(config,token\)/);
});

test('reserved chat direct access is denied and server operations enforce relationship authorization',()=>{
 const rules=readFileSync('firestore.rules','utf8');
 const chat=readFileSync('server/identity/reservedTribeChatService.ts','utf8');
 const service=readFileSync('server/identity/reservedTribeService.ts','utf8');
 assert.match(rules,/reserved_tribe_vaults\/\$\(request.auth.uid\)\/contacts\/\$\(ownReservedPeer\(\)\)/);
 assert.match(chat,/export async function readTribeChat/);
 assert.match(chat,/export async function sendTribeChatMessage/);
 assert.match(chat,/export async function clearTribeChatHistory/);
 assert.match(chat,/authorizeTribeRelationship\(tx,actor,connectionId,token\)/);
 assert.match(chat,/where\('createdAt','>',cutoff\)/);
 assert.match(chat,/history_state'\)\.doc\(actor\)/);
 assert.match(service,/ownBlock.exists\|\|otherBlock.exists/);
 assert.doesNotMatch(readFileSync('api/health.ts','utf8'),/reservedTribeChatService/);
});

test('ordinary directory and forward destinations are server-projected, not UI-hidden',()=>{
 const rules=readFileSync('firestore.rules','utf8');
 const groups=readFileSync('firestore.contact-groups.fragment.rules','utf8');
 const forwarding=readFileSync('firestore.communities.fragment.rules','utf8');
 const service=readFileSync('server/identity/reservedTribeService.ts','utf8');
 assert.match(rules,/ordinaryDirectoryClientAllowed\(request.auth.uid\)/);
 assert.match(groups,/ordinaryDirectoryClientAllowed\(userId\)/);
 assert.match(forwarding,/isUnreservedPeer\(request.auth.uid, data.receiverId\)/);
 assert.match(service,/getOrdinaryTribeDirectory/);
 assert.match(service,/authorizeOrdinaryForward/);
 assert.match(service,/directoryProtected:true/);
});
