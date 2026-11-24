// Browser-only proof of the actual storage guard. No Firebase project,
// credentials, application bootstrap or production network is involved.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const bundle=await build({
 entryPoints:['src/utils/socialPilotStorageGuard.ts'],
 bundle:true,write:false,platform:'browser',format:'esm',
});
const server=createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.url==='/guard.js'){
  res.setHeader('Content-Type','text/javascript');
  return res.end(bundle.outputFiles[0].text);
 }
 if(req.url==='/fixture-worker.js'){
  res.setHeader('Content-Type','text/javascript');
  return res.end('self.addEventListener("install",()=>self.skipWaiting());self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));');
 }
 if(req.url==='/'){
  res.setHeader('Content-Type','text/html; charset=utf-8');
  return res.end('<!doctype html><title>Disposable storage guard fixture</title><script type="module">import {verifySocialPilotStorage} from "/guard.js";window.verifyGuard=async()=>{try{await verifySocialPilotStorage();return "ready"}catch(e){return e.message}};</script>');
 }
 res.writeHead(404);res.end();
});
server.listen(0,'127.0.0.1');
await once(server,'listening');
const origin='http://127.0.0.1:'+server.address().port;
let browser;
const denied='TRIBE_STORAGE_UNVERIFIED';
async function fixture(){
 const context=await browser.newContext();
 // Block external HTTP requests even if future fixture imports change.
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 const page=await context.newPage();
 await page.goto(origin);
 await page.waitForFunction(()=>typeof window.verifyGuard==='function');
 return {context,page};
}
const check=page=>page.evaluate(()=>window.verifyGuard());
try{
 browser=await chromium.launch({headless:true});
 {
  const {context,page}=await fixture();
  try{
   await page.evaluate(()=>{
    localStorage.setItem('kyrub_orders','{"fixture":"pending-order"}');
    localStorage.setItem('kyrub_products','{"fixture":"pending-product"}');
    sessionStorage.setItem('fixture-operational-queue','unsent');
   });
   assert.equal(await check(page),'ready');
   const tab=await context.newPage();
   await tab.goto(origin);
   await tab.waitForFunction(()=>typeof window.verifyGuard==='function');
   for(const key of ['kyrub_friends','kyrub_connection_requests','kyrub_hidden_suggestions_other','kyrub_blocked_users_other']){
    await tab.evaluate(key=>localStorage.setItem(key,'fixture-private'),key);
    assert.equal(await check(page),denied);
    assert.equal(await check(tab),denied);
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),'fixture-private');
    // Cleanup ONLY synthetic keys in this disposable browser context.
    await tab.evaluate(key=>localStorage.removeItem(key),key);
    assert.equal(await check(page),'ready');
   }
   await page.evaluate(()=>sessionStorage.setItem('kyrub_friends','private-session-fixture'));
   assert.equal(await check(page),denied);
   assert.equal(await check(tab),'ready');
   await page.reload();
   await page.waitForFunction(()=>typeof window.verifyGuard==='function');
   assert.equal(await check(page),denied);
   await context.setOffline(true);
   assert.equal(await check(page),denied);
   await context.setOffline(false);
   assert.deepEqual(await page.evaluate(()=>[
    localStorage.getItem('kyrub_orders'),localStorage.getItem('kyrub_products'),
    sessionStorage.getItem('fixture-operational-queue'),sessionStorage.getItem('kyrub_friends')
   ]),['{"fixture":"pending-order"}','{"fixture":"pending-product"}','unsent','private-session-fixture']);
   console.log('PASS shared localStorage, tab-scoped sessionStorage, reload, offline refusal and unchanged operational fixtures');
  }finally{await context.close();}
 }
 {
  const {context,page}=await fixture();
  try{
   const dbName='firestore/[DEFAULT]/kyrub-security-test/main';
   await page.evaluate(async name=>{
    const db=await new Promise((resolve,reject)=>{
     const req=indexedDB.open(name,1);
     req.onupgradeneeded=()=>req.result.createObjectStore('fixture');
     req.onsuccess=()=>resolve(req.result);
     req.onerror=()=>reject(req.error);
    });
    await new Promise((resolve,reject)=>{
     const tx=db.transaction('fixture','readwrite');
     tx.objectStore('fixture').put('unsent-fixture','pending');
     tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
    });
    db.close();
   },dbName);
   assert.equal(await check(page),denied);
   const remaining=await page.evaluate(async name=>{
    if(!(await indexedDB.databases()).some(db=>db.name===name))return null;
    return new Promise((resolve,reject)=>{
     const req=indexedDB.open(name);
     req.onerror=()=>reject(req.error);
     req.onsuccess=()=>{
      const db=req.result;
      const read=db.transaction('fixture').objectStore('fixture').get('pending');
      read.onsuccess=()=>{db.close();resolve(read.result)};
      read.onerror=()=>{db.close();reject(read.error)};
     };
    });
   },dbName);
   assert.equal(remaining,'unsent-fixture');
   console.log('PASS synthetic legacy IndexedDB refused without deletion or mutation');
  }finally{await context.close();}
 }
 {
  const {context,page}=await fixture();
  try{
   assert.equal(await check(page),'ready');
   await page.evaluate(async()=>{await navigator.serviceWorker.register('/fixture-worker.js');await navigator.serviceWorker.ready;});
   assert.equal(await check(page),denied);
   assert.equal(await page.evaluate(async()=> (await navigator.serviceWorker.getRegistrations()).length),1);
   console.log('PASS existing service worker refused without unregistering');
  }finally{await context.close();}
 }
 {
  const {context,page}=await fixture();
  try{
   await page.evaluate(()=>Object.defineProperty(indexedDB,'databases',{value:undefined,configurable:true}));
   assert.equal(await check(page),denied);
   console.log('PASS missing IndexedDB enumeration fails closed');
  }finally{await context.close();}
 }
 {
  const {context,page}=await fixture();
  try{
   await page.evaluate(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('fixture','SecurityError')},configurable:true}));
   assert.equal(await check(page),denied);
   console.log('PASS inaccessible web storage fails closed');
  }finally{await context.close();}
 }
}finally{
 try{await browser?.close();}finally{await new Promise(resolve=>server.close(resolve));}
}
