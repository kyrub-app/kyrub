import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import express from 'express';
import {createServer as createViteServer} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {chromium} from 'playwright';
import {createProfileCompletionEmulatorRouter} from '../server/gamification/profileCompletionEmulatorRouter.ts';
import {reserveSocialAddressInDatabase,getOwnedSocialAddressInDatabase,resolveSocialAddressInDatabase} from '../server/identity/publicSocialAddressService.ts';
import {readUserPlatformChallengeCatalog} from '../server/gamification/userPlatformChallengeCatalogService.ts';
import {readPitangaAccount} from '../server/gamification/pitangaAccountService.ts';
import {PROFILE_COMPLETION_CHALLENGE} from '../shared/profileCompletionChallenge.ts';

const projectId='demo-kyrub-welcome';
assert.equal(process.env.GCLOUD_PROJECT,projectId);
assert.equal(process.env.GOOGLE_CLOUD_PROJECT,projectId);
assert.equal(process.env.KYRUB_PITANGA_WELCOME_PROJECT_ID,projectId);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8088');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');
assert.equal(process.env.NODE_ENV,'test');
assert.equal(process.env.KYRUB_PROFILE_COMPLETION_PILOT,'true');
assert.equal(process.env.VITE_KYRUB_PROFILE_COMPLETION_PILOT,'true');
assert.ok(!process.env.VERCEL&&!process.env.FIREBASE_SERVICE_ACCOUNT_JSON&&!process.env.GOOGLE_APPLICATION_CREDENTIALS);

