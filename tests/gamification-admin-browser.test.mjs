import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { initializeApp,deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { createIsolatedGamificationAdminRouter } from '../server/gamification/semeaduraAdminPilotRouter.ts';
import { refreshIsolatedGamificationIncrementalAccount,openIsolatedGamificationSuspicionCase,closeIsolatedGamificationSuspicionCase } from '../server/gamification/semeaduraAdminSupervision.ts';
import { seedVerifiedPost } from '../server/gamification/semeaduraService.ts';
import { semeaduraEconomicPilotEnabled } from '../server/gamification/semeaduraEconomicPilot.ts';

const projectId='demo-kyrub-welcome';
assert.equal(process.env.GCLOUD_PROJECT,projectId);
assert.equal(process.env.GOOGLE_CLOUD_PROJECT,projectId);
assert.equal(process.env.KYRUB_PITANGA_WELCOME_PROJECT_ID,projectId);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8088');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');
assert.equal(process.env.KYRUB_GAMIFICATION_ADMIN_HTTP_PILOT,'true');
assert.equal(process.env.KYRUB_GAMIFICATION_ADMIN_CASE_WRITE_PILOT,'true');
assert.equal(process.env.NODE_ENV,'test');
assert.ok(!process.env.VERCEL&&!process.env.FIREBASE_SERVICE_ACCOUNT_JSON&&!process.env.GOOGLE_APPLICATION_CREDENTIALS);

