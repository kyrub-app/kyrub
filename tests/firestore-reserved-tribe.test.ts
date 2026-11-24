import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFileSync} from 'node:fs';
import {getApps,deleteApp} from 'firebase-admin/app';
import {initializeTestEnvironment,assertFails,assertSucceeds,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,getDoc,getDocs,collection,setDoc,deleteDoc,serverTimestamp,query,limit,where} from 'firebase/firestore';
import {Timestamp} from 'firebase-admin/firestore';
import {createReservedTribePilotHandler} from '../server/identity/reservedTribePilotTransport.js';
import {createReservedTribeRecoveryService} from '../server/identity/reservedTribeRecoveryService.js';
import {forwardOrdinaryCommunityPost} from '../server/identity/reservedTribeForwardService.js';
import {buildUserNotification,buildUserNotificationId,userNotificationPath} from '../shared/userNotifications.js';
import {listUserNotifications,listReservedUserNotifications,markUserNotificationRead,markAllUserNotificationsRead,markReservedUserNotificationRead} from '../server/notifications/userNotificationService.js';
import {readTribeChat,sendTribeChatMessage,clearTribeChatHistory} from '../server/identity/reservedTribeChatService.js';
import {adminDb} from '../server/firebaseAdmin.js';
import {initializeReservedTribe,unlockReservedTribe,lockReservedTribe,setReservedTribeContact,listOrdinaryTribeConnections,listReservedTribeConnections,authorizeTribeRelationship,getOrdinaryTribeDirectory,getReservedTribeDirectory,authorizeOrdinaryForward,searchOrdinaryTribeSuggestions,mutateOrdinaryConnection,setOrdinaryTribeFavorite,createOrdinaryTribe,setOrdinaryTribeMember,deleteOrdinaryTribe,getReservedTribeSetupStatus,checkReservedTribeSession,lockReservedTribeSession,ordinaryPresentationPeerAllowed,invalidateSocialPair,setOrdinarySocialContactBlock} from '../server/identity/reservedTribeService.js';
const PROJECT='kyrub-security-test';
if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST??''))throw Error('LOCAL_FIRESTORE_EMULATOR_REQUIRED');
delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;delete process.env.GOOGLE_APPLICATION_CREDENTIALS;delete process.env.VERCEL;
process.env.FIREBASE_PROJECT_ID=PROJECT;
let env:RulesTestEnvironment;
const actor='reserved-owner',peer='reserved-peer',other='ordinary-peer',outsider='unrelated-user',pending='pending-peer';
const id=(a:string,b:string)=>[a,b].sort().join('_');
const connection=(a:string,b:string,status='accepted')=>({senderId:a,receiverId:b,participantIds:[a,b].sort(),status,senderName:a,receiverName:b});
before(async()=>{
 env=await initializeTestEnvironment({projectId:PROJECT,firestore:{rules:readFileSync('.firebase/firestore.combined.rules','utf8'),host:'127.0.0.1',port:8088}});
 await env.clearFirestore();
 await Promise.all([actor,peer,other,outsider,pending].map(uid=>adminDb.doc('users/'+uid).set({name:uid,isProfileVisible:true})));
 await Promise.all([adminDb.doc('connections/'+id(actor,peer)).set(connection(actor,peer)),adminDb.doc('connections/'+id(actor,other)).set(connection(actor,other)),adminDb.doc('connections/'+id(actor,pending)).set(connection(actor,pending,'pending'))]);
});
after(async()=>{await env?.cleanup();await adminDb.terminate();await Promise.all(getApps().map(app=>deleteApp(app)));});
test('reservation is private, authorized, directional and leaves shared relationship intact',async()=>{
 await initializeReservedTribe(actor,'synthetic!code');
 await assert.rejects(initializeReservedTribe(actor,'new!synthetic'),/TRIBE_SETUP_UNAVAILABLE/);
 const session=await unlockReservedTribe(actor,'synthetic!code');assert.ok(session.ok);
 if(!session.ok)throw Error('SESSION_MISSING');
 const token=session.token;
 await assert.rejects(setReservedTribeContact(actor,'incorrect',peer,true),/TRIBE_ACCESS_DENIED/);
 await assert.rejects(setReservedTribeContact(outsider,token,peer,true),/TRIBE_ACCESS_DENIED/);
 await assert.rejects(setReservedTribeContact(actor,token,pending,true),/TRIBE_CONNECTION_REQUIRED/);
 await assert.rejects(setReservedTribeContact(actor,token,outsider,true),/TRIBE_CONNECTION_REQUIRED/);
 await Promise.all([setReservedTribeContact(actor,token,peer,true),setReservedTribeContact(actor,token,peer,true)]);
 assert.equal((await adminDb.doc('connections/'+id(actor,peer)).get()).get('status'),'accepted');
 const normal=await listOrdinaryTribeConnections(actor);
 assert.equal(normal.length,2);
 assert.ok(!normal.some(x=>x.participantIds.includes(peer)));
 assert.equal((await listReservedTribeConnections(actor,token)).length,1);
 assert.equal((await listOrdinaryTribeConnections(peer)).length,1);
 await assert.rejects(listReservedTribeConnections(actor,'invalid'),/TRIBE_ACCESS_DENIED/);
 await assert.rejects(adminDb.runTransaction(tx=>authorizeTribeRelationship(tx,actor,id(actor,peer))),/TRIBE_ACCESS_DENIED/);
 assert.equal((await adminDb.runTransaction(tx=>authorizeTribeRelationship(tx,actor,id(actor,peer),token))).status,'accepted');
 assert.equal((await adminDb.runTransaction(tx=>authorizeTribeRelationship(tx,peer,id(actor,peer)))).status,'accepted');
 const path='reserved_tribe_vaults/'+actor+'/contacts/'+peer;
 for(const uid of [actor,peer,outsider]){
  const client=env.authenticatedContext(uid).firestore();
  await assertFails(getDoc(doc(client,path)));
  await assertFails(getDocs(collection(client,'reserved_tribe_vaults',actor,'contacts')));
  await assertFails(setDoc(doc(client,path),{peerId:peer}));
  await assertFails(deleteDoc(doc(client,path)));
 }
 // The enrolled owner must use the server directory; the counterpart is unaffected.
 await assertFails(getDoc(doc(env.authenticatedContext(actor).firestore(),'connections/'+id(actor,peer))));
 await assertSucceeds(getDoc(doc(env.authenticatedContext(peer).firestore(),'connections/'+id(actor,peer))));
 await lockReservedTribe(actor);
 await assert.rejects(listReservedTribeConnections(actor,token),/TRIBE_ACCESS_DENIED/);
 const next=await unlockReservedTribe(actor,'synthetic!code');assert.ok(next.ok);
 if(!next.ok)throw Error('SESSION_MISSING');
 await assert.rejects(setReservedTribeContact(actor,token,peer,false),/TRIBE_ACCESS_DENIED/);
 await setReservedTribeContact(actor,next.token,peer,false);
 assert.equal((await listReservedTribeConnections(actor,next.token)).length,0);
 assert.equal((await listOrdinaryTribeConnections(actor)).length,3);
 assert.equal((await adminDb.doc('connections/'+id(actor,peer)).get()).get('status'),'accepted');
});
test('five wrong codes persist across requests and a correct code cannot bypass lockout',async()=>{
 for(let i=0;i<5;i++)assert.equal((await unlockReservedTribe(actor,'wrong!code')).ok,false);
 assert.equal((await unlockReservedTribe(actor,'synthetic!code')).ok,false);
 const vault=await adminDb.doc('reserved_tribe_vaults/'+actor).get();
 assert.equal(vault.get('failures'),5);
 assert.ok(vault.get('lockedUntil')>Date.now());
 await adminDb.doc('reserved_tribe_vaults/'+actor).update({lockedUntil:Date.now()-1});
 const result=await unlockReservedTribe(actor,'synthetic!code');assert.ok(result.ok);
});

