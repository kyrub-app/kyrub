import assert from 'node:assert/strict';
import {test} from 'node:test';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import express from 'express';
import {createServer as createViteServer} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {chromium} from 'playwright';
import {createStaffDirectoryEmulatorRouter} from '../server/identity/storeStaffDirectoryEmulatorRouter.ts';

const projectId='demo-kyrub-welcome';
assert.equal(process.env.GCLOUD_PROJECT,projectId);
assert.equal(process.env.GOOGLE_CLOUD_PROJECT,projectId);
assert.equal(process.env.NODE_ENV,'test');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8088');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');
assert.equal(process.env.KYRUB_STAFF_DIRECTORY_PILOT,'true');
assert.equal(process.env.VITE_KYRUB_STAFF_DIRECTORY_PILOT,'true');
assert.ok(!process.env.VERCEL&&!process.env.FIREBASE_SERVICE_ACCOUNT_JSON&&!process.env.GOOGLE_APPLICATION_CREDENTIALS);

test('Chromium: authorized owner invites private account and recipient accepts canonical membership',{timeout:180000},async()=>{
 const app=initializeApp({projectId},'staff-directory-browser');
 const auth=getAuth(app),db=getFirestore(app);
 const password='fixture-staff-password-2026',storeId='staff-browser-store';
 let vite,server,browser,page;
 const diagnostics=[],external=[];
 try{
  const create=async(kind)=>{
   const email='staff-browser-'+kind+'@example.invalid';
   const person=await auth.createUser({email,password,emailVerified:true,displayName:'Fixture '+kind});
   const uid=person.uid;
   await db.doc('users/'+uid).set({uid,email,name:'Fixture '+kind,photoUrl:'',isProfileVisible:false,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
   await db.doc('age_eligibility_private/'+uid).set({uid,status:'verified_adult'});
   return {uid,email};
  };
  const owner=await create('owner'),target=await create('target');
  // The editable Firestore email is not identity authority. Deliberately
  // give the wrong account the intended recipient's Auth email.
  const decoy=await create('decoy');
  await db.doc('users/'+target.uid).update({email:'stale-target@example.invalid'});
  await db.doc('users/'+decoy.uid).update({email:target.email});
  await db.doc('erp_age_release_private/current').set({schemaVersion:1,mode:'verified_adult_only'});
  await db.doc('stores/'+storeId).set({id:storeId,ownerId:owner.uid,name:'Loja de homologação',legacyTenantId:owner.uid,publicationStatus:'paused',plan:'free',migrationStatus:'registry_only',createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
  const member=db.doc('stores/'+storeId+'/members/'+target.uid);
  const local=express();local.use(express.json({limit:'8kb'}));
  local.use('/api',createStaffDirectoryEmulatorRouter(db,auth));
  // Time-clock is independent of this journey; explicitly unavailable.
  local.get('/api/staff/time-clock/team',(_req,res)=>res.status(503).json({error:'Ponto fora desta homologação'}));
  vite=await createViteServer({configFile:false,plugins:[tailwindcss()],appType:'custom',server:{middlewareMode:true,hmr:false},esbuild:{jsx:'automatic'}});
  local.get('/',async(_req,res)=>res.type('html').send(await vite.transformIndexHtml('/','<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/tests/fixtures/staff-directory-browser.tsx"></script></body></html>')));
  local.use('/api',(_req,res)=>res.sendStatus(503));local.use(vite.middlewares);
  server=local.listen(0,'127.0.0.1');
  if(!server.listening)await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true});
  const login=async person=>{
   const context=await browser.newContext({viewport:{width:390,height:844}});
   await context.route('**/*',route=>{if(new URL(route.request().url()).hostname!=='127.0.0.1'){external.push(route.request().url());return route.abort();}return route.continue();});
   page=await context.newPage();
   page.on('pageerror',error=>diagnostics.push(error.message));
   page.on('console',message=>{if(['error','warning'].includes(message.type()))diagnostics.push(message.text().slice(0,500));});
   await page.goto(origin);
   await page.getByLabel('Email de teste').fill(person.email);
   await page.getByLabel('Senha de teste').fill(password);
   await page.getByRole('button',{name:'Entrar na fixture'}).click();
   await page.getByText('Equipe & Permissões',{exact:true}).waitFor();
   return context;
  };
  let context=await login(owner);
  const input=page.getByPlaceholder('E-mail exato ou nome completo');
  await input.fill('Fixture target');
  const nameResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/staff-directory-pilot/search');
  await page.getByRole('button',{name:'Buscar conta'}).click();
  assert.deepEqual(await (await nameResponse).json(),{entries:[]});
  await input.fill(target.email);
  const searchResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/staff-directory-pilot/search');
  await page.getByRole('button',{name:'Buscar conta'}).click();
  assert.deepEqual(await (await searchResponse).json(),{entries:[{uid:target.uid,name:'Conta Kyrub',photoUrl:''}]});
  const invite=page.getByRole('button',{name:'Convidar Conta Kyrub'});
  await invite.waitFor();
  assert.equal(await page.getByText(target.email,{exact:true}).count(),0);
  const inviteResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/staff-directory-pilot/invite');
  await invite.click();
  assert.equal((await inviteResponse).status(),201);
  await page.getByText('Conta Kyrub foi convidado como Vendedor.',{exact:true}).waitFor();
  const invited=(await member.get()).data();
  assert.equal((await db.doc('stores/'+storeId+'/members/'+decoy.uid).get()).exists,false);
  assert.equal(invited.status,'invited');assert.equal(invited.role,'seller');assert.equal(invited.email,'');assert.equal(invited.invitedBy,owner.uid);
  await page.screenshot({path:'gamification-admin-isolated-staff-owner.png',fullPage:true});
  await context.close();
  context=await login(target);
  await page.getByText('Convites recebidos',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Aceitar',exact:true}).click();
  await page.getByText('Convite aceito.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Aceitar',exact:true}).waitFor({state:'detached'});
  const accepted=(await member.get()).data();
  assert.equal(accepted.status,'active');assert.equal(accepted.role,'seller');assert.equal(accepted.invitedBy,owner.uid);
  assert.equal((await db.doc('users/'+target.uid).get()).get('isProfileVisible'),false);
  assert.equal(await page.getByRole('button',{name:'Buscar conta'}).count(),0);
  await page.screenshot({path:'gamification-admin-isolated-staff-accepted.png',fullPage:true});
  assert.deepEqual(external,[]);
  await context.close();
 }catch(error){
  console.error('[staff-browser]',JSON.stringify(diagnostics.slice(-20)));
  if(page&&!page.isClosed())await page.screenshot({path:'gamification-admin-isolated-staff-failure.png',fullPage:true});
  throw error;
 }finally{
  if(browser)await browser.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  if(vite)await vite.close();
  await deleteApp(app);
 }
});
