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
import { createIsolatedSemeaduraHandler } from '../server/gamification/semeaduraHandler.ts';
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

test('Chromium reads isolated gamification indicators and case history; ordinary account denied', {timeout:240000},async()=>{
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
  const semeaduraHttp=createIsolatedSemeaduraHandler(db,auth);
  local.post('/api/action-execute',express.json({limit:'4kb',strict:true}),async(req,res)=>{
   if(req.socket.remoteAddress!=='127.0.0.1'||req.query.transport!=='semeadura'||Object.keys(req.query).length!==1){
    res.status(404).json({error:'NOT_AVAILABLE'});return;
   }
   res.setHeader('Cache-Control','no-store');
   await semeaduraHttp(req,res);
  });

  vite=await createViteServer({configFile:false,plugins:[tailwindcss()],appType:'custom',server:{middlewareMode:true,hmr:false},esbuild:{jsx:'automatic'}});
  local.get('/',async(_req,res)=>{res.type('html').send(await vite.transformIndexHtml('/','<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/tests/fixtures/gamification-admin-browser.tsx"></script></body></html>'));});
  local.get('/admin',async(_req,res)=>{res.type('html').send(await vite.transformIndexHtml('/admin','<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/tests/fixtures/gamification-control-plane-browser.tsx"></script></body></html>'));});
  // Other Control Plane transports are not part of this acceptance test.
  // Return unavailable rather than forwarding, stubbing success or writing.
  local.use('/api',(_req,res)=>res.status(503).json({code:'FIXTURE_NOT_AVAILABLE'}));
  local.use(vite.middlewares);
  server=local.listen(0,'127.0.0.1');
  if(!server.listening)await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  const origin='http://127.0.0.1:'+server.address().port;
  const command={operation:'open',caseId:'http-denied-case',kind:'personal',postId,confirmed:true};
  const write=(token,body,requestOrigin=origin)=>fetch(origin+'/api/admin/gamification-pilot',{
   method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',origin:requestOrigin},body:JSON.stringify(body),
  });
  const ordinarySession=await signed(ordinaryEmail);
  const releaseRef=db.doc('systemControl/semeaduraReleasePilot');
  const opensAt=new Date(Date.now()-60000).toISOString();
  await releaseRef.set({schemaVersion:1,projectId,epoch:'welcome-emulator-only',mode:'isolated-pilot',status:'open',revision:1,opensAt});
  const releaseCommand={operation:'release_change',eventId:'http-release-denied',expectedRevision:1,status:'paused',reason:'Teste de autoridade isolada',confirmed:true};
  const readRelease=token=>fetch(origin+'/api/admin/gamification-pilot?operation=release',{headers:{authorization:'Bearer '+token}});
  assert.equal((await readRelease(ordinarySession.idToken)).status,403);
  assert.equal((await write(ordinarySession.idToken,releaseCommand)).status,403);
  assert.equal((await write(session.idToken,{...releaseCommand,confirmed:false})).status,400);
  assert.equal((await write(session.idToken,{...releaseCommand,actorId:admin.uid})).status,400);
  assert.equal((await write(session.idToken,releaseCommand,'https://outside.invalid')).status,403);
  delete process.env.KYRUB_GAMIFICATION_ADMIN_RELEASE_WRITE_PILOT;
  try{assert.equal((await write(session.idToken,releaseCommand)).status,404);}
  finally{process.env.KYRUB_GAMIFICATION_ADMIN_RELEASE_WRITE_PILOT='true';}
  assert.equal((await releaseRef.get()).get('revision'),1);
  assert.equal((await releaseRef.collection('events').doc(releaseCommand.eventId).get()).exists,false);

  assert.equal((await write(ordinarySession.idToken,command)).status,403);
  assert.equal((await write(session.idToken,{...command,confirmed:false})).status,400);
  assert.equal((await write(session.idToken,{...command,actorId:admin.uid})).status,400);
  assert.equal((await write(session.idToken,command,'https://outside.invalid')).status,403);
  delete process.env.KYRUB_GAMIFICATION_ADMIN_CASE_WRITE_PILOT;
  try{assert.equal((await write(session.idToken,command)).status,404);
    delete process.env.KYRUB_GAMIFICATION_ADMIN_RELEASE_WRITE_PILOT;
    try{assert.equal((await write(session.idToken,command)).status,405);}
    finally{process.env.KYRUB_GAMIFICATION_ADMIN_RELEASE_WRITE_PILOT='true';}}
  finally{process.env.KYRUB_GAMIFICATION_ADMIN_CASE_WRITE_PILOT='true';}
  assert.equal((await db.doc('systemControl/semeaduraSuspicionPilot/cases/http-denied-case').get()).exists,false);

  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const external=[];
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.hostname!=='127.0.0.1'){external.push(url.origin);return route.abort();}
   return route.continue();
  });
  page=await context.newPage();
  let snapshotRequests=0;
  page.on('request',request=>{const url=new URL(request.url());if(url.pathname==='/api/admin/gamification-pilot'&&url.searchParams.get('operation')==='snapshot')snapshotRequests++;});
  const login=async email=>{
   await page.getByLabel('Email de teste').fill(email);
   await page.getByLabel('Senha de teste').fill(password);
   await page.getByRole('button',{name:'Entrar na fixture'}).click();
  };
  await page.goto(origin);
  await login(adminEmail);
  await page.getByText('Cobertura global não verificada.',{exact:false}).waitFor();
  assert.equal(await page.locator('dt').filter({hasText:'Saldo conciliado'}).locator('..').locator('dd').textContent(),'100');
  const beforeSwitch=snapshotRequests;
  assert.equal(beforeSwitch,1);
  await page.getByRole('button',{name:'Semeadura',exact:true}).click();
  await page.getByText('Bosques pessoais',{exact:true}).waitFor();
  assert.equal(await page.locator('dt').filter({hasText:'Sementes'}).locator('..').locator('dd').textContent(),'1');
  assert.equal(snapshotRequests,beforeSwitch);
  const refreshed=page.waitForResponse(response=>new URL(response.url()).searchParams.get('operation')==='snapshot'&&response.ok());
  await page.getByRole('button',{name:'Atualizar consulta'}).click();
  await refreshed;
  assert.equal(snapshotRequests,beforeSwitch+1);
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
  await openIsolatedGamificationSuspicionCase(db,auth,bearer,{caseId:'browser-referral',kind:'personal',postId});
  await closeIsolatedGamificationSuspicionCase(db,auth,bearer,{caseId:'browser-referral',outcome:'referred_for_review'});
  await page.getByRole('button',{name:'Revisões econômicas',exact:true}).click();
  await page.getByRole('button',{name:'browser-referral · Aguardando aceite'}).click();
  await page.getByRole('heading',{name:'Evidência inicial'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Aceitar encaminhamento'}).isDisabled(),true);
  await page.getByLabel('Confirmo esta decisão de revisão.').check();
  await page.getByRole('button',{name:'Aceitar encaminhamento'}).click();
  await page.getByLabel('Decisão econômica').selectOption('no_action');
  await page.getByLabel('Justificativa').fill('Indício técnico sem fundamento para medida econômica.');
  await page.getByLabel('Confirmo esta decisão de revisão.').check();
  await page.getByRole('button',{name:'Registrar decisão'}).click();
  await page.getByText('Decisão: Sem intervenção').waitFor();
  await page.getByText('Justificativa: Indício técnico sem fundamento para medida econômica.').waitFor();
  await page.screenshot({path:'gamification-admin-isolated-economic-review.png',fullPage:true});
  assert.equal((await db.doc('systemControl/semeaduraEconomicReview/holds/post_'+postKey).get()).exists,false);
  assert.equal((await balance.get()).get('availableKCoins'),100);
  await stats.update({acceptedSeeds:1});

  await page.getByRole('button',{name:'Sair da fixture'}).click();
  await login(ordinaryEmail);
  await page.getByText('Consulta indisponível. Nenhum valor inferido.').waitFor();
  assert.equal(await page.getByText('Evidência inicial:',{exact:false}).count(),0);
  // Exercise the real Control Plane root and Firestore profile subscription.
  await page.goto(origin+'/admin');
  await login(adminEmail);
  await page.locator('#admin-global-challenges > summary').click();
  await page.getByText('Cobertura global não verificada.',{exact:false}).waitFor();
  assert.equal(await page.locator('dt').filter({hasText:'Saldo conciliado'}).locator('..').locator('dd').textContent(),'100');
  await page.getByRole('button',{name:'Revisões econômicas',exact:true}).click();
  await page.getByRole('button',{name:'browser-referral · Decisão registrada'}).click();
  await page.getByText('Decisão: Sem intervenção').waitFor();
  await page.screenshot({path:'gamification-admin-isolated-control-plane.png',fullPage:true});

  // Dedicated author and synthetic milestone boundary: no claim that 999
  // historical receipts exist. Actual accepted seed and credit use the
  // strict public handler using real emulator ID tokens and local HTTP.
  const milestoneClaims={sub:'browser-release-milestone',email:'browser-release-milestone@example.invalid',email_verified:true};
  const milestoneCredential=Buffer.from('{"alg":"none"}').toString('base64url')+'.'+Buffer.from(JSON.stringify(milestoneClaims)).toString('base64url')+'.';
  const milestoneLogin=await fetch(base+'/accounts:signInWithIdp?key=fake-emulator-key',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestUri:'http://localhost',postBody:new URLSearchParams({id_token:milestoneCredential,providerId:'google.com'}).toString(),returnSecureToken:true})});
  assert.equal(milestoneLogin.status,200);
  const {localId:milestoneAuthor}=await milestoneLogin.json();
  const milestoneRoot=db.collection('users').doc(milestoneAuthor);
  const milestoneBalance=milestoneRoot.collection('pitangaBalance').doc('balance');
  const milestoneDeadline=Date.now()+60000;
  while(!(await milestoneBalance.get()).exists&&Date.now()<milestoneDeadline)await delay(100);
  assert.equal((await milestoneBalance.get()).get('availableKCoins'),100);
  const milestonePostId='browser-release-milestone-post';
  const milestoneKey=createHash('sha256').update('personal\0'+milestonePostId).digest('hex');
  const milestoneStats=db.doc('semeadura_post_stats/'+milestoneKey);
  const milestoneProgress=milestoneRoot.collection('semeaduraProgress').doc('summary');
  const milestoneCursor=milestoneRoot.collection('semeaduraEconomicPilot').doc('activation');
  const milestoneReceipt=milestoneStats.collection('receipts').doc(admin.uid);
  const milestoneLedger=milestoneRoot.collection('rewardLedger');
  const {semeaduraDay}=await import('../shared/semeaduraDailyLimit.ts');
  const quota=db.doc('users/'+admin.uid+'/semeaduraDailyUsage/'+semeaduraDay(new Date()));
  await db.doc('social_posts/'+milestonePostId).set({postId:milestonePostId,authorId:milestoneAuthor,visibility:'public',publicationType:'feed'});
  await milestoneProgress.set({authorId:milestoneAuthor,acceptedSeeds:999,pitangueiras:0});
  await milestoneCursor.set({schemaVersion:1,authorId:milestoneAuthor,epoch:'welcome-emulator-only',acceptedSeeds:999,creditedPitangas:0,currencyAuthority:'welcome'});

  const seedBody={action:'semear',kind:'personal',postId:milestonePostId};
  const requestSeed=(body=seedBody,token=session.idToken)=>fetch(origin+'/api/action-execute?transport=semeadura',{
   method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body),
  });
  const seed=async()=>{
   const response=await requestSeed();
   assert.equal(response.status,200);
   return response.json();
  };
  assert.equal((await requestSeed(seedBody,'invalid-token')).status,401);
  assert.equal((await requestSeed({...seedBody,authenticatedUserId:ordinary.uid})).status,400);
  delete process.env.KYRUB_SEMEADURA_HTTP_EMULATOR_TEST;
  try{assert.equal((await requestSeed()).status,404);}
  finally{process.env.KYRUB_SEMEADURA_HTTP_EMULATOR_TEST='true';}
  delete process.env.KYRUB_SEMEADURA_SERVER_ENABLED;
  try{assert.equal((await requestSeed()).status,503);}
  finally{process.env.KYRUB_SEMEADURA_SERVER_ENABLED='true';}

  await page.getByRole('button',{name:'Semeadura',exact:true}).click();
  const releasePanel=page.getByRole('region',{name:'Controle de semeadura'});
  await releasePanel.getByText('Estado registrado: Aberto · revisão 1').waitFor();
  assert.equal(await releasePanel.getByRole('button',{name:'Confirmar pausa'}).isDisabled(),true);
  await releasePanel.getByLabel('Motivo da decisão').fill('Interrupção operacional de homologação');
  assert.equal(await releasePanel.getByRole('button',{name:'Confirmar pausa'}).isDisabled(),true);
  await releasePanel.getByLabel('Confirmo a alteração no ambiente de homologação.').check();
  await releasePanel.getByRole('button',{name:'Confirmar pausa'}).click();
  await releasePanel.getByText('Estado registrado: Pausado · revisão 2').waitFor();
  await page.screenshot({path:'gamification-admin-isolated-release-paused.png',fullPage:true});
  const pausedResponse=await requestSeed();
  assert.equal(pausedResponse.status,503);
  assert.deepEqual(await pausedResponse.json(),{error:'SEMEADURA_RELEASE_UNAVAILABLE'});
  assert.equal((await milestoneBalance.get()).get('availableKCoins'),100);
  assert.equal((await milestoneProgress.get()).get('acceptedSeeds'),999);
  assert.equal((await milestoneCursor.get()).get('acceptedSeeds'),999);
  assert.equal((await milestoneLedger.get()).size,1);
  for(const ref of [milestoneStats,milestoneReceipt,quota])assert.equal((await ref.get()).exists,false);
  await releasePanel.getByLabel('Motivo da decisão').fill('Retomada operacional de homologação');
  await releasePanel.getByLabel('Confirmo a alteração no ambiente de homologação.').check();
  await releasePanel.getByRole('button',{name:'Confirmar retomada'}).click();
  await releasePanel.getByText('Estado registrado: Aberto · revisão 3').waitFor();
  const outcomes=await Promise.all([seed(),seed()]);
  assert.equal(outcomes.filter(r=>r.status==='accepted').length,1);
  assert.equal(outcomes.filter(r=>r.status==='already_seeded').length,1);
  assert.equal((await milestoneBalance.get()).get('availableKCoins'),101);
  assert.equal((await milestoneProgress.get()).get('acceptedSeeds'),1000);
  assert.equal((await milestoneCursor.get()).get('creditedPitangas'),1);
  assert.equal((await quota.get()).get('count'),1);
  assert.equal((await milestoneLedger.get()).size,2);
  assert.equal((await milestoneLedger.doc('earn_semeadura_1').get()).get('deltaKCoins'),1);
  assert.equal((await milestoneRoot.collection('xpLedger').get()).size,0);
  const readStatus=await requestSeed({action:'status',kind:'personal',postId:milestonePostId});
  assert.equal(readStatus.status,200);
  const status=await readStatus.json();
  assert.equal(status.seeded,true);
  assert.equal(status.dailyRemaining,99);
  const journeyResponse=await requestSeed({action:'journey'},(await (async()=>{
   const r=await fetch(base+'/accounts:signInWithIdp?key=fake-emulator-key',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestUri:'http://localhost',postBody:new URLSearchParams({id_token:milestoneCredential,providerId:'google.com'}).toString(),returnSecureToken:true})});
   assert.equal(r.status,200);return r.json();
  })()).idToken);
  assert.equal(journeyResponse.status,200);
  assert.equal((await journeyResponse.json()).journey.totalSeeds,1000);

  const events=await releaseRef.collection('events').get();
  assert.equal(events.size,2);
  assert.deepEqual(events.docs.map(d=>d.get('revision')).sort(),[2,3]);
  assert.ok(events.docs.every(d=>d.get('reviewerId')===admin.uid&&d.get('opensAt')===opensAt));
  assert.equal((await releaseRef.get()).get('opensAt'),opensAt);
  await page.screenshot({path:'gamification-admin-isolated-release-resumed.png',fullPage:true});
  const profile=db.doc('kyrub_admin/control_plane/admins/'+admin.uid);
  await profile.update({status:'suspended'});
  await page.getByRole('heading',{name:'Acesso administrativo suspenso'}).waitFor();
  assert.equal(await page.locator('#admin-global-challenges').count(),0);
  await page.getByRole('button',{name:'Sair',exact:true}).click();
  await page.getByRole('button',{name:'Entrar com Google'}).waitFor();
  await login(ordinaryEmail);
  await page.getByRole('heading',{name:'Conta sem autorização administrativa'}).waitFor();
  assert.equal(await page.locator('#admin-global-challenges').count(),0);
  assert.equal(await page.getByText('Decisão: Sem intervenção').count(),0);
  await profile.update({status:'active'});
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