test('reserved chat denies direct SDK access while the other participant retains normal chat',async()=>{
 const session=await unlockReservedTribe(actor,'synthetic!code');assert.ok(session.ok);
 if(!session.ok)throw Error('SESSION_MISSING');
 const pair=id(actor,peer),base='social_chats/'+pair;
 await setReservedTribeContact(actor,session.token,peer,true);
 await adminDb.doc(base+'/messages/old').set({senderId:peer,receiverId:actor,text:'mensagem antiga',createdAt:Timestamp.fromMillis(Date.now()-60000)});
 const owner=env.authenticatedContext(actor).firestore(),counterpart=env.authenticatedContext(peer).firestore(),stranger=env.authenticatedContext(outsider).firestore();
 await assertFails(getDoc(doc(owner,base+'/messages/old')));
 await assertFails(getDocs(query(collection(owner,base+'/messages'),limit(100))));
 await assertFails(setDoc(doc(owner,base+'/messages/bypass'),{senderId:actor,receiverId:peer,text:'bypass',createdAt:serverTimestamp()}));
 await assertFails(getDoc(doc(owner,base+'/history_state/'+actor)));
 await assertFails(setDoc(doc(owner,base+'/history_state/'+actor),{clearedAt:serverTimestamp()}));
 await assertFails(getDoc(doc(stranger,base+'/messages/old')));
 await assertSucceeds(getDoc(doc(counterpart,base+'/messages/old')));
 await assertSucceeds(setDoc(doc(counterpart,base+'/messages/peer-new'),{senderId:peer,receiverId:actor,text:'recebida normalmente',createdAt:serverTimestamp()}));
 await assertRejectNoSession();
 async function assertRejectNoSession(){
  await assert.rejects(readTribeChat(actor,pair),/TRIBE_ACCESS_DENIED/);
  await assert.rejects(sendTribeChatMessage(actor,pair,'invalid','invalid-message','sem acesso'),/TRIBE_ACCESS_DENIED/);
  await assert.rejects(clearTribeChatHistory(actor,pair),/TRIBE_ACCESS_DENIED/);
 }
 assert.equal((await readTribeChat(actor,pair,session.token)).messages.length,2);
 await Promise.all([sendTribeChatMessage(actor,pair,session.token,'message-once','olá'),sendTribeChatMessage(actor,pair,session.token,'message-once','olá')]);
 await assert.rejects(sendTribeChatMessage(actor,pair,session.token,'message-once','outro conteúdo'),/TRIBE_MESSAGE_CONFLICT/);
 assert.equal((await readTribeChat(actor,pair,session.token)).messages.length,3);
 await clearTribeChatHistory(actor,pair,session.token);
 assert.equal((await readTribeChat(actor,pair,session.token)).messages.length,0);
 assert.equal((await readTribeChat(peer,pair)).messages.length,3);
 // Guarantee a strictly later commit in the emulator, including timestamp granularity.
 await new Promise(resolve=>setTimeout(resolve,20));
 await sendTribeChatMessage(peer,pair,undefined,'after-clear','nova mensagem');
 assert.deepEqual((await readTribeChat(actor,pair,session.token)).messages.map(row=>row.text),['nova mensagem']);
 assert.equal((await adminDb.collection(base+'/messages').get()).size,4);
 await lockReservedTribe(actor);
 await assert.rejects(readTribeChat(actor,pair,session.token),/TRIBE_ACCESS_DENIED/);
 const next=await unlockReservedTribe(actor,'synthetic!code');assert.ok(next.ok);
 if(!next.ok)throw Error('SESSION_MISSING');
 await adminDb.doc('social_contact_blocks/'+peer+'/blocked/'+actor).set({targetId:actor});
 await assert.rejects(readTribeChat(actor,pair,next.token),/TRIBE_ACCESS_DENIED/);
 await adminDb.doc('social_contact_blocks/'+peer+'/blocked/'+actor).delete();
 await setReservedTribeContact(actor,next.token,peer,false);
 await assertFails(getDoc(doc(owner,base+'/messages/old')));
 assert.ok((await readTribeChat(actor,pair)).messages.some(row=>row.id==='old')|| (await readTribeChat(actor,pair)).clearedAt);
 assert.equal((await readTribeChat(actor,pair)).messages.length,1);
 const ordinaryPair=id(actor,other);
 await assertFails(setDoc(doc(owner,'social_chats/'+ordinaryPair+'/messages/ordinary'),{senderId:actor,receiverId:other,text:'normal',createdAt:serverTimestamp()}));
 await sendTribeChatMessage(actor,ordinaryPair,undefined,'ordinary','normal');
 assert.ok((await readTribeChat(actor,ordinaryPair)).messages.some(row=>row.id==='ordinary'));
});

