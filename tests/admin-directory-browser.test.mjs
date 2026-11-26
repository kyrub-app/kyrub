import assert from 'node:assert/strict';
import {test} from 'node:test';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import express from 'express';
import {createServer as createViteServer} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {chromium} from 'playwright';
import {createAdminDirectoryEmulatorRouter} from '../server/identity/adminDirectoryEmulatorRouter.ts';

const projectId='demo-kyrub-welcome';
assert.equal(process.env.GCLOUD_PROJECT,projectId);
assert.equal(process.env.GOOGLE_CLOUD_PROJECT,projectId);
assert.equal(process.env.NODE_ENV,'test');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8088');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');
assert.equal(process.env.KYRUB_ADMIN_DIRECTORY_PILOT,'true');
assert.equal(process.env.VITE_KYRUB_ADMIN_DIRECTORY_PILOT,'true');
assert.ok(!process.env.VERCEL&&!process.env.FIREBASE_SERVICE_ACCOUNT_JSON&&!process.env.GOOGLE_APPLICATION_CREDENTIALS);

test('Chromium: real administrative directory resolves Auth email, audits both outcomes and removes revoked access',{timeout:180000},async()=>{
 const app=initializeApp({projectId},'admin-directory-browser');
 const auth=getAuth(app),db=getFirestore(app);
 const password='fixture-only-password-2026',adminEmail='directory-admin@example.invalid',targetEmail='directory-target@example.invalid';
 let vite,server,browser,page;
 const requests=[],diagnostics=[];
 let issuedBearer='';
 try{
  const actor=await auth.createUser({email:adminEmail,password,emailVerified:true});
  const target=await auth.createUser({email:targetEmail,password,emailVerified:true});
  const spoof=await auth.createUser({email:'directory-spoof@example.invalid',password,emailVerified:true});
  const grant=db.doc('kyrub_admin/control_plane/admins/'+actor.uid);
  await grant.set({uid:actor.uid,email:adminEmail,role:'support',status:'active'});
  await db.doc('users/'+target.uid).set({uid:target.uid,name:'Titular reservado homologado',email:'outdated@example.invalid',photoUrl:'',isProfileVisible:false,cpf:'fixture-secret'});
  await db.doc('users/'+spoof.uid).set({uid:spoof.uid,name:'Conta imitadora',email:targetEmail,photoUrl:'',isProfileVisible:true});
  const audits=db.collection('kyrub_admin/control_plane/audit_logs').where('actorId','==',actor.uid);
  const directoryAudits=async()=>(await audits.get()).docs.filter(doc=>doc.get('action')==='admin.directory.user.searched');
  const local=express();
  local.use('/api',express.json({limit:'8kb'}),createAdminDirectoryEmulatorRouter(db,auth));
  vite=await createViteServer({configFile:false,plugins:[tailwindcss()],appType:'custom',server:{middlewareMode:true,hmr:false},esbuild:{jsx:'automatic'}});
  local.get('/admin',async(_req,res)=>res.type('html').send(await vite.transformIndexHtml('/admin','<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/tests/fixtures/gamification-control-plane-browser.tsx"></script></body></html>')));
  local.use('/api',(_req,res)=>res.sendStatus(503));local.use(vite.middlewares);
  server=local.listen(0,'127.0.0.1');
  if(!server.listening)await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  page=await context.newPage();
  page.on('pageerror',error=>diagnostics.push(error.message));
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/admin-directory-pilot/identity')issuedBearer=request.headers().authorization||'';});
  page.on('response',response=>{if(new URL(response.url()).pathname==='/api/admin-directory-pilot/identity')requests.push(response.status());});
  await page.goto('http://127.0.0.1:'+server.address().port+'/admin');
  await page.getByLabel('Email de teste').fill(adminEmail);
  await page.getByLabel('Senha de teste').fill(password);
  await page.getByRole('button',{name:'Entrar na fixture'}).click();
  const panel=page.locator('#admin-platform-directory');
  await panel.locator('summary').filter({hasText:'Plataforma & Tenants'}).click();
  const section=page.locator('#admin-directory');
  const search=async(term)=>{
   await section.getByLabel('E-mail completo ou UID').fill(term);
   await section.getByRole('button',{name:'Buscar',exact:true}).click();
  };
  await search(targetEmail);
  await section.getByRole('heading',{name:'Titular reservado homologado',exact:true}).waitFor();
  assert.equal(await section.getByText('Conta imitadora',{exact:true}).count(),0);
  assert.equal(await section.getByText('outdated@example.invalid',{exact:true}).count(),0);
  assert.equal(await section.getByText('fixture-secret',{exact:true}).count(),0);
  assert.ok(await section.getByText('restrito',{exact:true}).isVisible());
  const found=await directoryAudits();
  assert.equal(found.length,1);assert.equal(found[0].get('source'),'server');assert.equal(found[0].get('targetId'),target.uid);
  await page.screenshot({path:'gamification-admin-isolated-directory.png',fullPage:true});
  await search('missing-directory@example.invalid');
  await section.getByText('Não existe usuário cadastrado para a busca exata',{exact:false}).waitFor();
  const all=await directoryAudits();assert.equal(all.length,2);assert.equal(all.filter(doc=>doc.get('outcome')==='not_found').length,1);
  assert.deepEqual(requests,[200,200]);
  assert.ok(issuedBearer.startsWith('Bearer '));
  const countUrl='http://127.0.0.1:'+server.address().port+'/api/admin-directory-pilot/count';
  const countRequest=(bearer,body='{}')=>fetch(countUrl,{
   method:'POST',headers:{Authorization:bearer,'Content-Type':'application/json'},body
  });
  const expected=(await db.collection('users').count().get()).data().count;
  const result=await countRequest(issuedBearer);
  assert.equal(result.status,200);
  assert.deepEqual(await result.json(),{count:expected});
  assert.equal((await countRequest('')).status,401);
  assert.equal((await countRequest(issuedBearer,'{"term":"test"}')).status,400);
  await grant.update({role:'finance'});
  await panel.waitFor({state:'detached'});
  assert.equal((await countRequest(issuedBearer)).status,403);
  assert.equal(await section.count(),0);
  assert.equal((await directoryAudits()).length,2);
  await context.close();
 }catch(error){
  console.error('[admin-directory-browser]',JSON.stringify({diagnostics:diagnostics.slice(-20),requests}));
  if(page&&!page.isClosed()){
   console.error('[admin-directory-fixture-ui]',(await page.locator('body').innerText()).slice(0,3500));
   await page.screenshot({path:'gamification-admin-isolated-directory-failure.png',fullPage:true});
  }
  throw error;
 }finally{
  if(browser)await browser.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  if(vite)await vite.close();
  await deleteApp(app);
 }
});
