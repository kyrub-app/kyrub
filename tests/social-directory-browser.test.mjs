import assert from 'node:assert/strict';
import {test} from 'node:test';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import express from 'express';
import {createServer as createViteServer} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {chromium} from 'playwright';
import {createSocialDirectoryEmulatorRouter} from '../server/identity/socialDirectoryEmulatorRouter.ts';

const projectId='demo-kyrub-welcome';
assert.equal(process.env.GCLOUD_PROJECT,projectId);
assert.equal(process.env.GOOGLE_CLOUD_PROJECT,projectId);
assert.equal(process.env.NODE_ENV,'test');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8088');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');
assert.equal(process.env.KYRUB_SOCIAL_DIRECTORY_PILOT,'true');
assert.equal(process.env.VITE_KYRUB_SOCIAL_DIRECTORY_PILOT,'true');
assert.ok(!process.env.VERCEL&&!process.env.FIREBASE_SERVICE_ACCOUNT_JSON&&!process.env.GOOGLE_APPLICATION_CREDENTIALS);

test('Chromium: native suggestions paginate public accounts and preserve private historical attribution and connections',{timeout:180000},async()=>{
 const app=initializeApp({projectId},'social-directory-browser');
 const auth=getAuth(app),db=getFirestore(app);
 const email='social-browser-actor@example.invalid',password='fixture-social-password-2026';
 let vite,server,browser,page;
 const diagnostics=[],requests=[];
 try{
  const actor=await auth.createUser({email,password,emailVerified:true,displayName:'Titular fixture'});
  const privateId='social-browser-private';
  const batch=db.batch();
  batch.set(db.doc('users/'+actor.uid),{uid:actor.uid,email,name:'Titular fixture',isProfileVisible:false});
  for(let i=0;i<45;i++){
   const suffix=String(i).padStart(2,'0'),uid='social-browser-'+suffix;
   batch.set(db.doc('users/'+uid),{uid,name:'Contato público '+suffix,isProfileVisible:true,photoUrl:'',email:'fixture-secret-'+suffix+'@example.invalid',cpf:'fixture'});
  }
  batch.set(db.doc('users/'+privateId),{uid:privateId,name:'Nome reservado atual',isProfileVisible:false,email:'private@example.invalid',photoUrl:''});
  const connectionId=[actor.uid,privateId].sort().join('_');
  const connection=db.doc('connections/'+connectionId);
  batch.set(connection,{senderId:actor.uid,receiverId:privateId,participantIds:[actor.uid,privateId].sort(),status:'accepted',senderName:'Titular fixture',receiverName:'Contato reservado histórico',senderRole:'Cliente',receiverRole:'Cliente',senderAvatar:'',receiverAvatar:'',senderBio:'',receiverBio:'',createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
  await batch.commit();
  const local=express();local.use(express.json({limit:'8kb'}));local.use('/api',createSocialDirectoryEmulatorRouter(db,auth));
  vite=await createViteServer({configFile:false,plugins:[tailwindcss()],appType:'custom',server:{middlewareMode:true,hmr:false},esbuild:{jsx:'automatic'}});
  local.get('/',async(_req,res)=>res.type('html').send(await vite.transformIndexHtml('/','<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/tests/fixtures/social-directory-browser.tsx"></script></body></html>')));
  local.use('/api',(_req,res)=>res.sendStatus(503));local.use(vite.middlewares);
  server=local.listen(0,'127.0.0.1');
  if(!server.listening)await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  page=await context.newPage();
  page.on('pageerror',error=>diagnostics.push(error.message));
  page.on('response',response=>{if(new URL(response.url()).pathname==='/api/social-directory-pilot/page'&&response.ok())requests.push(response.request().postDataJSON());});
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByLabel('Email de teste').fill(email);
  await page.getByLabel('Senha de teste').fill(password);
  await page.getByRole('button',{name:'Entrar na fixture'}).click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="visible-author"]')?.textContent==='Contato público 00');
  assert.equal(await page.getByTestId('private-author').textContent(),'Autor histórico reservado');
  await page.getByRole('button',{name:'Abrir conectados na fixture'}).click();
  await page.getByText('Contato reservado histórico',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Abrir novas conexões'}).click();
  await page.getByRole('button',{name:/Sugestões/}).click();
  await page.getByText('Contato público 00',{exact:true}).waitFor();
  assert.equal(await page.getByText('Contato público 44',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Carregar mais sugestões'}).scrollIntoViewIfNeeded();
  await page.getByText('Contato público 44',{exact:true}).waitFor();
  assert.ok(requests.some(body=>typeof body.after==='string'));
  assert.equal(await page.getByText('Contato público 00',{exact:true}).count(),1);
  assert.equal(await page.getByText('Nome reservado atual',{exact:true}).count(),0);
  assert.equal(await page.getByText('fixture-secret-00@example.invalid',{exact:true}).count(),0);
  await page.screenshot({path:'gamification-admin-isolated-social-directory.png',fullPage:true});
  await db.doc('users/social-browser-00').update({isProfileVisible:false});
  await page.getByRole('button',{name:'Fechar novos contatos'}).click();
  await page.getByRole('button',{name:'Abrir novas conexões'}).click();
  await page.getByText('Contato público 01',{exact:true}).waitFor();
  assert.equal(await page.getByText('Contato público 00',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Fechar novos contatos'}).click();
  await page.getByText('Contato reservado histórico',{exact:true}).waitFor();
  assert.equal((await connection.get()).get('status'),'accepted');
  await context.close();
 }catch(error){
  console.error('[social-browser]',JSON.stringify({diagnostics:diagnostics.slice(-20),requests}));
  if(page&&!page.isClosed())await page.screenshot({path:'gamification-admin-isolated-social-failure.png',fullPage:true});
  throw error;
 }finally{
  if(browser)await browser.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  if(vite)await vite.close();
  await deleteApp(app);
 }
});