test('server directory excludes reserved contacts from tribes, favorites and forward targets',async()=>{
 const session=await unlockReservedTribe(actor,'synthetic!code');assert.ok(session.ok);
 if(!session.ok)throw Error('SESSION_MISSING');
 const owner=env.authenticatedContext(actor).firestore();
 await Promise.all([
  adminDb.doc('users/'+actor+'/contact_favorites/'+peer).set({favorited:true,connectionId:id(actor,peer)}),
  adminDb.doc('users/'+actor+'/contact_favorites/'+other).set({favorited:true,connectionId:id(actor,other)}),
  adminDb.doc('users/'+actor+'/contact_groups/family').set({ownerId:actor,name:'Família',memberIds:[peer,other]}),
  adminDb.doc('community_direct_forward_receipts/source__'+actor+'__'+peer).set({actorId:actor,receiverId:peer})
 ]);
 await setReservedTribeContact(actor,session.token,peer,true);
 const directory=await getOrdinaryTribeDirectory(actor);
 assert.deepEqual(directory.favoriteIds,[other]);
 assert.deepEqual(directory.tribes,[{id:'family',name:'Família',memberIds:[other]}]);
 assert.deepEqual(directory.forwardTargets,[{connectionId:id(actor,other),peerId:other}]);
 assert.ok(!JSON.stringify(directory).includes(peer));
 const reserved=await getReservedTribeDirectory(actor,session.token);
 assert.deepEqual(reserved.favoriteIds,[peer]);assert.equal(reserved.forwardTargets.length,0);
 await assertFails(getDocs(query(collection(owner,'connections'),where('participantIds','array-contains',actor))));
 await assertFails(getDocs(collection(owner,'users',actor,'contact_favorites')));
 await assertFails(getDoc(doc(owner,'users',actor,'contact_groups','family')));
 await assertFails(getDoc(doc(owner,'community_direct_forward_receipts','source__'+actor+'__'+peer)));
 await assert.rejects(adminDb.runTransaction(tx=>authorizeOrdinaryForward(tx,actor,id(actor,peer))),/TRIBE_ACCESS_DENIED/);
 assert.equal((await adminDb.runTransaction(tx=>authorizeOrdinaryForward(tx,actor,id(actor,other)))).status,'accepted');
 await setReservedTribeContact(actor,session.token,peer,false);
 assert.ok((await getOrdinaryTribeDirectory(actor)).favoriteIds.includes(peer));
 assert.ok((await getOrdinaryTribeDirectory(actor)).tribes[0].memberIds.includes(peer));
 await assertFails(getDocs(query(collection(owner,'connections'),where('participantIds','array-contains',actor))));
 await assertSucceeds(getDoc(doc(env.authenticatedContext(peer).firestore(),'connections/'+id(actor,peer))));
});

test('reserved inbox suppresses titles, targets and unread counts, with independent read state',async()=>{
 const session=await unlockReservedTribe(actor,'synthetic!code');assert.ok(session.ok);
 if(!session.ok)throw Error('SESSION_MISSING');
 const scope='users/'+actor+'/notifications/';
 const make=(key:string,who:string,category:'user_forward'|'community_group_invite'|'system',createdAt:string)=>buildUserNotification({id:key,recipientUserId:actor,category,eventType:'received',sourceId:key,actorPrincipalId:who,title:'Aviso '+who,body:'Conteúdo '+who,createdAt});
 await Promise.all([
  adminDb.doc(scope+'hidden').set(make('hidden',peer,'user_forward','2026-11-24T12:04:00Z')),
  adminDb.doc(scope+'ordinary').set(make('ordinary',other,'user_forward','2026-11-24T12:03:00Z')),
  adminDb.doc(scope+'system').set(make('system',peer,'system','2026-11-24T12:02:00Z')),
  adminDb.doc(scope+'invite').set(make('invite',peer,'community_group_invite','2026-11-24T12:01:00Z'))
 ]);
 await setReservedTribeContact(actor,session.token,peer,true);
 const normal=await listUserNotifications({recipientUserId:actor,limit:1});
 assert.deepEqual(normal.notifications.map(row=>row.id),['ordinary']);
 assert.equal(normal.unreadCount,2);assert.equal(normal.personalBrowserNotificationsAllowed,false);
 const secret=await listReservedUserNotifications({recipientUserId:actor},session.token);
 assert.deepEqual(secret.notifications.map(row=>row.id),['hidden','invite']);
 assert.equal(secret.unreadCount,2);assert.equal(secret.personalBrowserNotificationsAllowed,false);
 await assert.rejects(listReservedUserNotifications({recipientUserId:actor},undefined),/USER_NOTIFICATION_NOT_FOUND/);
 await assert.rejects(markUserNotificationRead({recipientUserId:actor,notificationId:'hidden'}),/USER_NOTIFICATION_NOT_FOUND/);
 await assert.rejects(markReservedUserNotificationRead({recipientUserId:actor,notificationId:'ordinary'},session.token),/USER_NOTIFICATION_NOT_FOUND/);
 assert.equal(await markAllUserNotificationsRead({recipientUserId:actor}),2);
 assert.equal((await adminDb.doc(scope+'hidden').get()).get('readAt'),'');
 assert.equal((await listUserNotifications({recipientUserId:actor})).unreadCount,0);
 await markReservedUserNotificationRead({recipientUserId:actor,notificationId:'hidden'},session.token);
 assert.equal((await listReservedUserNotifications({recipientUserId:actor},session.token)).unreadCount,1);
 await lockReservedTribe(actor);
 await assert.rejects(listReservedUserNotifications({recipientUserId:actor},session.token),/TRIBE_ACCESS_DENIED/);
 const next=await unlockReservedTribe(actor,'synthetic!code');assert.ok(next.ok);
 if(!next.ok)throw Error('SESSION_MISSING');
 await setReservedTribeContact(actor,next.token,peer,false);
 assert.equal((await listUserNotifications({recipientUserId:actor})).unreadCount,1);
});

