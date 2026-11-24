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

test('ordinary searches and deliberate unlock commands are distinct and preserve exact code',async()=>{
 const {splitTribeSearchInput,matchesTribeContactName}=await import('../src/utils/tribeContactSearch.js');
 assert.deepEqual(splitTribeSearchInput('João',true),{kind:'search',term:'João'});
 assert.equal(matchesTribeContactName('João Silva','joao'),true);
 assert.deepEqual(splitTribeSearchInput('!Secret!123',true),{kind:'unlock',code:'Secret!123'});
 assert.deepEqual(splitTribeSearchInput('!Secret!123',false),{kind:'search',term:'!Secret!123'});
 assert.deepEqual(splitTribeSearchInput('!',true),{kind:'unlock',code:''});
 const component=readFileSync('src/components/ReservedTribeSearchInput.tsx','utf8');
 assert.match(component,/secretMode\?'password':'search'/);
 assert.match(component,/await onUnlock\(code,controller.signal\)/);
 assert.doesNotMatch(component,/localStorage|sessionStorage|console\.|fetch\(/);
 assert.match(readFileSync('src/components/ReservedTribePilotPanel.tsx','utf8'),/ReservedTribeSearchInput/);
});

test('recovery accepts only verified fresh authentication, not token refresh or replay',async()=>{
 const {validTribeRecoveryProof}=await import('../server/identity/reservedTribeSecurity.js');
 const now=1_000_000,proof={uid:'owner',email_verified:true,auth_time:990};
 assert.equal(validTribeRecoveryProof(proof,'owner',0,now),true);
 assert.equal(validTribeRecoveryProof({...proof,email_verified:false},'owner',0,now),false);
 assert.equal(validTribeRecoveryProof({...proof,auth_time:699},'owner',0,now),false);
 assert.equal(validTribeRecoveryProof({...proof,auth_time:1001},'owner',0,now),false);
 assert.equal(validTribeRecoveryProof(proof,'another',0,now),false);
 assert.equal(validTribeRecoveryProof(proof,'owner',990,now),false);
 assert.equal(validTribeRecoveryProof({...proof,auth_time:991},'owner',990,now),true);
 const recovery=readFileSync('server/identity/reservedTribeRecoveryService.ts','utf8');
 assert.match(recovery,/adminAuth.verifyIdToken\(token,true\)/);
 assert.match(recovery,/lastRecoveryAuthTime:identity.auth_time/);
 assert.match(recovery,/sessionDigest:'',sessionExpiresAt:0/);
 assert.doesNotMatch(readFileSync('api/health.ts','utf8'),/reservedTribeRecoveryService/);
});

test('cached social data is never considered current authorization',async()=>{
 const {isConfirmedSocialSnapshot}=await import('../src/utils/socialSnapshotAuthority.js');
 const online={fromCache:false,hasPendingWrites:false};
 assert.equal(isConfirmedSocialSnapshot(online,'owner','owner'),true);
 assert.equal(isConfirmedSocialSnapshot({...online,fromCache:true},'owner','owner'),false);
 assert.equal(isConfirmedSocialSnapshot({...online,hasPendingWrites:true},'owner','owner'),false);
 assert.equal(isConfirmedSocialSnapshot(online,'owner','other'),false);
 assert.equal(isConfirmedSocialSnapshot(online,undefined,undefined),false);
 const firebase=readFileSync('src/utils/firebase.ts','utf8');
 const chat=readFileSync('src/hooks/useChatMessages.ts','utf8');
 const directory=readFileSync('src/hooks/useSocialDirectoryV2.ts','utf8');
 const forward=readFileSync('src/utils/communityPostConnections.ts','utf8');
 const profile=readFileSync('src/components/ProfileSocialHubNative.tsx','utf8');
 assert.match(firebase,/socialMemoryPilot&&!isolatedE2E/);
 assert.match(firebase,/localCache:memoryLocalCache\(\)/);
 assert.match(firebase,/persistentLocalCache\(/);
 assert.match(chat,/setMessages\(\[\]\);setMessageScope\(''\)/);
 assert.match(chat,/historyReady && messageScope===scope/);
 assert.match(directory,/if\(!directoryReady\)return \[\]/);
 assert.match(directory,/friends:directoryReady\?friends:\[\]/);
 assert.match(forward,/error=>\{onChange\(\[\]\);onError\(error\);\}/);
 assert.match(profile,/snapshot.metadata.fromCache\|\|snapshot.metadata.hasPendingWrites\)\{setGroups\(\[\]\)/);
});

test('pilot route is explicitly disabled outside local isolated Auth and Firestore emulators',async()=>{
 const {reservedTribePilotEnvironmentAllowed,parseReservedTribePilotBody,createReservedTribePilotHandler}=await import('../server/identity/reservedTribePilotTransport.js');
 const env={KYRUB_RESERVED_TRIBE_PILOT:'true',FIREBASE_PROJECT_ID:'kyrub-security-test',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8088',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099'};
 assert.equal(reservedTribePilotEnvironmentAllowed(env),true);
 for(const override of [{VERCEL:'1'},{VERCEL_ENV:'preview'},{NODE_ENV:'production'},{FIREBASE_PROJECT_ID:'kyrub-b8d0e'},{FIREBASE_PROJECT_ID:'kyrub-tags'},{FIRESTORE_EMULATOR_HOST:undefined},{FIREBASE_AUTH_EMULATOR_HOST:undefined},{KYRUB_RESERVED_TRIBE_PILOT:'false'}])assert.equal(reservedTribePilotEnvironmentAllowed({...env,...override}),false);
 assert.throws(()=>parseReservedTribePilotBody({action:'unlock',code:'test!code',uid:'other'}),/TRIBE_INVALID/);
 assert.throws(()=>parseReservedTribePilotBody({action:'reserved-directory'}),/TRIBE_INVALID/);
 assert.throws(()=>parseReservedTribePilotBody({action:'constructor'}),/TRIBE_INVALID/);
 assert.throws(()=>parseReservedTribePilotBody({action:'membership',session:'bad',peerId:'peer',reserved:true}),/TRIBE_INVALID/);
 assert.equal(parseReservedTribePilotBody({action:'unlock',code:'test!code'}).action,'unlock');
 let status=0,called=0;
 const res={setHeader:()=>{},status(value:number){status=value;return this;},json:()=>{}};
 const handler=createReservedTribePilotHandler({allowed:()=>false,project:()=>{called++;return 'kyrub-security-test';},verify:async()=>{called++;return {uid:'owner',email_verified:true};}});
 await handler({method:'POST',headers:{authorization:'Bearer synthetic'},body:{action:'status'}},res);
 assert.equal(status,404);assert.equal(called,0);
 const client=readFileSync('src/utils/reservedTribePilotClient.ts','utf8');
 assert.match(client,/VITE_KYRUB_SOCIAL_MEMORY_CACHE_E2E/);
 assert.match(client,/cache:'no-store'/);
 assert.doesNotMatch(client,/localStorage|sessionStorage|console\./);
});

test('pilot panel uses only isolated API projections and clears protected data on exit',()=>{
 const profile=readFileSync('src/components/ProfileSocialHubNative.tsx','utf8');
 const panel=readFileSync('src/components/ReservedTribePilotPanel.tsx','utf8');
 const server=readFileSync('server.ts','utf8');
 assert.match(profile,/activeTab === 'connected' && reservedTribePilotClientEnabled\(\)/);
 assert.match(profile,/activeTab === 'connected' && !reservedTribePilotClientEnabled\(\)/);
 assert.match(server,/app.post\('\/api\/social\/reserved-tribe'/);
 assert.match(panel,/setSession\(null\);setReserved\(null\);setTarget\(null\)/);
 assert.match(panel,/visibilitychange/);
 assert.match(panel,/session.expiresAt-Date.now\(\)/);
 assert.doesNotMatch(panel,/localStorage|sessionStorage|firebase\/firestore/);
});

test('tribe mutations accept explicit desired membership, not client replacements',async()=>{
 const {parseReservedTribePilotBody}=await import('../server/identity/reservedTribePilotTransport.js');
 assert.equal(parseReservedTribePilotBody({action:'tribe-member',groupId:'group',connectionId:'pair',member:true}).action,'tribe-member');
 assert.throws(()=>parseReservedTribePilotBody({action:'tribe-member',groupId:'group',connectionId:'pair',member:true,memberIds:[]}),/TRIBE_INVALID/);
 assert.throws(()=>parseReservedTribePilotBody({action:'tribe-create',groupId:'group',name:' '.repeat(4)}),/TRIBE_INVALID/);
 assert.throws(()=>parseReservedTribePilotBody({action:'tribe-delete',groupId:'group',uid:'other'}),/TRIBE_INVALID/);
});

test('ordinary and reserved chat actions have separate transport contracts and one ephemeral view',async()=>{
 const {parseReservedTribePilotBody}=await import('../server/identity/reservedTribePilotTransport.js');
 assert.equal(parseReservedTribePilotBody({action:'ordinary-chat-read',connectionId:'pair'}).action,'ordinary-chat-read');
 assert.throws(()=>parseReservedTribePilotBody({action:'ordinary-chat-read',connectionId:'pair',session:'a'.repeat(64)}),/TRIBE_INVALID/);
 assert.throws(()=>parseReservedTribePilotBody({action:'chat-read',connectionId:'pair'}),/TRIBE_INVALID/);
 assert.throws(()=>parseReservedTribePilotBody({action:'ordinary-chat-send',connectionId:'pair',messageId:'msg',text:'x'.repeat(4001)}),/TRIBE_INVALID/);
 const ui=readFileSync('src/components/TribePilotChat.tsx','utf8');
 assert.match(ui,/POLL_MS=5000/);
 assert.match(ui,/sequence.current===id/);
 assert.doesNotMatch(ui,/localStorage|sessionStorage|firebase\/firestore/);
});

test('recovery UI requires provider reauthentication before the new code and never persists secrets',()=>{
 const panel=readFileSync('src/components/ReservedTribePilotPanel.tsx','utf8');
 const recovery=readFileSync('src/components/ReservedTribeRecoveryPanel.tsx','utf8');
 assert.match(panel,/recovering&&!session\?<ReservedTribeRecoveryPanel/);
 assert.match(recovery,/reauthenticateWithPopup\(user,provider\)/);
 assert.match(recovery,/reauthenticateWithCredential\(user,EmailAuthProvider.credential/);
 assert.match(recovery,/getIdTokenResult\(true\)/);
 assert.match(recovery,/authTime<Math.floor\(started\/1000\)\*1000/);
 assert.match(recovery,/phase!=='code'/);
 assert.match(recovery,/request<\{recovered:true\}>\('recover',fields,controller.signal\)/);
 assert.match(recovery,/visibilitychange/);
 assert.doesNotMatch(recovery,/localStorage|sessionStorage|console\.|signInWithPopup\(/);
});

test('privacy invalidation carries no identity or secret and the server probe is authoritative',async()=>{
 const signal=readFileSync('src/utils/socialPrivacyInvalidation.ts','utf8');
 const panel=readFileSync('src/components/ReservedTribePilotPanel.tsx','utf8');
 const bridge=readFileSync('src/components/UserNotificationCenterBridge.tsx','utf8');
 assert.match(signal,/postMessage\('refresh'\)/);
 assert.doesNotMatch(signal,/localStorage\.|sessionStorage\.|token:|peerId:|uid:/);
 assert.match(panel,/subscribeSocialPrivacyInvalidation\(invalidate,false\)/);
 assert.match(panel,/s\?'session-check':'status'/);
 assert.match(panel,/status.revision!==dir.revision/);
 assert.match(panel,/directory.revision!==ordinaryNow.revision/);
 assert.match(bridge,/subscribeSocialPrivacyInvalidation\(invalidate\)/);
 const {parseReservedTribePilotBody}=await import('../server/identity/reservedTribePilotTransport.js');
 assert.throws(()=>parseReservedTribePilotBody({action:'session-check'}),/TRIBE_INVALID/);
});
