// Real browser SDK, pilot client and HTTP transport; fictional emulator accounts only.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
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
const bundle=await build({
 stdin:{contents:`
  import {auth,db} from './src/utils/firebase';
  import {signInWithCustomToken,signOut,setPersistence,inMemoryPersistence} from 'firebase/auth';
  import {requestReservedTribePilot,reservedTribePilotClientEnabled} from './src/utils/reservedTribePilotClient';
  window.fixture={
   projects:()=>[auth.app.options.projectId,db.app.options.projectId],
   enabled:reservedTribePilotClientEnabled,
   signIn:async token=>{await setPersistence(auth,inMemoryPersistence);return (await signInWithCustomToken(auth,token)).user.uid},
   signOut:()=>signOut(auth),
   call:async (action,fields={})=>{try{return {ok:true,value:await requestReservedTribePilot(action,fields)}}catch(e){return {ok:false,error:e.message}}},
  };
 `,resolveDir:process.cwd(),loader:'ts'},
 bundle:true,write:false,format:'esm',platform:'browser',
 define:{'import.meta.env':JSON.stringify({DEV:true,VITE_KYRUB_FIREBASE_EMULATOR_E2E:'true',VITE_KYRUB_SOCIAL_MEMORY_CACHE_E2E:'true'})},
});
const app=initializeApp({projectId:project},'reserved-tribe-http-browser');
const auth=getAuth(app),db=getFirestore(app);
const owner='browser-tribe-owner',peer='browser-tribe-peer',pair=[owner,peer].sort().join('_');
const code='fixture-only-code';
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
  await auth.createUser({uid,email:uid+'@example.invalid',emailVerified:true});
  await db.doc('users/'+uid).set({name:uid,isProfileVisible:true});
 }
 await db.doc('connections/'+pair).set({senderId:owner,receiverId:peer,participantIds:[owner,peer].sort(),status:'accepted',senderName:owner,receiverName:peer});
 const ownerToken=await auth.createCustomToken(owner),peerToken=await auth.createCustomToken(peer);
 browser=await chromium.launch({headless:true});
 const forbidden=[];
 async function open(){
  const ctx=await browser.newContext({serviceWorkers:'block'});
  await ctx.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin===origin&&url.pathname==='/__tribe_fixture'){
    return route.fulfill({contentType:'text/html',body:'<!doctype html><script type="module" src="/__tribe_fixture.js"></script>'});
   }
   if(url.origin===origin&&url.pathname==='/__tribe_fixture.js'){
    return route.fulfill({contentType:'text/javascript',body:bundle.outputFiles[0].text});
   }
   if([origin,'http://127.0.0.1:9099','http://127.0.0.1:8088','http://127.0.0.1:9199'].includes(url.origin))return route.continue();
   forbidden.push(url.origin);return route.abort();
  });
  const page=await ctx.newPage();
  await page.goto(origin+'/__tribe_fixture');
  await page.waitForFunction(()=>window.fixture?.enabled()===true);
  assert.deepEqual(await page.evaluate(()=>window.fixture.projects()),[project,project]);
  return page;
 }
 const a=await open(),b=await open();
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
}finally{
 releaseResponse?.();
 try{await browser?.close();}finally{await db.terminate();await deleteApp(app);}
}