test('ordinary suggestions never rediscover reserved or blocked contacts',async()=>{
 const session=await unlockReservedTribe(actor,'synthetic!code');assert.ok(session.ok);
 if(!session.ok)throw Error('SESSION_MISSING');
 const visible='suggestion-visible',blocked='suggestion-blocked',privateProfile='suggestion-private';
 await Promise.all([
  adminDb.doc('users/'+visible).set({name:'João Visível',isProfileVisible:true,email:'not-returned@example.test',whatsapp:'12345'}),
  adminDb.doc('users/'+blocked).set({name:'João Bloqueado',isProfileVisible:true}),
  adminDb.doc('users/'+privateProfile).set({name:'João Privado',isProfileVisible:false}),
  adminDb.doc('social_contact_blocks/'+blocked+'/blocked/'+actor).set({targetId:actor})
 ]);
 await setReservedTribeContact(actor,session.token,peer,true);
 await adminDb.doc('connections/'+id(actor,peer)).delete();
 await adminDb.doc('users/'+peer).update({name:'João Reservado'});
 try{
  const matches=await searchOrdinaryTribeSuggestions(actor,'joao');
  assert.deepEqual(matches.map(row=>row.id),[visible]);
  assert.ok(!JSON.stringify(matches).includes('not-returned'));
  assert.ok(!JSON.stringify(matches).includes('12345'));
  await assert.rejects(searchOrdinaryTribeSuggestions(actor,'x'.repeat(129)),/TRIBE_SEARCH_INVALID/);
 }finally{
  await adminDb.doc('connections/'+id(actor,peer)).set(connection(actor,peer));
  await setReservedTribeContact(actor,session.token,peer,false);
 }
});

test('recovery preserves reserved membership and messages and consumes a fresh authentication once',async()=>{
 const session=await unlockReservedTribe(actor,'synthetic!code');assert.ok(session.ok);
 if(!session.ok)throw Error('SESSION_MISSING');
 await setReservedTribeContact(actor,session.token,peer,true);
 const root=adminDb.doc('reserved_tribe_vaults/'+actor);
 const pair=id(actor,peer);
 const before=(await adminDb.collection('social_chats/'+pair+'/messages').get()).size;
 const authTime=Math.floor(Date.now()/1000)-2;
 // Synthetic verified identities exercise the real recovery transaction.
 // The production verifier is separately checked to require revocation checking.
 const recover=createReservedTribeRecoveryService(async token=>{
  if(token==='revoked')throw Error('revoked');
  return {uid:token==='other'?outsider:actor,email_verified:token!=='unverified',auth_time:token==='stale'?authTime-600:authTime};
 });
 for(const token of ['revoked','other','unverified','stale']){
  await assert.rejects(recover(token,'new!synthetic','new!synthetic'),/TRIBE_RECOVERY_DENIED/);
 }
 await assert.rejects(recover('fresh','new!synthetic','mismatch'),/TRIBE_CODE_INVALID/);
 await root.update({failures:5,lockedUntil:Date.now()+60000});
 const attempts=await Promise.allSettled([recover('fresh','new!synthetic','new!synthetic'),recover('fresh','new!synthetic','new!synthetic')]);
 assert.equal(attempts.filter(item=>item.status==='fulfilled').length,1);
 assert.equal(attempts.filter(item=>item.status==='rejected').length,1);
 assert.equal((await root.get()).get('directoryProtected'),true);
 assert.equal((await root.get()).get('failures'),0);
 assert.equal((await root.get()).get('lockedUntil'),0);
 assert.equal((await root.get()).get('lastRecoveryAuthTime'),authTime);
 assert.ok((await root.collection('contacts').doc(peer).get()).exists);
 assert.equal((await adminDb.collection('social_chats/'+pair+'/messages').get()).size,before);
 await assert.rejects(listReservedTribeConnections(actor,session.token),/TRIBE_ACCESS_DENIED/);
 assert.equal((await unlockReservedTribe(actor,'synthetic!code')).ok,false);
 const next=await unlockReservedTribe(actor,'new!synthetic');assert.ok(next.ok);
 if(!next.ok)throw Error('SESSION_MISSING');
 assert.equal((await listReservedTribeConnections(actor,next.token)).length,1);
 await setReservedTribeContact(actor,next.token,peer,false);
 await assert.rejects(recover('fresh','again!synthetic','again!synthetic'),/TRIBE_RECOVERY_DENIED/);
});

test('isolated transport authenticates the actor, rejects injected identity and revokes only the matching session',async()=>{
 const handle=createReservedTribePilotHandler({allowed:()=>true,project:()=>PROJECT,verify:async token=>{
  if(token==='bad')throw Error('invalid');
  return {uid:token==='peer'?peer:actor,email_verified:token!=='unverified'};
 }});
 async function call(token:string,body:unknown,method='POST'){
  let status=0,result:any;
  const headers:Record<string,string>={};
  const response={setHeader:(key:string,value:string)=>{headers[key]=value;},status(code:number){status=code;return this;},json(value:unknown){result=value;}};
  await handle({method,headers:{authorization:'Bearer '+token},body},response);
  assert.match(headers['Cache-Control'],/no-store/);
  return {status,result};
 }
 assert.equal((await call('bad',{action:'status'})).status,401);
 assert.equal((await call('unverified',{action:'status'})).status,401);
 assert.equal((await call('owner',{action:'status'},'GET')).status,405);
 assert.equal((await call('owner',{action:'directory',actorId:peer})).status,400);
 assert.equal((await call('owner',{action:'status'})).result.configured,true);
 const unlocked=await call('owner',{action:'unlock',code:'new!synthetic'});assert.equal(unlocked.status,200);assert.equal(unlocked.result.ok,true);
 const token=unlocked.result.token;
 assert.equal((await call('peer',{action:'reserved-directory',session:token})).status,403);
 assert.equal((await call('owner',{action:'reserved-directory',session:token})).status,200);
 const next=await call('owner',{action:'unlock',code:'new!synthetic'});assert.equal(next.result.ok,true);
 assert.equal((await call('owner',{action:'lock',session:token})).status,200);
 assert.equal((await call('owner',{action:'reserved-directory',session:next.result.token})).status,200);
 await call('owner',{action:'lock',session:next.result.token});
 assert.equal((await call('owner',{action:'reserved-directory',session:next.result.token})).status,403);
});

