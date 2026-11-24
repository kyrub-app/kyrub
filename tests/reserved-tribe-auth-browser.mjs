// Real browser SDK, pilot client and HTTP transport; fictional emulator accounts only.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';

const project='kyrub-security-test',origin='http://127.0.0.1:3000';
assert.equal(process.env.FIREBASE_PROJECT_ID,project);
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8088');
assert.equal(process.env.KYRUB_RESERVED_TRIBE_PILOT,'true');
assert.ok(!process.env.FIREBASE_SERVICE_ACCOUNT_JSON&&!process.env.GOOGLE_APPLICATION_CREDENTIALS&&!process.env.VERCEL&&!process.env.VERCEL_ENV);
const app=initializeApp({projectId:project},'reserved-tribe-http-browser');
const auth=getAuth(app),db=getFirestore(app);
const owner='browser-tribe-owner',peer='browser-tribe-peer',pair=[owner,peer].sort().join('_');
const code='fixture-only-code',password='fixture-auth-only-123';
let browser;
let releaseResponse;
const call=(page,action,fields={})=>page.evaluate(({action,fields})=>window.fixture.call(action,fields),{action,fields});
async function success(page,action,fields={}){
 const result=await call(page,action,fields);
 assert.equal(result.ok,true,'Expected successful '+action);
 return result.value;
}
async function refused(page,action,fields={},error='TRIBE_UNAVAILABLE'){
 assert.deepEqual(await call(page,action,fields),{ok:false,error},'Expected refused '+action);
}
try{
 for(const uid of [owner,peer]){
  await auth.createUser({uid,email:uid+'@example.invalid',emailVerified:true,password});
  await db.doc('users/'+uid).set({name:uid,isProfileVisible:true});
 }
 await db.doc('connections/'+pair).set({senderId:owner,receiverId:peer,participantIds:[owner,peer].sort(),status:'accepted',senderName:owner,receiverName:peer});
 const ownerToken={email:owner+'@example.invalid',password},peerToken={email:peer+'@example.invalid',password};
 const storePath='users/'+owner+'/stores/'+owner;
 await db.doc(storePath).set({id:owner,ownerId:owner,ownerEmail:owner+'@example.invalid',name:'Fixture store',slug:'fixture-store',description:'before',logo:'',banner:'',primaryColor:'#121A17',plan:'free',keywords:[],offerImages:[],address:'',contact:'',status:'open',createdAt:new Date(),updatedAt:new Date()});
 browser=await chromium.launch({headless:true});
 const forbidden=[];
 async function open(){
  const ctx=await browser.newContext({serviceWorkers:'block'});
  await ctx.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if([origin,'http://127.0.0.1:9099','http://127.0.0.1:8088','http://127.0.0.1:9199'].includes(url.origin))return route.continue();
   forbidden.push(url.origin);console.log('Blocked browser origin:',url.origin);return route.abort();
  });
  const page=await ctx.newPage();
  page.on('requestfailed',request=>{const url=new URL(request.url());console.log('Browser request failed:',request.method(),url.origin,request.failure()?.errorText??'unknown');});
  await page.goto(origin+'/tests/fixtures/reserved-tribe-browser.html');
  await page.waitForFunction(()=>window.fixture?.enabled()===true);
  assert.deepEqual(await page.evaluate(()=>window.fixture.projects()),[project,project]);
  assert.deepEqual(await page.evaluate(()=>window.fixture.authEmulator()),{host:'127.0.0.1',port:9099,protocol:'http'});
  return page;
 }
 // Reproduce the same-document echo regression using real BroadcastChannel.
 // Both subscribers must hear a remote document; only opt-in hears local.
 const signalA=await open(),signalB=await signalA.context().newPage();
 await signalB.goto(origin+'/tests/fixtures/reserved-tribe-browser.html');
 await signalB.waitForFunction(()=>window.fixture?.enabled()===true);
 await signalA.evaluate(()=>window.fixture.startSignalProbe());
 await signalB.evaluate(()=>window.fixture.startSignalProbe());
 await signalA.evaluate(()=>window.fixture.publishSignal());
 await signalB.waitForFunction(()=>{const c=window.fixture.signalCounts();return c.local===1&&c.remote===1;});
 assert.deepEqual(await signalA.evaluate(()=>window.fixture.signalCounts()),{local:1,remote:0});
 // Round trip provides a second delivery barrier, rather than relying on sleep.
 await signalB.evaluate(()=>window.fixture.publishSignal());
 await signalA.waitForFunction(()=>{const c=window.fixture.signalCounts();return c.local===2&&c.remote===1;});
 assert.deepEqual(await signalB.evaluate(()=>window.fixture.signalCounts()),{local:2,remote:1});
 await signalA.evaluate(()=>window.fixture.stopSignalProbe());
 await signalB.evaluate(()=>window.fixture.stopSignalProbe());
 await signalA.context().close();
 console.log('PASS local invalidation delivered once, no self-echo, remote tabs still invalidated');
 const a=await open(),b=await open();
 // Google-only mock identities: actual Firebase SDK credential recovery,
 // not the production Google popup.
 const google=await open(),googleOther=await open();
 const googleProfile={sub:'fictional-google-owner-subject',email:'google-owner@example.invalid',email_verified:true,name:'Google fixture owner'};
 const otherProfile={sub:'fictional-google-other-subject',email:'google-other@example.invalid',email_verified:true,name:'Google fixture other'};
 const googleOwner=await google.evaluate(profile=>window.fixture.signInGoogleFixture(profile),googleProfile);
 const otherGoogle=await googleOther.evaluate(profile=>window.fixture.signInGoogleFixture(profile),otherProfile);
 assert.notEqual(googleOwner.uid,otherGoogle.uid);
 assert.deepEqual(googleOwner.providers,['google.com']);
 assert.equal(googleOwner.verified,true);
 await db.doc('users/'+googleOwner.uid).set({name:'Google fixture owner',isProfileVisible:true});
 await db.doc('users/'+otherGoogle.uid).set({name:'Google fixture other',isProfileVisible:true});
 await success(google,'setup',{code,confirmation:code});
 const googleSession=await success(google,'unlock',{code});
 assert.equal(googleSession.ok,true);
 const wrongProof=await google.evaluate(profile=>window.fixture.reauthenticateGoogleFixture(profile),otherProfile);
 assert.equal(wrongProof.ok,false);
 await success(google,'session-check',{session:googleSession.token});
 const freshProof=await google.evaluate(profile=>window.fixture.reauthenticateGoogleFixture(profile),googleProfile);
 assert.deepEqual(freshProof,{ok:true,uid:googleOwner.uid,verified:true,provider:'google.com'});
 const replacement='google-fixture-replacement';
 assert.deepEqual(await success(google,'recover',{code:replacement,confirmation:replacement}),{recovered:true});
 await refused(google,'session-check',{session:googleSession.token});
 assert.deepEqual(await success(google,'unlock',{code}),{ok:false});
 assert.equal((await success(google,'unlock',{code:replacement})).ok,true);
 await refused(google,'recover',{code:'replayed-google-code',confirmation:'replayed-google-code'});
 assert.equal((await success(google,'unlock',{code:replacement})).ok,true);
 await refused(googleOther,'recover',{code:replacement,confirmation:replacement});
 await google.context().close();await googleOther.context().close();
 console.log('PASS Google mock provider SDK reauthentication, wrong identity denied, old session/code revoked and recovery proof replay rejected');
 // Real unauthenticated server endpoint and client both deny access.
 assert.equal((await a.request.post(origin+'/api/social/reserved-tribe',{data:{action:'status'}})).status(),401);
 await refused(a,'status',{},'AUTH_REQUIRED');
 assert.equal(await a.evaluate(token=>window.fixture.signIn(token),ownerToken),owner);
 assert.equal(await b.evaluate(token=>window.fixture.signIn(token),peerToken),peer);
 assert.equal((await success(a,'status')).configured,false);
 await success(a,'setup',{code,confirmation:code});
 const first=await success(a,'unlock',{code});
 assert.equal(first.ok,true);
 assert.match(first.token,/^[0-9a-f]{64}$/);
 await success(a,'membership',{session:first.token,peerId:peer,reserved:true});
 assert.ok(!(await success(a,'directory')).connections.some(c=>c.participantIds.includes(peer)));
 assert.ok((await success(a,'reserved-directory',{session:first.token})).connections.some(c=>c.participantIds.includes(peer)));
 await refused(b,'reserved-directory',{session:first.token});
 assert.ok((await success(b,'directory')).connections.some(c=>c.participantIds.includes(owner)));
 await refused(a,'ordinary-chat-read',{connectionId:pair});
 await success(a,'chat-send',{session:first.token,connectionId:pair,messageId:'browser-fixture-msg',text:'fixture-only message'});
 assert.equal((await success(b,'ordinary-chat-read',{connectionId:pair})).messages.length,1);
 console.log('PASS real Auth Emulator identities, private directory and directional chat authorization');
 const second=await success(a,'unlock',{code});
 assert.equal(second.ok,true);
 await refused(a,'session-check',{session:first.token});
 await success(a,'lock',{session:first.token});
 await success(a,'session-check',{session:second.token});
 // Storage gate refuses all reads but never prevents server revocation.
 await a.evaluate(()=>localStorage.setItem('kyrub_friends','synthetic'));
 await refused(a,'directory',{},'TRIBE_STORAGE_UNVERIFIED');
 await success(a,'lock',{session:second.token});
 await a.evaluate(()=>localStorage.removeItem('kyrub_friends'));
 await refused(a,'session-check',{session:second.token});
 console.log('PASS stale session rejected, old lock cannot revoke newer session, lock permitted despite legacy storage');
 const third=await success(a,'unlock',{code});
 assert.equal(third.ok,true);
 // Hold an already-authorized server response while replacing the active user.
 let responseReady;
 const ready=new Promise(resolve=>{responseReady=resolve});
 const gate=new Promise(resolve=>{releaseResponse=resolve});
 const pattern='**/api/social/reserved-tribe';
 const delay=async route=>{
  const response=await route.fetch({timeout:10000});
  responseReady();
  await gate;
  await route.fulfill({response});
 };
 await a.route(pattern,delay,{times:1});
 const pending=call(a,'reserved-directory',{session:third.token});
 // Ensure the test cannot hang when the request never reaches the server.
 let timer;
 try{
  await Promise.race([ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('delayed response not reached')),15000)})]);
  await a.evaluate(token=>window.fixture.signIn(token),peerToken);
 }finally{clearTimeout(timer);releaseResponse();}
 assert.deepEqual(await pending,{ok:false,error:'TRIBE_ACCESS_DENIED'});
 await refused(a,'reserved-directory',{session:third.token});
 await a.evaluate(()=>window.fixture.signOut());
 await refused(a,'status',{},'AUTH_REQUIRED');
 // Reauthenticate as owner to revoke the original capability explicitly.
 await a.evaluate(token=>window.fixture.signIn(token),ownerToken);
 await success(a,'lock',{session:third.token});
 await refused(a,'session-check',{session:third.token});
 assert.equal((await db.doc('connections/'+pair).get()).get('status'),'accepted');
 assert.equal((await db.collection('social_chats/'+pair+'/messages').get()).size,1);
 assert.deepEqual(forbidden,[]);
 console.log('PASS delayed response discarded across account change, logout denied, explicit revocation and shared records preserved');
 // Use a separate named app with actual SDK persistent cache, in the same
 // disposable origin, to queue a valid private-store edit while offline.
 await a.evaluate(({credentials,path})=>window.fixture.queueLegacyStoreWrite(credentials,path),{credentials:ownerToken,path:storePath});
 assert.equal((await db.doc(storePath).get()).get('description'),'before');
 await refused(a,'directory',{},'TRIBE_STORAGE_UNVERIFIED');
 assert.equal((await db.doc(storePath).get()).get('description'),'before');
 assert.equal(await a.evaluate(()=>window.fixture.pendingStoreWrite()),true);
 await a.evaluate(()=>window.fixture.flushLegacyStoreWrite());
 assert.equal((await db.doc(storePath).get()).get('description'),'after-offline-fixture');
 assert.equal(await a.evaluate(()=>window.fixture.pendingStoreWrite()),false);
 await refused(a,'directory',{},'TRIBE_STORAGE_UNVERIFIED');
 assert.deepEqual(forbidden,[]);
 console.log('PASS real persistent SDK pending private-store write preserved and reconciled without cache deletion');
}finally{
 releaseResponse?.();
 try{await browser?.close();}finally{await db.terminate();await deleteApp(app);}
}