test('Chromium: saved private profile and canonical identifier complete reward exactly once', {timeout:180000},async()=>{
 const app=initializeApp({projectId},'profile-completion-browser');
 const auth=getAuth(app),db=getFirestore(app);
 let vite,server,browser,page;
 const password='fixture-profile-password-2026';
 const challenge=PROFILE_COMPLETION_CHALLENGE.id;
 try{
  await db.doc('systemControl/pitangaLegacyWriterFence').set({status:'fenced',writersVerified:true,epoch:'welcome-emulator-only'});
  await db.doc('global_challenges/'+challenge).set({...PROFILE_COMPLETION_CHALLENGE,status:'active'});
  const create=async(order)=>{
   const email='profile-browser-'+order+'@example.invalid';
   const claims={sub:'profile-browser-'+order,email,email_verified:true};
   const credential=Buffer.from('{"alg":"none"}').toString('base64url')+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.';
   const response=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake-emulator-key',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestUri:'http://localhost',postBody:new URLSearchParams({id_token:credential,providerId:'google.com'}).toString(),returnSecureToken:true})});
   assert.equal(response.status,200);
   const {localId:uid}=await response.json();
   await auth.updateUser(uid,{password});
   const root=db.doc('users/'+uid),balance=root.collection('pitangaBalance').doc('balance');
   const deadline=Date.now()+60000;
   while(!(await balance.get()).exists&&Date.now()<deadline)await delay(100);
   assert.equal((await balance.get()).get('availableKCoins'),100);
   await root.set({uid,name:'Perfil inicial',email,photoUrl:'',isProfileVisible:false,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()},{merge:true});
   await db.doc('age_eligibility_private/'+uid).set({uid,status:'verified_adult'});
   return {uid,email,root,balance,identifier:'perfil-browser-'+order};
  };
  const people=[await create('save-first'),await create('reserve-first')];
  const local=express();
  local.use(express.json({limit:'4kb'}));
  local.use('/api',createProfileCompletionEmulatorRouter(db,auth));
  // Fixture adapters use the real read/reservation services, not mocked success.
  local.use('/api',async(req,res,next)=>{
   const isAddress=req.path==='/health'&&req.query.transport==='manage-public-social-address'&&req.query.kind==='profile';
   const isCatalog=req.path==='/action-execute'&&req.query.transport==='global-challenge-catalog';
   const isBalance=req.path==='/pitangas';
   if(!isAddress&&!isCatalog&&!isBalance){next();return;}
   res.set('Cache-Control','private, no-store');
   if(req.socket.remoteAddress!=='127.0.0.1'){res.sendStatus(404);return;}
   const token=/^Bearer (\S+)$/i.exec(req.get('authorization')||'')?.[1];
   let uid;
   try{if(!token)throw Error();const identity=await auth.verifyIdToken(token,true);if(identity.aud!==projectId)throw Error();uid=identity.uid;}
   catch{res.sendStatus(401);return;}
   try{
    if(isAddress&&req.method==='GET')res.json(await getOwnedSocialAddressInDatabase(db,uid,'profile'));
    else if(isAddress&&req.method==='POST'&&Object.keys(req.body||{}).length===1&&typeof req.body.identifier==='string')res.json(await reserveSocialAddressInDatabase(db,uid,'profile',req.body.identifier));
    else if(isCatalog&&req.method==='GET')res.json(await readUserPlatformChallengeCatalog(db,uid));
    else if(isBalance&&req.method==='GET')res.json(await readPitangaAccount(db,uid));
    else res.sendStatus(405);
   }catch{res.sendStatus(503);}
  });
  vite=await createViteServer({configFile:false,plugins:[tailwindcss()],appType:'custom',server:{middlewareMode:true,hmr:false},esbuild:{jsx:'automatic'}});
  local.get('/',async(_req,res)=>res.type('html').send(await vite.transformIndexHtml('/','<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/tests/fixtures/profile-completion-browser.tsx"></script></body></html>')));
  local.use('/api',(_req,res)=>res.sendStatus(503));local.use(vite.middlewares);
  server=local.listen(0,'127.0.0.1');
  if(!server.listening)await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true});
  for(const [i,person] of people.entries()){
   const context=await browser.newContext({viewport:{width:390,height:844}});
   const external=[];
   await context.route('**/*',route=>{if(new URL(route.request().url()).hostname!=='127.0.0.1'){external.push(route.request().url());return route.abort();}return route.continue();});
   page=await context.newPage();
   await page.goto(origin);
   await page.getByLabel('Email de teste').fill(person.email);
   await page.getByLabel('Senha de teste').fill(password);
   await page.getByRole('button',{name:'Entrar na fixture'}).click();
   await page.getByText('Minha identidade Kyrub',{exact:true}).waitFor();
   await page.getByText('100 Pitangas',{exact:true}).first().waitFor();
   const receipt=person.root.collection('challengeRewards').doc(challenge);
   const event=async(action,status)=>{
    const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/profile-completion-pilot'&&r.request().method()==='POST');
    await action();
    const result=await response;
    assert.equal(result.status(),200);assert.deepEqual(await result.json(),{status});
   };
   const save=async()=>{
    await page.getByLabel('Nome de exibição').fill('Perfil personalizado');
    await page.getByLabel('Biografia').fill('Apresentação fictícia');
    await page.getByRole('button',{name:'Salvar perfil',exact:true}).click();
   };
   const reserve=async()=>{
    await page.getByLabel('Identificador',{exact:true}).fill(person.identifier);
    await page.getByRole('button',{name:'Confirmar endereço permanente'}).click();
   };
   assert.equal((await receipt.get()).exists,false);
   await event(i===0?save:reserve,'pending');
   assert.equal((await person.balance.get()).get('availableKCoins'),100);
   await event(i===0?reserve:save,'completed');
   await page.getByText('200 Pitangas',{exact:true}).waitFor();
   await page.getByRole('button',{name:/Concluídos \(1\)/}).click();
   await page.getByText('Minha identidade Kyrub',{exact:true}).waitFor();
   assert.equal((await receipt.get()).get('pitangas'),100);
   assert.equal((await person.root.get()).get('isProfileVisible'),false);
   assert.equal(await resolveSocialAddressInDatabase(db,'profile',person.identifier),null);
   await event(save,'already_completed');
   assert.equal((await person.balance.get()).get('availableKCoins'),200);
   assert.equal((await person.root.collection('rewardLedger').get()).size,2);
   await page.getByRole('button',{name:'Extrato',exact:true}).click();
   assert.equal(await page.getByRole('list',{name:'Extrato de recompensas'}).locator('li').count(),2);
   await page.screenshot({path:'gamification-admin-isolated-profile-'+i+'.png',fullPage:true});
   assert.deepEqual(external,[]);
   await context.close();
  }
 }finally{
  if(browser)await browser.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  if(vite)await vite.close();
  await deleteApp(app);
 }
});