test('ordinary connection and favorite mutations preserve reserved contacts and counterpart independence',async()=>{
 const candidate='new-ordinary-candidate';
 await adminDb.doc('users/'+candidate).set({name:'Novo contato',isProfileVisible:true});
 await Promise.all([mutateOrdinaryConnection(actor,candidate,'request'),mutateOrdinaryConnection(actor,candidate,'request')]);
 const pair=id(actor,candidate);
 assert.equal((await adminDb.doc('connections/'+pair).get()).get('status'),'pending');
 await assert.rejects(mutateOrdinaryConnection(actor,candidate,'accept'),/TRIBE_ACCESS_DENIED/);
 await mutateOrdinaryConnection(candidate,actor,'accept');
 await setOrdinaryTribeFavorite(actor,pair,true);
 assert.ok((await getOrdinaryTribeDirectory(actor)).favoriteIds.includes(candidate));
 await setOrdinaryTribeFavorite(actor,pair,false);
 assert.ok(!(await getOrdinaryTribeDirectory(actor)).favoriteIds.includes(candidate));
 const session=await unlockReservedTribe(actor,'new!synthetic');assert.ok(session.ok);
 if(!session.ok)throw Error('SESSION_MISSING');
 await setReservedTribeContact(actor,session.token,candidate,true);
 await assert.rejects(mutateOrdinaryConnection(actor,candidate,'remove'),/TRIBE_ACCESS_DENIED/);
 await assert.rejects(setOrdinaryTribeFavorite(actor,pair,true),/TRIBE_ACCESS_DENIED/);
 await assertFails(deleteDoc(doc(env.authenticatedContext(actor).firestore(),'connections/'+pair)));
 await mutateOrdinaryConnection(candidate,actor,'remove');
 assert.equal((await adminDb.doc('connections/'+pair).get()).exists,false);
 assert.ok((await adminDb.doc('reserved_tribe_vaults/'+actor+'/contacts/'+candidate).get()).exists);
 await setReservedTribeContact(actor,session.token,candidate,false);
});

test('ordinary tribe updates preserve hidden membership and concurrent visible additions',async()=>{
 const group='pilot-group',pair=id(actor,peer),ordinaryPair=id(actor,other);
 const extra='group-extra-contact',extraPair=id(actor,extra);
 await adminDb.doc('users/'+extra).set({name:'Contato extra',isProfileVisible:true});
 await adminDb.doc('connections/'+extraPair).set(connection(actor,extra));
 await Promise.all([createOrdinaryTribe(actor,group,'Amigos'),createOrdinaryTribe(actor,group,'Amigos')]);
 await assert.rejects(createOrdinaryTribe(actor,group,'Outro nome'),/TRIBE_GROUP_CONFLICT/);
 const ref=adminDb.doc('users/'+actor+'/contact_groups/'+group);
 await setOrdinaryTribeMember(actor,group,pair,true);
 const session=await unlockReservedTribe(actor,'new!synthetic');assert.ok(session.ok);
 if(!session.ok)throw Error('SESSION_MISSING');
 await setReservedTribeContact(actor,session.token,peer,true);
 await Promise.all([setOrdinaryTribeMember(actor,group,ordinaryPair,true),setOrdinaryTribeMember(actor,group,extraPair,true)]);
 assert.deepEqual(new Set((await ref.get()).get('memberIds')),new Set([peer,other,extra]));
 assert.deepEqual(new Set((await getOrdinaryTribeDirectory(actor)).tribes.find(item=>item.id===group)?.memberIds),new Set([other,extra]));
 await assert.rejects(setOrdinaryTribeMember(actor,group,pair,false),/TRIBE_ACCESS_DENIED/);
 await assert.rejects(setOrdinaryTribeMember(outsider,group,ordinaryPair,true),/TRIBE_ACCESS_DENIED/);
 await setOrdinaryTribeMember(actor,group,ordinaryPair,false);
 assert.deepEqual(new Set((await ref.get()).get('memberIds')),new Set([peer,extra]));
 await setReservedTribeContact(actor,session.token,peer,false);
 assert.deepEqual(new Set((await getOrdinaryTribeDirectory(actor)).tribes.find(item=>item.id===group)?.memberIds),new Set([peer,extra]));
 await setReservedTribeContact(actor,session.token,peer,true);
 await deleteOrdinaryTribe(actor,group);
 assert.equal((await ref.get()).exists,false);
 assert.ok((await adminDb.doc('reserved_tribe_vaults/'+actor+'/contacts/'+peer).get()).exists);
 assert.equal((await adminDb.doc('connections/'+pair).get()).get('status'),'accepted');
 await setReservedTribeContact(actor,session.token,peer,false);
});

test('ordinary and reserved chat transport share history but cannot bypass scope authorization',async()=>{
 const pair=id(actor,peer);
 const handle=createReservedTribePilotHandler({allowed:()=>true,project:()=>PROJECT,verify:async token=>({uid:token==='peer'?peer:actor,email_verified:true})});
 async function call(token:string,body:unknown){
  let status=0,result:any;
  const res={setHeader:()=>{},status(code:number){status=code;return this;},json(data:unknown){result=data;}};
  await handle({method:'POST',headers:{authorization:'Bearer '+token},body},res);
  return {status,result};
 }
 const session=await unlockReservedTribe(actor,'new!synthetic');assert.ok(session.ok);
 if(!session.ok)throw Error('SESSION_MISSING');
 const capability=session.token;
 assert.equal((await call('owner',{action:'ordinary-chat-send',connectionId:pair,messageId:'ordinary-scope-message',text:'Teste de escopo'})).status,200);
 assert.equal((await call('owner',{action:'chat-read',connectionId:pair,session:capability})).status,403);
 await setReservedTribeContact(actor,capability,peer,true);
 for(const body of [{action:'ordinary-chat-read',connectionId:pair},{action:'ordinary-chat-send',connectionId:pair,messageId:'bypass-scope',text:'bypass'},{action:'ordinary-chat-clear',connectionId:pair}])assert.equal((await call('owner',body)).status,403);
 assert.equal((await call('peer',{action:'ordinary-chat-read',connectionId:pair})).status,200);
 const protectedChat=await call('owner',{action:'chat-read',connectionId:pair,session:capability});
 assert.equal(protectedChat.status,200);
 assert.ok(protectedChat.result.messages.some((row:any)=>row.id==='ordinary-scope-message'));
 await setReservedTribeContact(actor,capability,peer,false);
 assert.equal((await call('owner',{action:'chat-read',connectionId:pair,session:capability})).status,403);
 assert.equal((await call('owner',{action:'ordinary-chat-read',connectionId:pair})).status,200);
});