test('Chromium reads isolated gamification indicators and case history; ordinary account denied', {timeout:180000},async()=>{
 const app=initializeApp({projectId},'gamification-admin-browser');
 const auth=getAuth(app),db=getFirestore(app);
 let vite,server,browser,page;
 const password='fixture-only-password-2026';
 const adminEmail='admin-browser@example.invalid',ordinaryEmail='ordinary-browser@example.invalid';
 const base='http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
 const signed=async(email)=>{
  const response=await fetch(base+'/accounts:signInWithPassword?key=fake-emulator-key',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
  assert.equal(response.status,200);return response.json();
 };
 try{
  assert.ok(semeaduraEconomicPilotEnabled(db));
  await db.doc('systemControl/pitangaLegacyWriterFence').set({status:'fenced',writersVerified:true,epoch:'welcome-emulator-only'});
  const admin=await auth.createUser({email:adminEmail,password,emailVerified:true});
  const ordinary=await auth.createUser({email:ordinaryEmail,password,emailVerified:true});
  await db.doc('kyrub_admin/control_plane/admins/'+admin.uid).set({uid:admin.uid,role:'super_admin',status:'active'});
  await db.doc('systemControl/semeaduraEconomicReview/reviewers/'+admin.uid).set({schemaVersion:1,reviewerId:admin.uid,active:true,fixtureOnly:true});
  const session=await signed(adminEmail),bearer='Bearer '+session.idToken;
  // Use real trusted Auth creation trigger for a Google fixture, not an invented balance.
  const claims={sub:'admin-browser-author',email:'admin-browser-author@example.invalid',email_verified:true};
  const credential=Buffer.from('{"alg":"none"}').toString('base64url')+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.';
  const google=await fetch(base+'/accounts:signInWithIdp?key=fake-emulator-key',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestUri:'http://localhost',postBody:new URLSearchParams({id_token:credential,providerId:'google.com'}).toString(),returnSecureToken:true})});
  assert.equal(google.status,200);
  const {localId:authorId}=await google.json();
  const balance=db.doc('users/'+authorId+'/pitangaBalance/balance');
  const deadline=Date.now()+60000;
  while(!(await balance.get()).exists&&Date.now()<deadline)await delay(100);
  assert.equal((await balance.get()).get('availableKCoins'),100);
  const postId='browser-suspicion-post';
  await db.doc('social_posts/'+postId).set({postId,authorId,visibility:'public',publicationType:'feed'});
  await seedVerifiedPost(db,{kind:'personal',postId,authenticatedUserId:ordinary.uid});
  await refreshIsolatedGamificationIncrementalAccount(db,auth,bearer,authorId);
  const postKey=createHash('sha256').update('personal\0'+postId).digest('hex');
  const stats=db.doc('semeadura_post_stats/'+postKey);
  await stats.update({acceptedSeeds:2});
  await openIsolatedGamificationSuspicionCase(db,auth,bearer,{caseId:'browser-case',kind:'personal',postId});
  await stats.update({acceptedSeeds:1});
  await closeIsolatedGamificationSuspicionCase(db,auth,bearer,{caseId:'browser-case',outcome:'resolved'});
  const local=express();
  local.use('/api/admin/gamification-pilot',createIsolatedGamificationAdminRouter(db,auth));
  vite=await createViteServer({configFile:false,plugins:[tailwindcss()],appType:'custom',server:{middlewareMode:true,hmr:false},esbuild:{jsx:'automatic'}});
  local.get('/',async(_req,res)=>{res.type('html').send(await vite.transformIndexHtml('/','<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/tests/fixtures/gamification-admin-browser.tsx"></script></body></html>'));});
  local.use(vite.middlewares);
  server=local.listen(0,'127.0.0.1');
  if(!server.listening)await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const external=[];
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.hostname!=='127.0.0.1'){external.push(url.origin);return route.abort();}
   return route.continue();
  });
  page=await context.newPage();
  const login=async email=>{
   await page.getByLabel('Email de teste').fill(email);
   await page.getByLabel('Senha de teste').fill(password);
   await page.getByRole('button',{name:'Entrar na fixture'}).click();
  };
  await page.goto(origin);
  await login(adminEmail);
  await page.getByText('Cobertura global não verificada.',{exact:false}).waitFor();
  assert.equal(await page.locator('dt').filter({hasText:'Saldo conciliado'}).locator('..').locator('dd').textContent(),'100');
  await page.getByRole('button',{name:'Semeadura',exact:true}).click();
  await page.getByText('Bosques pessoais',{exact:true}).waitFor();
  assert.equal(await page.locator('dt').filter({hasText:'Sementes'}).locator('..').locator('dd').textContent(),'1');
  await page.getByRole('button',{name:'Suspeitas de fraude',exact:true}).click();
  await page.getByRole('button',{name:/browser-case/}).waitFor();
  await page.getByLabel('Situação').selectOption('open');
  await page.getByText('Nenhum caso nesta página.').waitFor();
  await page.getByLabel('Situação').selectOption('closed');
  await page.getByRole('button',{name:/browser-case/}).click();
  await page.getByText('Evidência inicial: Divergência entre contador e recibos').waitFor();
  await page.getByText('Desfecho: Resolvido').waitFor();
  await page.screenshot({path:'gamification-admin-isolated-history.png',fullPage:true});
  // A new observation can be triaged without changing the author's balance.
  await page.getByRole('button',{name:'Voltar à lista inicial'}).click();
  await page.getByLabel('Situação').selectOption('all');
  await page.getByRole('heading',{name:'Abrir investigação'}).waitFor();
  await page.getByLabel('Identificador da publicação').fill(postId);
  assert.equal(await page.getByRole('button',{name:'Confirmar abertura'}).isDisabled(),true);
  await page.getByLabel('Confirmo esta decisão de triagem.').check();
  await page.getByRole('button',{name:'Confirmar abertura'}).click();
  await page.getByText('Nenhum indício técnico permite abrir o caso.').waitFor();
  await stats.update({acceptedSeeds:2});
  await page.getByRole('button',{name:'Confirmar abertura'}).click();
  await page.getByRole('heading',{name:'Encerrar investigação'}).waitFor();
  await page.getByLabel('Desfecho').selectOption('resolved');
  await page.getByLabel('Confirmo esta decisão de triagem.').check();
  await page.getByRole('button',{name:'Confirmar encerramento'}).click();
  await page.getByText('Ainda há indícios ou a cobertura é incompleta.').waitFor();
  await page.getByLabel('Desfecho').selectOption('inconclusive');
  await page.getByLabel('Confirmo esta decisão de triagem.').check();
  await page.getByRole('button',{name:'Confirmar encerramento'}).click();
  await page.getByText('Desfecho: Inconclusivo').waitFor();
  await page.screenshot({path:'gamification-admin-isolated-case-closure.png',fullPage:true});
  assert.equal((await db.doc('systemControl/semeaduraEconomicReview/holds/post_'+postKey).get()).exists,false);
  assert.equal((await balance.get()).get('availableKCoins'),100);
  await stats.update({acceptedSeeds:1});

  await page.getByRole('button',{name:'Sair da fixture'}).click();
  await login(ordinaryEmail);
  await page.getByText('Consulta indisponível. Nenhum valor inferido.').waitFor();
  assert.equal(await page.getByText('Evidência inicial:',{exact:false}).count(),0);
  assert.deepEqual(external,[]);
  assert.equal((await balance.get()).get('availableKCoins'),100);
 }catch(error){
  if(page)await page.screenshot({path:'gamification-admin-isolated-failure.png',fullPage:true}).catch(()=>{});
  throw error;
 }finally{
  await browser?.close();
  await vite?.close();
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  await db.terminate();
  await deleteApp(app);
 }
});
