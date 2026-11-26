import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import express from 'express';
import {createServer as createViteServer} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {chromium} from 'playwright';

const project='demo-kyrub-welcome',origin='https://kyrub-tag-browser.vercel.app';
test('Chromium: real tag card and virtual WebAuthn authenticator in isolated Firebase',{timeout:180000},async()=>{
 assert.equal(process.env.NODE_ENV,'test');
 assert.equal(process.env.GCLOUD_PROJECT,project);
 assert.equal(process.env.FIREBASE_PROJECT_ID,project);
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8088');
 assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');
 assert.equal(process.env.VITE_KYRUB_DIRECTORY_BROWSER_EMULATOR,'true');
 assert.ok(!process.env.FIREBASE_SERVICE_ACCOUNT_JSON&&!process.env.GOOGLE_APPLICATION_CREDENTIALS&&!process.env.VERCEL);
 const {adminDb,getFirebaseAdminProjectId}=await import('../server/firebaseAdmin.ts');
 assert.equal(getFirebaseAdminProjectId(),project);
 const {default:health}=await import('../api/health.ts');
 const tagId=randomBytes(16).toString('hex');
 const ref=adminDb.doc('kyrub_official_tags/'+tagId);
 await ref.create({distribution:'promotional',model:'adesivo',ownerId:null,activationHash:null,reservedEmailHash:null,enabled:false,blocked:false,manufacturingState:'released',targets:[],externalUrls:[],presentation:{name:'',occupation:'',about:''}});
 let vite,server,browser;
 const errors=[],external=[];
 try{
  const app=express();app.use(express.json({limit:'32kb'}));
  // Only these actual application API transports are admitted in this fixture.
  app.all('/api/health',(req,res,next)=>{
   if(!['public-kyrub-tag','kyrub-tag-passkey'].includes(req.query.transport))return res.sendStatus(404);
   Promise.resolve(health(req,res)).catch(next);
  });
  const firebasePath=resolve('src/utils/firebase');
  const fixturePath=resolve('tests/fixtures/kyrub-tag-passkey-firebase.ts');
  // Resolve every relative import of the shared Firebase client to a test-only
  // emulator module. Do not modify the production localhost safety guard.
  const fixtureFirebase={name:'passkey-fixture-firebase',enforce:'pre',resolveId(source,importer){
   if(importer&&source.startsWith('.')&&resolve(dirname(importer),source).replace(/\.ts$/,'')===firebasePath)return fixturePath;
   return null;
  }};
  vite=await createViteServer({configFile:false,plugins:[fixtureFirebase,tailwindcss()],appType:'custom',server:{middlewareMode:true,hmr:false},esbuild:{jsx:'automatic'}});
  app.get('/tag/:id',async(req,res)=>res.type('html').send(await vite.transformIndexHtml(req.path,'<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/fixtures/kyrub-tag-passkey-browser.tsx"></script></body></html>')));
  app.use('/api',(_req,res)=>res.sendStatus(404));app.use(vite.middlewares);
  server=app.listen(0,'127.0.0.1');
  if(!server.listening)await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  const local='http://127.0.0.1:'+server.address().port;
  const initial=await fetch(local+'/api/health?transport=public-kyrub-tag&id='+tagId);
  assert.equal(initial.status,200);
  const initialData=await initial.json();assert.equal(initialData.status,'unclaimed');assert.equal(initialData.passkeyOrigin,origin);
  browser=await chromium.launch({headless:true});
  async function device(){
   const ctx=await browser.newContext({viewport:{width:390,height:844}});
   // Synthetic secure RP origin is fulfilled from a local-only HTTP server.
   // No requests to the real Vercel host, Firebase production or external APIs.
   await ctx.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===origin){
     const headers=await request.allHeaders();delete headers.host;delete headers['content-length'];delete headers['accept-encoding'];
     const response=await fetch(local+url.pathname+url.search,{method:request.method(),headers,body:request.postDataBuffer()??undefined,redirect:'manual'});
     const out=Object.fromEntries(response.headers.entries());delete out['content-encoding'];delete out['content-length'];delete out['transfer-encoding'];
     return route.fulfill({status:response.status,headers:out,body:Buffer.from(await response.arrayBuffer())});
    }
    if(url.origin==='http://127.0.0.1:9099')return route.continue();
    external.push(url.origin+url.pathname);return route.abort();
   });
   const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
   page.on('response',r=>{if(r.status()>=400&&new URL(r.url()).origin===origin)console.info('Browser resource status:',r.status(),new URL(r.url()).pathname);});
   page.on('dialog',d=>void d.accept());
   const cdp=await ctx.newCDPSession(page);await cdp.send('WebAuthn.enable');
   await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
   await page.goto(origin+'/tag/'+tagId);
   return {ctx,page,cdp};
  }
  const owner=await device(),page=owner.page;
  try{await page.getByRole('heading',{name:'Kyrub',exact:true}).waitFor();}catch(e){
   console.info('Initial page diagnostic:',JSON.stringify({errors:errors.map(x=>x.slice(0,240)),body:(await page.locator('body').innerText()).slice(0,300),externalCount:external.length}));throw e;
  }
  assert.equal(await page.getByRole('link',{name:'Kairub-se!',exact:true}).first().getAttribute('href'),'/');
  await page.getByRole('button',{name:'Editar',exact:true}).click();
  await page.getByLabel('Nome (opcional)').fill('Pessoa de homologação');
  await page.getByLabel('Título ou atividade (opcional)').fill('Autônoma');
  await page.getByLabel('Informações adicionais (opcional)').fill('Cartão de teste');
  await page.getByRole('button',{name:'Salvar',exact:true}).click();
  await page.getByRole('button',{name:'Salvar e publicar com chave de acesso'}).click();
  await page.getByText('Guarde seu código de recuperação',{exact:true}).waitFor({timeout:30000});
  const secret=await page.locator('code').innerText();assert.match(secret,/^[A-Za-z0-9_-]{43}$/);
  const original=(await ref.get()).data();assert.equal(original.ownerAuthMode,'passkey');assert.equal(original.presentation.name,'Pessoa de homologação');
  await page.getByRole('button',{name:'Já guardei · Continuar'}).click();
  await page.getByRole('heading',{name:'Pessoa de homologação',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Compartilhar',exact:true}).count(),1);
  assert.equal(await page.getByRole('button',{name:'Editar',exact:true}).count(),0);
  const visitor=await device();
  await visitor.page.getByRole('button',{name:'Compartilhar',exact:true}).waitFor();
  assert.equal(await visitor.page.getByRole('button',{name:'Editar',exact:true}).count(),0);
  assert.equal(await visitor.page.getByRole('region',{name:'Central do Titular'}).count(),0);
  await visitor.page.getByRole('button',{name:'SOS',exact:true}).click();
  await visitor.page.getByText('Emergência no Brasil',{exact:true}).waitFor();
  await visitor.ctx.close();
  await page.getByRole('button',{name:'Acessar meu CID',exact:true}).click();
  const central=page.getByRole('region',{name:'Central do Titular'});
  await central.waitFor();
  assert.equal(await central.getByText('Ainda indisponível',{exact:true}).count(),4);
  await central.getByRole('button',{name:'Editar CID',exact:true}).click();
  assert.deepEqual((await ref.get()).data(),original);
  assert.equal(await page.getByRole('button',{name:'Compartilhar',exact:true}).count(),0);
  await page.getByLabel('Nome',{exact:true}).fill('Cartão atualizado');
  await page.getByLabel('Disponibilizar recebimentos via Pix').check();
  await page.getByLabel('Chave Pix',{exact:true}).fill('123e4567-e12b-12d1-a456-426655440000');
  await page.getByLabel('Nome do recebedor').fill('Fulano de Tal');
  await page.getByLabel('Cidade do recebedor').fill('BRASILIA');
  await page.getByLabel('Autorizo a publicação desta chave',{exact:false}).check();
  await page.getByRole('button',{name:'Confirmar alterações com chave de acesso'}).click();
  await page.getByRole('heading',{name:'Cartão atualizado',exact:true}).waitFor();
  await page.getByRole('button',{name:'Copiar chave Pix',exact:true}).waitFor();
  // Capture the clipboard write locally; neither payment nor bank APIs are invoked.
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__cidClipboard=text;}}});});
  await page.getByRole('button',{name:'Copiar chave Pix',exact:true}).click();
  await page.getByText('Chave Pix copiada.',{exact:false}).waitFor();
  assert.equal(await page.evaluate(()=>window.__cidClipboard),'123e4567-e12b-12d1-a456-426655440000');
  assert.equal(await page.getByRole('img',{name:'QR Code Pix para pagamento'}).count(),0);
  await page.getByRole('button',{name:'Pix Copia e Cola',exact:true}).click();
  await page.getByText('Pix Copia e Cola copiado.',{exact:false}).waitFor();
  assert.equal(await page.evaluate(()=>window.__cidClipboard),'00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D');
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied');}}});});
  await page.getByRole('button',{name:'Copiar chave Pix',exact:true}).click();
  await page.getByLabel('Chave Pix para cópia manual').waitFor();
  assert.equal(await page.getByLabel('Chave Pix para cópia manual').inputValue(),'123e4567-e12b-12d1-a456-426655440000');
  await page.getByRole('button',{name:'Exibir QR Code',exact:true}).click();
  await page.getByRole('img',{name:'QR Code Pix para pagamento'}).waitFor();
  assert.ok((await page.getByRole('img',{name:'QR Code Pix para pagamento'}).locator('path').getAttribute('d')).length>100);
  await page.getByRole('button',{name:'Pix Copia e Cola',exact:true}).click();
  await page.getByLabel('Código Pix Copia e Cola').waitFor();
  assert.equal(await page.getByLabel('Código Pix Copia e Cola').inputValue(),'00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D');
  await page.getByRole('button',{name:'Acessar meu CID',exact:true}).click();
  await page.getByRole('button',{name:'Editar',exact:true}).click();
  await page.getByLabel('Atividade',{exact:true}).fill('Artista');
  await page.getByRole('button',{name:'Confirmar alterações com chave de acesso'}).click();
  await page.getByText('Artista',{exact:true}).waitFor();
  assert.equal((await ref.get()).data().presentation.pix.key,'123e4567-e12b-12d1-a456-426655440000');
  // Simulate a fresh quota bucket in the verified isolated emulator only.
  await adminDb.doc('kyrub_tag_passkey_quotas/'+tagId).delete();
  await adminDb.doc('kyrub_tag_passkey_quotas/'+tagId+'-verify').delete();
  await page.getByRole('button',{name:'Acessar meu CID',exact:true}).click();
  await page.getByRole('button',{name:'Editar',exact:true}).click();
  await page.getByLabel('Disponibilizar recebimentos via Pix').uncheck();
  await page.getByRole('button',{name:'Confirmar alterações com chave de acesso'}).click();
  await page.getByRole('heading',{name:'Cartão atualizado',exact:true}).waitFor();
  await page.getByRole('button',{name:'Copiar chave Pix',exact:true}).waitFor({state:'hidden'});
  assert.equal(await page.getByRole('button',{name:'Copiar chave Pix',exact:true}).count(),0);
  assert.equal((await ref.get()).data().presentation.pix,null);
  assert.equal(await page.getByRole('img',{name:'QR Code Pix para pagamento'}).count(),0);
  await page.screenshot({path:'passkey-browser-public-card.png',fullPage:true});
  await page.getByRole('button',{name:'Acessar meu CID',exact:true}).click();
  await page.getByRole('button',{name:'Segurança',exact:true}).click();
  await page.getByRole('button',{name:'Bloquear tag perdida'}).click();
  await page.getByText('Este cartão está bloqueado. As informações do titular não estão públicas.',{exact:true}).waitFor();
  assert.equal(await page.getByText('Cartão atualizado',{exact:true}).count(),0);
  await owner.ctx.close();
  const replacement=await device(),fresh=replacement.page;
  await fresh.getByRole('button',{name:'Perdi minha chave de acesso'}).click();
  await fresh.getByLabel('Código de recuperação',{exact:true}).fill(secret);
  await fresh.getByRole('button',{name:'Recuperar com nova chave de acesso'}).click();
  await fresh.getByText('Guarde seu código de recuperação',{exact:true}).waitFor({timeout:30000});
  assert.notEqual(await fresh.locator('code').innerText(),secret);
  await fresh.getByRole('button',{name:'Já guardei · Continuar'}).click();
  await fresh.getByRole('button',{name:'Desbloquear minha tag'}).click();
  await fresh.getByRole('heading',{name:'Cartão atualizado',exact:true}).waitFor();
  const final=(await ref.get()).data();assert.equal(final.ownerId,original.ownerId);assert.equal(final.firstOwnerId,original.firstOwnerId);assert.equal(final.blocked,false);
  await replacement.ctx.close();
  assert.deepEqual(errors,[]);
  console.info('PASSKEY_BROWSER: real React card, WebAuthn CDP registration, edit, block, recovery on separate context, unblock, normal homepage link. External requests blocked:',external.length);
 }finally{await browser?.close();await vite?.close();if(server)await new Promise(resolve=>server.close(resolve));}
});