test('directory revision and live session probe invalidate stale projections across devices',async()=>{
 const before=await getReservedTribeSetupStatus(actor);
 const session=await unlockReservedTribe(actor,'new!synthetic');assert.ok(session.ok);
 if(!session.ok)throw Error('SESSION_MISSING');
 assert.equal((await checkReservedTribeSession(actor,session.token)).revision,before.revision);
 await setReservedTribeContact(actor,session.token,peer,true);
 const hidden=await getOrdinaryTribeDirectory(actor);
 assert.equal(hidden.revision,before.revision+1);
 assert.equal((await getReservedTribeDirectory(actor,session.token)).revision,hidden.revision);
 assert.ok(!hidden.connections.some(row=>row.senderId===peer||row.receiverId===peer));
 await setReservedTribeContact(actor,session.token,peer,true);
 assert.equal((await getReservedTribeSetupStatus(actor)).revision,hidden.revision);
 await setReservedTribeContact(actor,session.token,peer,false);
 assert.equal((await getOrdinaryTribeDirectory(actor)).revision,hidden.revision+1);
 const next=await unlockReservedTribe(actor,'new!synthetic');assert.ok(next.ok);
 if(!next.ok)throw Error('SESSION_MISSING');
 await assert.rejects(checkReservedTribeSession(actor,session.token),/TRIBE_ACCESS_DENIED/);
 await lockReservedTribeSession(actor,session.token);
 await checkReservedTribeSession(actor,next.token);
 await lockReservedTribeSession(actor,next.token);
 await assert.rejects(checkReservedTribeSession(actor,next.token),/TRIBE_ACCESS_DENIED/);
});

test('ordinary forwarding commits message, cooldown and notice atomically; reserved destination is denied',async()=>{
 const communityId='pilot-forward-community',postId='pilot-forward-post',pair=id(actor,peer);
 await adminDb.doc('communities/'+communityId).set({visibility:'public'});
 await adminDb.doc('community_posts/'+postId).set({communityId,authorId:other});
 const fields={connectionId:pair,communityId,postId,messageId:'pilot-forward-message',text:'https://www.kyrub.com/?community='+communityId+'&post='+postId};
 const result=await forwardOrdinaryCommunityPost(actor,fields);
 assert.equal(result.recipientId,peer);
 const receipt=adminDb.doc('community_direct_forward_receipts/'+postId+'__'+actor+'__'+peer);
 const message=adminDb.doc('social_chats/'+pair+'/messages/'+fields.messageId);
 const notice=adminDb.doc(userNotificationPath(peer,buildUserNotificationId({category:'user_forward',eventType:'received',sourceId:fields.messageId})));
 assert.ok((await message.get()).exists);assert.equal((await receipt.get()).get('messageId'),fields.messageId);assert.equal((await notice.get()).get('actorPrincipalId'),actor);
 assert.deepEqual(await forwardOrdinaryCommunityPost(actor,fields),result);
 await assert.rejects(forwardOrdinaryCommunityPost(actor,{...fields,messageId:'duplicate-forward'}),/TRIBE_FORWARD_DUPLICATE/);
 assert.equal((await adminDb.doc('social_chats/'+pair+'/messages/duplicate-forward').get()).exists,false);
 const session=await unlockReservedTribe(actor,'new!synthetic');assert.ok(session.ok);
 if(!session.ok)throw Error('SESSION_MISSING');
 await setReservedTribeContact(actor,session.token,peer,true);
 await assert.rejects(forwardOrdinaryCommunityPost(actor,{...fields,messageId:'reserved-forward'}),/TRIBE_ACCESS_DENIED/);
 await setReservedTribeContact(actor,session.token,peer,false);
 await adminDb.doc('communities/'+communityId).update({visibility:'private'});
 await assert.rejects(forwardOrdinaryCommunityPost(actor,{...fields,messageId:'private-forward'}),/TRIBE_ACCESS_DENIED/);
});

test('migrated owners cannot directly read or mutate ordinary chat and receipts; counterpart remains independent',async()=>{
 const pair=id(actor,peer),base='social_chats/'+pair,owner=env.authenticatedContext(actor).firestore(),counterpart=env.authenticatedContext(peer).firestore();
 await assertFails(getDocs(query(collection(owner,base+'/messages'),limit(100))));
 await assertFails(getDoc(doc(owner,base+'/history_state/'+actor)));
 await assertFails(setDoc(doc(owner,base+'/history_state/'+actor),{clearedAt:serverTimestamp()}));
 await assertFails(getDoc(doc(owner,'community_direct_forward_receipts','pilot-forward-post__'+actor+'__'+peer)));
 await assertFails(getDoc(doc(owner,'community_direct_forward_receipts','missing__'+actor+'__'+peer)));
 await assertSucceeds(getDocs(query(collection(counterpart,base+'/messages'),limit(100))));
 await readTribeChat(actor,pair);
});


test('ordinary presentation boundary denies reserved relationship and either block without leaking counterpart reservation',async()=>{
 const titular='presentation-owner-fixture',contact='presentation-peer-fixture',regular='presentation-ordinary-fixture';
 const pair=id(titular,contact);
 await Promise.all([titular,contact,regular].map(uid=>adminDb.doc('users/'+uid).set({name:uid,isProfileVisible:true})));
 await adminDb.doc('connections/'+pair).set(connection(titular,contact));
 const allowed=(actor:string,target:unknown)=>adminDb.runTransaction(tx=>ordinaryPresentationPeerAllowed(tx,actor,target));
 assert.equal(await allowed(titular,contact),true);
 await initializeReservedTribe(titular,'presentation!fixture');
 const unlocked=await unlockReservedTribe(titular,'presentation!fixture');assert.ok(unlocked.ok);
 if(!unlocked.ok)throw Error('SESSION_MISSING');
 await setReservedTribeContact(titular,unlocked.token,contact,true);
 assert.equal(await allowed(titular,contact),false);
 assert.equal(await allowed(contact,titular),true);
 assert.equal(await allowed(titular,regular),true);
 assert.equal(await allowed(titular,titular),false);
 assert.equal(await allowed(titular,'invalid/path'),false);
 const own=adminDb.doc('social_contact_blocks/'+titular+'/blocked/'+regular);
 const otherBlock=adminDb.doc('social_contact_blocks/'+regular+'/blocked/'+titular);
 await own.set({targetId:regular});
 assert.equal(await allowed(titular,regular),false);
 assert.equal(await allowed(regular,titular),false);
 await own.delete();await otherBlock.set({targetId:titular});
 assert.equal(await allowed(titular,regular),false);
 assert.equal(await allowed(regular,titular),false);
 await otherBlock.delete();
 assert.equal(await allowed(titular,regular),true);
 // No reservation or block was propagated to the shared relationship.
 assert.equal((await adminDb.doc('connections/'+pair).get()).get('status'),'accepted');
 await setReservedTribeContact(titular,unlocked.token,contact,false);
 assert.equal(await allowed(titular,contact),true);
});


test('directory projections exclude stale blocked relations, favorites, groups and forwarding targets',async()=>{
 const titular='blocked-directory-owner',contact='blocked-directory-peer',regular='blocked-directory-ordinary';
 const pair=id(titular,contact),regularPair=id(titular,regular);
 await Promise.all([titular,contact,regular].map(uid=>adminDb.doc('users/'+uid).set({name:uid,isProfileVisible:true})));
 await Promise.all([
  adminDb.doc('connections/'+pair).set(connection(titular,contact)),
  adminDb.doc('connections/'+regularPair).set(connection(titular,regular)),
  adminDb.doc('users/'+titular+'/contact_favorites/'+contact).set({favorited:true,connectionId:pair}),
  adminDb.doc('users/'+titular+'/contact_groups/fixture').set({ownerId:titular,groupId:'fixture',name:'Fixture',memberIds:[contact,regular]})
 ]);
 const initial=await getOrdinaryTribeDirectory(titular);
 assert.equal(initial.connections.length,2);
 assert.ok(initial.favoriteIds.includes(contact));
 assert.ok(initial.forwardTargets.some(row=>row.peerId===contact));
 const own=adminDb.doc('social_contact_blocks/'+titular+'/blocked/'+contact);
 const reverse=adminDb.doc('social_contact_blocks/'+contact+'/blocked/'+titular);
 const checkOrdinary=async()=>{
  const result=await getOrdinaryTribeDirectory(titular);
  assert.deepEqual(result.connections.map(row=>row.id),[regularPair]);
  assert.deepEqual(result.favoriteIds,[]);
  assert.deepEqual(result.tribes[0].memberIds,[regular]);
  assert.deepEqual(result.forwardTargets.map(row=>row.peerId),[regular]);
  assert.deepEqual((await getOrdinaryTribeDirectory(contact)).connections,[]);
 };
 await own.set({targetId:contact});await checkOrdinary();await own.delete();
 await reverse.set({targetId:titular});await checkOrdinary();await reverse.delete();
 await initializeReservedTribe(titular,'blocked!fixture');
 const session=await unlockReservedTribe(titular,'blocked!fixture');assert.ok(session.ok);
 if(!session.ok)throw Error('SESSION_MISSING');
 await setReservedTribeContact(titular,session.token,contact,true);
 assert.equal((await getReservedTribeDirectory(titular,session.token)).connections.length,1);
 await reverse.set({targetId:titular});
 const privateDir=await getReservedTribeDirectory(titular,session.token);
 assert.deepEqual(privateDir.connections,[]);assert.deepEqual(privateDir.favoriteIds,[]);
 await assert.rejects(adminDb.runTransaction(tx=>authorizeTribeRelationship(tx,titular,pair,session.token)),/TRIBE_ACCESS_DENIED/);
 await reverse.delete();
 assert.equal((await getReservedTribeDirectory(titular,session.token)).connections.length,1);
 // Filtering is non-destructive, including private classifications.
 assert.equal((await adminDb.doc('connections/'+pair).get()).get('status'),'accepted');
 assert.equal((await adminDb.doc('users/'+titular+'/contact_favorites/'+contact).get()).get('favorited'),true);
 assert.deepEqual((await adminDb.doc('users/'+titular+'/contact_groups/fixture').get()).get('memberIds'),[contact,regular]);
});


test('social pair revision invalidates both devices without creating an unconfigured vault',async()=>{
 const owner='revision-block-owner',peer='revision-block-peer',other='revision-block-other';
 const pair=id(owner,peer);
 await Promise.all([owner,peer,other].map(uid=>adminDb.doc('users/'+uid).set({name:uid,isProfileVisible:true})));
 await adminDb.doc('connections/'+pair).set(connection(owner,peer));
 await initializeReservedTribe(owner,'revision!fixture');
 const unlocked=await unlockReservedTribe(owner,'revision!fixture');assert.ok(unlocked.ok);
 if(!unlocked.ok)throw Error('SESSION_MISSING');
 await setReservedTribeContact(owner,unlocked.token,peer,true);
 const ownerBefore=await getReservedTribeSetupStatus(owner);
 const peerBefore=await getReservedTribeSetupStatus(peer);
 const otherBefore=await getReservedTribeSetupStatus(other);
 assert.equal(peerBefore.configured,false);
 const block=adminDb.doc('social_contact_blocks/'+peer+'/blocked/'+owner);
 await adminDb.runTransaction(async tx=>{await tx.get(block);tx.set(block,{targetId:owner});invalidateSocialPair(tx,peer,owner);});
 assert.equal((await checkReservedTribeSession(owner,unlocked.token)).revision,ownerBefore.revision+1);
 assert.equal((await getReservedTribeDirectory(owner,unlocked.token)).revision,ownerBefore.revision+1);
 assert.deepEqual((await getReservedTribeDirectory(owner,unlocked.token)).connections,[]);
 assert.deepEqual(await getReservedTribeSetupStatus(peer),{...peerBefore,revision:peerBefore.revision+1});
 assert.equal((await getOrdinaryTribeDirectory(peer)).revision,peerBefore.revision+1);
 assert.deepEqual(await getReservedTribeSetupStatus(other),otherBefore);
 assert.equal((await adminDb.doc('reserved_tribe_vaults/'+peer).get()).exists,false);
 for(const uid of [owner,peer,other]){
  const client=env.authenticatedContext(uid).firestore();
  await assertFails(getDoc(doc(client,'social_directory_revisions',peer)));
  await assertFails(setDoc(doc(client,'social_directory_revisions',uid),{revision:999}));
 }
 await adminDb.runTransaction(async tx=>{await tx.get(block);tx.delete(block);invalidateSocialPair(tx,peer,owner);});
 assert.equal((await getReservedTribeDirectory(owner,unlocked.token)).revision,ownerBefore.revision+2);
 assert.equal((await getReservedTribeDirectory(owner,unlocked.token)).connections.length,1);
 assert.equal((await adminDb.doc('connections/'+pair).get()).get('status'),'accepted');
 // Ordinary requests and acceptance also invalidate both accounts.
 const initialOther=(await getReservedTribeSetupStatus(other)).revision;
 const initialPeer=(await getReservedTribeSetupStatus(peer)).revision;
 await mutateOrdinaryConnection(peer,other,'request');
 assert.equal((await getReservedTribeSetupStatus(peer)).revision,initialPeer+1);
 assert.equal((await getReservedTribeSetupStatus(other)).revision,initialOther+1);
 await mutateOrdinaryConnection(other,peer,'accept');
 assert.equal((await getReservedTribeSetupStatus(peer)).revision,initialPeer+2);
 assert.equal((await getReservedTribeSetupStatus(other)).revision,initialOther+2);
 await mutateOrdinaryConnection(other,peer,'remove');
 assert.equal((await getReservedTribeSetupStatus(peer)).revision,initialPeer+3);
 assert.equal((await getReservedTribeSetupStatus(other)).revision,initialOther+3);
 await mutateOrdinaryConnection(other,peer,'remove');
 assert.equal((await getReservedTribeSetupStatus(peer)).revision,initialPeer+3);
});


test('ordinary social block atomically removes connections, invalidates both revisions and preserves history',async()=>{
 const owner='real-block-owner',peer='real-block-peer',other='real-block-other';
 const pair=id(owner,peer);
 await Promise.all([owner,peer,other].map(uid=>adminDb.doc('users/'+uid).set({name:uid,isProfileVisible:true})));
 await adminDb.doc('connections/'+pair).set(connection(owner,peer));
 await initializeReservedTribe(owner,'realblock!fixture');
 const session=await unlockReservedTribe(owner,'realblock!fixture');assert.ok(session.ok);
 if(!session.ok)throw Error('SESSION_MISSING');
 await setReservedTribeContact(owner,session.token,peer,true);
 const msg=adminDb.doc('social_chats/'+pair+'/messages/fixture');
 await msg.set({senderId:owner,receiverId:peer,text:'synthetic',createdAt:Timestamp.now()});
 const beforeOwner=await getReservedTribeSetupStatus(owner),beforePeer=await getReservedTribeSetupStatus(peer);
 await assert.rejects(setOrdinarySocialContactBlock(owner,peer,true),/TRIBE_ACCESS_DENIED/);
 assert.deepEqual(await setOrdinarySocialContactBlock(peer,owner,true),{blocked:true});
 assert.equal((await adminDb.doc('connections/'+pair).get()).exists,false);
 assert.ok((await msg.get()).exists);
 assert.ok((await adminDb.doc('reserved_tribe_vaults/'+owner+'/contacts/'+peer).get()).exists);
 assert.ok((await adminDb.doc('social_contact_blocks/'+peer+'/blocked/'+owner).get()).exists);
 assert.equal((await getReservedTribeSetupStatus(owner)).revision,beforeOwner.revision+1);
 assert.equal((await getReservedTribeSetupStatus(peer)).revision,beforePeer.revision+1);
 assert.equal((await getReservedTribeDirectory(owner,session.token)).connections.length,0);
 await assert.rejects(mutateOrdinaryConnection(peer,owner,'request'),/TRIBE_ACCESS_DENIED/);
 await setOrdinarySocialContactBlock(peer,owner,true);
 assert.equal((await getReservedTribeSetupStatus(peer)).revision,beforePeer.revision+1);
 await setOrdinarySocialContactBlock(other,owner,false);
 assert.ok((await adminDb.doc('social_contact_blocks/'+peer+'/blocked/'+owner).get()).exists);
 await setOrdinarySocialContactBlock(peer,owner,false);
 assert.equal((await adminDb.doc('connections/'+pair).get()).exists,false);
 assert.ok((await msg.get()).exists);
 assert.equal((await getReservedTribeSetupStatus(owner)).revision,beforeOwner.revision+2);
 assert.equal((await getReservedTribeSetupStatus(peer)).revision,beforePeer.revision+2);
 await setOrdinarySocialContactBlock(peer,owner,false);
 assert.equal((await getReservedTribeSetupStatus(peer)).revision,beforePeer.revision+2);
 await adminDb.doc('kyrub_tag_minimal_identities/'+other).set({mode:'tag_only'});
 await assert.rejects(setOrdinarySocialContactBlock(other,owner,true),/TRIBE_ACCESS_DENIED/);
});


test('ordinary blocked list is directional, minimal and does not reveal reserved markers',async()=>{
 const actor='list-block-owner',peer='list-block-peer',reserved='list-block-reserved',reverse='list-block-reverse';
 await Promise.all([actor,peer,reserved,reverse].map(uid=>adminDb.doc('users/'+uid).set({name:uid,isProfileVisible:true})));
 await adminDb.doc('connections/'+id(actor,reserved)).set(connection(actor,reserved));
 await initializeReservedTribe(actor,'list!fixture');
 const session=await unlockReservedTribe(actor,'list!fixture');assert.ok(session.ok);
 if(!session.ok)throw Error('SESSION_MISSING');
 await setReservedTribeContact(actor,session.token,reserved,true);
 // Legacy own block on a reserved peer must not be disclosed in ordinary list.
 await Promise.all([
  adminDb.doc('social_contact_blocks/'+actor+'/blocked/'+reserved).set({targetId:reserved,name:reserved}),
  adminDb.doc('social_contact_blocks/'+reverse+'/blocked/'+actor).set({targetId:actor,name:actor})
 ]);
 await setOrdinarySocialContactBlock(actor,peer,true);
 const directory=await getOrdinaryTribeDirectory(actor);
 assert.deepEqual(directory.blockedContacts,[{id:peer,name:peer}]);
 assert.ok(!JSON.stringify(directory).includes(reserved));
 assert.ok(!JSON.stringify(directory).includes(reverse));
 assert.deepEqual((await getOrdinaryTribeDirectory(peer)).blockedContacts,[]);
 assert.deepEqual((await getReservedTribeDirectory(actor,session.token)).blockedContacts,[]);
 await setOrdinarySocialContactBlock(actor,peer,false);
 assert.deepEqual((await getOrdinaryTribeDirectory(actor)).blockedContacts,[]);
 assert.ok((await adminDb.doc('social_contact_blocks/'+actor+'/blocked/'+reserved).get()).exists);
});
