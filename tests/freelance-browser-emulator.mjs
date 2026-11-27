import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';

const project='kyrub-security-test',origin='http://127.0.0.1:3000';
for(const key of ['FIREBASE_PROJECT_ID','GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT'])assert.equal(process.env[key],project);
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8088');
assert.equal(process.env.KYRUB_FREELANCE_LOCAL_HOMOLOGATION,'true');
assert.equal(process.env.VITE_KYRUB_FREELANCE_LOCAL_HOMOLOGATION,'true');
assert.equal(process.env.VITE_KYRUB_FIREBASE_EMULATOR_E2E,'true');
for(const key of ['VERCEL','VERCEL_ENV','FIREBASE_SERVICE_ACCOUNT_JSON','GOOGLE_APPLICATION_CREDENTIALS'])assert.ok(!process.env[key],key);
const {initializeApp}=await import('firebase-admin/app');
const {getAuth}=await import('firebase-admin/auth');
const {getFirestore}=await import('firebase-admin/firestore');
const app=initializeApp({projectId:project}),auth=getAuth(app),db=getFirestore(app);
const {confirmSimulatedFreelanceFunding}=await import('../server/freelance/freelanceFundingService.ts');
const suffix=randomUUID().replaceAll('-','').slice(0,12);
const title='Freela Chromium '+suffix;
const browser=await chromium.launch({headless:true});
const forbidden=[],uncaught=[];
let employerPage;
await mkdir('freelance-browser-evidence',{recursive:true});
async function account(role,profile,name){
 const uid='browser-'+role+'-'+suffix;
 await auth.createUser({uid,email:uid+'@example.invalid',emailVerified:true});
 await db.doc('identity_verifications/'+uid).set({status:'approved',approvedProfiles:[profile]});
 await db.doc('age_eligibility_private/'+uid).set({uid,status:'verified_adult'});
 await db.doc('users/'+uid).set({uid,name,isProfileVisible:true});
 return {uid,token:await auth.createCustomToken(uid)};
}
async function session(actor,width){
 const context=await browser.newContext({viewport:{width,height:844}});
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  const remoteFirebase=!['127.0.0.1','localhost'].includes(url.hostname)&&
    (['identitytoolkit.googleapis.com','securetoken.googleapis.com','firestore.googleapis.com','firebasestorage.googleapis.com'].includes(url.hostname)||url.hostname.endsWith('.firebaseio.com')||url.hostname.endsWith('.firebasestorage.app'));
  if(remoteFirebase){forbidden.push(url.origin);await route.abort();return;}
  if(!['127.0.0.1','localhost'].includes(url.hostname)&&['http:','https:'].includes(url.protocol)){await route.abort();return;}
  await route.continue();
 });
 const page=await context.newPage();
 page.on('pageerror',e=>uncaught.push(e.message));
 await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
 const identity=await page.evaluate(async token=>{
  const {auth,db,storage}=await import(new URL('/src/utils/firebase.ts',location.origin).href);
  const {signInWithCustomToken}=await import(new URL('/node_modules/.vite/deps/firebase_auth.js',location.origin).href);
  const credential=await signInWithCustomToken(auth,token);
  return {uid:credential.user.uid,auth:auth.app.options.projectId,db:db.app.options.projectId,storage:storage.app.options.projectId};
 },actor.token);
 assert.deepEqual(identity,{uid:actor.uid,auth:project,db:project,storage:project});
 await page.reload({waitUntil:'domcontentloaded'});
 await page.locator('#btn-solicitar-freela').waitFor({state:'visible',timeout:30000});
 assert.equal((await page.locator('#btn-fazer-freela').innerText()).trim().toLocaleLowerCase('pt-BR'),'fazer freela','Candidate must not show an unverified local vacancy count');
 return page;
}
const waitText=(root,text)=>root.getByText(text,{exact:false}).first().waitFor({state:'visible',timeout:20000});
const button=(root,name)=>root.getByRole('button',{name,exact:true});
async function open(page,role){
 await page.locator(role==='owner'?'#btn-solicitar-freela':'#btn-fazer-freela').click();
 const modal=page.getByRole('dialog',{name:role==='owner'?'Solicitar Freelas':'Fazer Freelas',exact:true});
 await waitText(modal,'Homologação local. Nenhum pagamento real.');
 await button(modal,role==='owner'?'Solicitar serviço':'Solicitações').waitFor({state:'visible'});
 return modal;
}
async function action(modal,name,expected=200){
 await button(modal,name).click();
 const page=modal.page();
 const response=page.waitForResponse(r=>r.url().endsWith('/api/freelance/workspace')&&r.request().method()==='POST',{timeout:20000});
 await button(modal,'Confirmar').click();
 const result=await response;
 const body=await result.json();
 assert.equal(result.status(),expected,JSON.stringify(body));
 if(expected===200){
  assert.deepEqual(body,{confirmed:true});
  await waitText(modal,'Operação confirmada pelo servidor.');
 }
 return body;
}
async function detail(modal,tab){
 const page=modal.page();
 // Explicit navigation back to Catu and re-entry tests persisted server state
 // independently of a modal staying mounted across actions in another context.
 const owner=page===employerPage;
 if(await modal.isVisible())await button(modal,'Fechar').click();
 await page.locator(owner?'#btn-solicitar-freela':'#btn-fazer-freela').waitFor({state:'visible',timeout:20000});
 await open(page,owner?'owner':'worker');
 await button(modal,tab).click();
 const view=tab==='Solicitações'?'open':tab==='Publicados'?'owner':tab==='Histórico'?(owner?'owner':'applications'):'applications';
 const loaded=page.waitForResponse(r=>r.url().includes('/api/freelance/workspace?view='+view)&&r.request().method()==='GET',{timeout:20000});
 await button(modal,'Atualizar consulta').click();
 const response=await loaded;
 const payload=await response.json();
 assert.equal(response.status(),200,JSON.stringify(payload));
 assert.ok(payload.items.some(x=>x.title===title),'Published offer missing from API response: '+JSON.stringify(payload));
 // Inner locator must be relative to the article, not include the enclosing dialog.
 const article=modal.locator('article').filter({has:page.getByRole('heading',{name:title,exact:true})}).first();
 await article.waitFor({state:'visible',timeout:20000});
 console.log('PASS browser list and visible offer:',tab);
 const details=page.waitForResponse(r=>r.url().includes('/api/freelance/workspace?view=detail&offerId=')&&r.request().method()==='GET',{timeout:20000});
 await button(article,'Ver detalhes').click();
 const read=await details;
 assert.equal(read.status(),200,await read.text());
 await modal.locator('article').filter({hasText:'Descrição de teste isolado'}).waitFor({state:'visible',timeout:20000});
}
try{
 const owner=await account('owner','requester','Contratante teste'),worker=await account('worker','freelancer','Prestador teste');
 const ownerPage=await session(owner,1365),workerPage=await session(worker,390);
 employerPage=ownerPage;
 const employer=await open(ownerPage,'owner'),employee=await open(workerPage,'worker');
 await employer.getByLabel('Título',{exact:true}).fill(title);
 await employer.getByLabel('Descrição',{exact:true}).fill('Descrição de teste isolado');
 await employer.getByLabel('Requisitos',{exact:true}).fill('Somente emulador');
 await employer.getByLabel('Valor acordado (R$)',{exact:true}).fill('150,00');
 await action(employer,'Publicar freela');
 const offers=await db.collection('freelanceOffersV1').where('ownerUid','==',owner.uid).get();
 assert.equal(offers.size,1);const offerId=offers.docs[0].id;
 await detail(employee,'Solicitações');
 // Reproduce the existing delivery bridge's actual cache refresh using a fictional
 // document in the isolated emulator. Verify the card remounts but this very
 // dialog and its selected details remain mounted. No application test hook.
 const deliveryId='browser-refresh-'+suffix;
 const witness=await workerPage.evaluate(()=>{
  const dialog=document.querySelector('[role="dialog"][aria-label="Fazer Freelas"]');
  const card=document.getElementById('btn-fazer-freela');
  if(!dialog||!card)return false;
  window.__freelaRemountWitness={dialog,card};
  return true;
 });
 assert.equal(witness,true);
 const deliveryRef=db.doc('hub/renda/deliveries/'+deliveryId);
 try{
  await deliveryRef.set({id:deliveryId,source:'kyrub-order',sourceOrderId:'fictional-'+suffix,status:'available',from:'Origem fictícia',to:'Destino fictício',distance:1,payment:1,requestedBy:'Teste isolado'});
  await workerPage.waitForFunction(id=>{
   const w=window.__freelaRemountWitness;
   return !!w&&!w.card.isConnected&&!!document.getElementById('btn-fazer-freela')&&
    (JSON.parse(localStorage.getItem('kyrub_deliveries')??'[]')).some(x=>x.id===id);
  },deliveryId,{timeout:20000});
  assert.equal(await workerPage.evaluate(()=>window.__freelaRemountWitness.dialog===document.querySelector('[role="dialog"][aria-label="Fazer Freelas"]')&&window.__freelaRemountWitness.dialog.isConnected),true,'The original Freelas panel must survive LegacyApp remount');
  await button(employee,'Candidatar-se').waitFor({state:'visible',timeout:10000});
  console.log('PASS controlled delivery cache refresh: legacy card remounted, original Freelas panel and details retained');
 }finally{
  await deliveryRef.delete();
  await workerPage.evaluate(()=>{delete window.__freelaRemountWitness;});
 }
 await action(employee,'Candidatar-se');
 await detail(employer,'Publicados');await action(employer,'Selecionar Prestador teste');
 // The worker's independently authenticated panel must survive the other account's mutation.
 await employee.waitFor({state:'visible',timeout:15000});
 await detail(employee,'Fazendo');await action(employee,'Confirmar contratação');
 await detail(employee,'Fazendo');
 assert.equal((await action(employee,'Iniciar serviço',409)).code,'FREELANCE_FUNDING_REQUIRED');
 await waitText(employee,'Financiamento ainda não confirmado.');
 await confirmSimulatedFreelanceFunding(offerId,'browser-payment-'+suffix,15000,owner.uid,worker.uid);
 await detail(employee,'Fazendo');await action(employee,'Iniciar serviço');
 await detail(employee,'Fazendo');await action(employee,'Solicitar conclusão');
 await detail(employer,'Publicados');await action(employer,'Confirmar conclusão');
 await detail(employee,'Histórico');
 await workerPage.screenshot({path:'freelance-browser-evidence/worker-history.png',fullPage:true});
 await button(employee,'Fechar').click();
 await workerPage.locator('#btn-freelance-earnings').click();
 const earnings=workerPage.locator('#freelance-earnings-sheet');
 await waitText(earnings,'Serviço confirmado');
 await waitText(earnings,'Recebido');
 await waitText(earnings,'Não verificado');
 await waitText(earnings,title);
 assert.match(await earnings.innerText(),/150,00/);
 await workerPage.screenshot({path:'freelance-browser-evidence/worker-earnings.png',fullPage:true});
 await button(earnings,'Fechar ganhos em freelas').click();
 await workerPage.locator('#freelance-activity-alerts-trigger').click();
 const bell=workerPage.locator('#freelance-activity-alerts-panel');
 await waitText(bell,'Serviço concluído');await waitText(bell,title);
 await workerPage.screenshot({path:'freelance-browser-evidence/worker-alerts.png',fullPage:true});
 const basis=await db.doc('freelanceOffersV1/'+offerId).collection('financialBasis').get();
 assert.equal(basis.size,1);assert.equal(basis.docs[0].get('confirmedServiceMinor'),15000);
 assert.equal(basis.docs[0].get('settlement'),'not_verified');
 // Navigate through the actual Central Pessoal. Fresh sign-in guarantees the
 // five-minute authentication window without bypassing the server.
 const financialPage=await session(worker,390);
 await financialPage.locator('#header-user-profile-trigger').click();
 await financialPage.getByRole('button',{name:/Movimentações/}).first().click();
 const pix=financialPage.locator('#personal-pix-settings');
 await waitText(pix,'Nenhuma chave cadastrada');
 const key='fixture-'+suffix+'@example.invalid';
 await pix.getByLabel('Tipo de chave').selectOption('email');
 await pix.getByLabel('Chave Pix de teste').fill(key);
 await pix.getByLabel('Confirmo que esta é uma chave fictícia para homologação.').check();
 const declaration=financialPage.waitForResponse(r=>r.url().endsWith('/api/personal-finance/pix')&&r.request().method()==='POST');
 await button(pix,'Declarar chave').click();
 const declared=await declaration;assert.equal(declared.status(),200);
 await waitText(pix,'Chave de teste declarada. Titularidade não verificada.');
 assert.equal(await pix.getByLabel('Chave Pix de teste').inputValue(),'');
 assert.ok(!(await pix.innerText()).includes(key));
 await financialPage.screenshot({path:'freelance-browser-evidence/personal-pix-masked.png',fullPage:true});
 const financeRefreshId='browser-finance-refresh-'+suffix;
 const financeRefreshRef=db.doc('hub/renda/deliveries/'+financeRefreshId);
 assert.equal(await financialPage.evaluate(()=>{
  const panel=document.getElementById('personal-pix-settings'),card=document.getElementById('btn-fazer-freela');
  if(!panel||!card)return false;window.__pixRefreshWitness={panel,card};return true;
 }),true);
 await financeRefreshRef.set({id:financeRefreshId,source:'kyrub-order',sourceOrderId:'fictional-'+suffix,status:'available',from:'Origem fictícia',to:'Destino fictício',distance:1,payment:1,requestedBy:'Teste isolado'});
 await financialPage.waitForFunction(id=>(JSON.parse(localStorage.getItem('kyrub_deliveries')??'[]')).some(x=>x.id===id),financeRefreshId,{timeout:20000});
 assert.equal(await financialPage.evaluate(()=>window.__pixRefreshWitness.panel===document.getElementById('personal-pix-settings')&&window.__pixRefreshWitness.card.isConnected),true);
 await financeRefreshRef.delete();
 await financialPage.waitForFunction(id=>!(JSON.parse(localStorage.getItem('kyrub_deliveries')??'[]')).some(x=>x.id===id),financeRefreshId,{timeout:20000});
 const second=await session(worker,1365);
 await second.locator('#header-user-profile-trigger').click();
 await second.getByRole('button',{name:/Movimentações/}).first().click();
 const secondPix=second.locator('#personal-pix-settings');
 await waitText(secondPix,'Chave declarada: E-mail');
 await button(secondPix,'Revogar chave').click();
 await secondPix.getByLabel('Confirmo a revogação da chave cadastrada.').check();
 await button(secondPix,'Confirmar revogação').click();
 await waitText(secondPix,'Revogação confirmada pelo servidor.');
 await button(pix,'Atualizar cadastro').click();await waitText(pix,'Chave revogada');
 await financialPage.getByRole('button',{name:/Movimentações/}).first().click();
 await financialPage.waitForFunction(()=>!window.__pixRefreshWitness.card.isConnected&&!!document.getElementById('btn-fazer-freela'),undefined,{timeout:20000});
 await financialPage.evaluate(()=>{delete window.__pixRefreshWitness;});
 console.log('PASS deferred cache refresh: original Pix panel retained while open, legacy refresh applied after close');
 assert.equal((await db.doc('financialProfilesV1/'+worker.uid+'/receiving/externalPix').get()).get('key'),undefined);
 console.log('PASS personal Pix UI: Central Pessoal, masked declaration and revocation across two contexts');
 // Provision only virgin stock. Register and link with the real lifecycle,
 // real ES256 signatures and test authenticator data, in this same emulator.
 const cidId=randomUUID().replaceAll('-',''),cidRef=db.doc('kyrub_official_tags/'+cidId);
 const cidKey='cid-'+suffix+'@example.invalid';
 const {makeSoftwareTagAuthenticator}=await import('./fixtures/kyrub-tag-software-authenticator.ts');
 const {beginTagPasskeyMutation:begin,finishTagPasskeyMutation:finish}=await import('../server/identity/kyrubTagPasskeyLifecycle.ts');
 const {cidFinanceIntegratedTestEnabled,CID_FINANCE_TEST_ORIGIN}=await import('../server/identity/kyrubTagPilotIsolation.ts');
 assert.equal(cidFinanceIntegratedTestEnabled(),false,'test seam disabled by default');
 process.env.KYRUB_CID_FINANCE_INTEGRATED_TEST='true';
 const rp=new URL(CID_FINANCE_TEST_ORIGIN).hostname;
 const authenticator=makeSoftwareTagAuthenticator(CID_FINANCE_TEST_ORIGIN,rp);
 const finder=makeSoftwareTagAuthenticator(CID_FINANCE_TEST_ORIGIN,rp);
 const card={name:'CID fictício',occupation:'',about:'',pix:{keyType:'email',key:cidKey,recipientName:'Pessoa Teste',recipientCity:'BRASILIA',publicConsent:true}};
 await cidRef.create({distribution:'promotional',model:'adesivo',manufacturingState:'released',ownerId:null,activationHash:null,reservedEmailHash:null,enabled:false,blocked:false,targets:[],externalUrls:[],presentation:{name:'',occupation:'',about:''}});
 try{
  assert.equal(cidFinanceIntegratedTestEnabled(),true);
  await assert.rejects(begin('https://other.vercel.app',cidId,'register',card));
  const registration=await begin(CID_FINANCE_TEST_ORIGIN,cidId,'register',card);
  await finish(CID_FINANCE_TEST_ORIGIN,cidId,registration.challengeId,authenticator.register(registration.options));
  const registered=(await cidRef.get()).data();
  assert.equal(registered.ownerAuthMode,'passkey');assert.equal(registered.presentation.pix.key,cidKey);
  assert.equal(registered.linkedAccountId,undefined);
  await button(secondPix,'Atualizar cadastro').click();
  await secondPix.getByRole('button',{name:'Atualizar cadastro',exact:true}).waitFor();
  await waitText(secondPix,'Chave revogada');
  await secondPix.getByRole('radio').waitFor({state:'detached'});
  const idToken=await second.evaluate(async()=>{
   const {auth}=await import('/src/utils/firebase.ts');
   return auth.currentUser.getIdToken();
  });
  const verified=await auth.verifyIdToken(idToken,true);
  assert.equal(verified.uid,worker.uid);assert.equal(verified.email_verified,true);
  const link=await begin(CID_FINANCE_TEST_ORIGIN,cidId,'link-account',undefined,undefined,verified.uid);
  await assert.rejects(finish(CID_FINANCE_TEST_ORIGIN,cidId,link.challengeId,finder.assert(link.options,{credentialId:authenticator.id,handle:authenticator.handle}),undefined,verified.uid));
  assert.equal((await cidRef.get()).get('linkedAccountId'),undefined);
  await finish(CID_FINANCE_TEST_ORIGIN,cidId,link.challengeId,authenticator.assert(link.options),undefined,verified.uid);
  assert.equal((await cidRef.get()).get('linkedAccountId'),worker.uid);
  console.log('PASS actual signed CID activation and link: virgin stock, wrong RP and foreign signature rejected, verified account UID');
  await button(secondPix,'Atualizar cadastro').click();
  await waitText(secondPix,'Chaves Pix dos meus CIDs');
  await secondPix.getByRole('radio').check();
  assert.equal(await button(secondPix,'Utilizar chave Pix do meu CID').isDisabled(),true);
  await secondPix.getByLabel('Confirmo o uso financeiro da chave fictícia deste CID.').check();
  const imported=second.waitForResponse(r=>r.url().endsWith('/api/personal-finance/pix')&&r.request().method()==='POST');
  await button(secondPix,'Utilizar chave Pix do meu CID').click();
  const response=await imported;assert.equal(response.status(),200,await response.text());
  await waitText(secondPix,'Chave Pix do CID aproveitada. Titularidade não verificada.');
  assert.ok(!(await secondPix.innerText()).includes(cidKey));
  const financialRef=db.doc('financialProfilesV1/'+worker.uid+'/receiving/externalPix');
  assert.equal((await financialRef.get()).get('key'),cidKey);
  await second.screenshot({path:'freelance-browser-evidence/personal-cid-pix-import.png',fullPage:true});
  await secondPix.getByRole('radio').check();
  assert.equal(await button(secondPix,'Substituir pela chave do CID').isDisabled(),true);
  await button(secondPix,'Cancelar escolha do CID').click();
  assert.equal((await financialRef.get()).get('revision'),3);
  const removal=await begin(CID_FINANCE_TEST_ORIGIN,cidId,'edit',{...card,pix:null});
  await finish(CID_FINANCE_TEST_ORIGIN,cidId,removal.challengeId,authenticator.assert(removal.options));
  assert.equal((await cidRef.get()).get('presentation.pix'),null);
  await button(secondPix,'Atualizar cadastro').click();
  await waitText(secondPix,'Chave declarada: E-mail');
  await secondPix.getByRole('radio').waitFor({state:'detached'});
  assert.equal((await financialRef.get()).get('key'),cidKey);
  console.log('PASS CID Pix UI: masked linked choice, separate confirmation, import without retyping, explicit replacement and independent destination');
 }finally{delete process.env.KYRUB_CID_FINANCE_INTEGRATED_TEST;await cidRef.delete();}
 // Direct publication is intentionally disabled in public transport; create an isolated
 // contract using real lifecycle services, then exercise financial actions through UI.
 const {publishFreelanceOffer,applyToFreelanceOffer,selectFreelanceApplication,confirmFreelanceContract}=await import('../server/freelance/freelanceLifecycleService.ts');
 const {createDirectPaymentTerms}=await import('../shared/directPaymentTerms.ts');
 const {receiptFixture}=await import('./fixtures/freelance-receipt-fixture.ts');
 const fp=await account('finance-payer','requester','Pagador teste'),fw=await account('finance-worker','freelancer','Recebedor teste');
 const directId='browser-direct-'+suffix,directTitle='Freela financeiro '+suffix;
 await publishFreelanceOffer(fp.uid,directId,{title:directTitle,description:'Contrato direto fictício',requirements:'',paymentMinor:15000,paymentTerms:createDirectPaymentTerms({method:'external_pix',timing:'advance',amountMinor:15000})});
 await applyToFreelanceOffer(fw.uid,directId);await selectFreelanceApplication(fp.uid,directId,fw.uid);await confirmFreelanceContract(fw.uid,directId,true);
 const payerPage=await session(fp,1365),receiverPage=await session(fw,390);
 async function finance(page,role){
  const modal=await open(page,role);
  await button(modal,role==='owner'?'Publicados':'Fazendo').click();await button(modal,'Atualizar consulta').click();
  const article=modal.locator('article').filter({has:page.getByRole('heading',{name:directTitle,exact:true})}).first();
  await button(article,'Ver detalhes').click();
  const panel=modal.getByRole('region',{name:'Financeiro do Freela'});
  await button(panel,'Consultar situação financeira').click();await waitText(panel,'Aguardando pagamento');return panel;
 }
 const payerPanel=await finance(payerPage,'owner'),receiverPanel=await finance(receiverPage,'worker');
 async function financialAction(panel,label){
  await button(panel,label).click();
  const result=panel.page().waitForResponse(r=>r.url().endsWith('/api/freelance/finance')&&r.request().method()==='POST');
  await button(panel,'Confirmar manifestação').click();
  const response=await result;assert.equal(response.status(),200,await response.text());
  await waitText(panel,'Manifestação registrada pelo servidor.');
 }
 await financialAction(receiverPanel,'Informar não recebimento');
 await financialAction(payerPanel,'Informar pagamento');await waitText(payerPanel,'Novas contratações temporariamente indisponíveis');
 await button(receiverPanel,'Consultar situação financeira').click();await waitText(receiverPanel,'Divergência financeira');
 await financialAction(receiverPanel,'Solicitar análise administrativa');await waitText(receiverPanel,'Análise administrativa solicitada');
 await receiverPanel.getByLabel('Manifestação complementar').fill('Relato fictício do não recebimento.');
 await financialAction(receiverPanel,'Enviar manifestação');
 await waitText(receiverPanel,'Relato fictício do não recebimento.');
 await receiverPanel.getByLabel('Comprovante fictício PNG (até 256 KiB)').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:Buffer.from(receiptFixture(),'base64')});
 await financialAction(receiverPanel,'Enviar comprovante');await waitText(receiverPanel,'Comprovante privado registrado.');
 await receiverPage.screenshot({path:'freelance-browser-evidence/financial-dispute.png',fullPage:true});
 await button(payerPanel,'Consultar situação financeira').click();await waitText(payerPanel,'Análise administrativa solicitada');
 assert.ok(!(await payerPanel.innerText()).includes('Relato fictício do não recebimento.'));
 await financialAction(receiverPanel,'Confirmar recebimento');await waitText(receiverPanel,'Regularização voluntária registrada');
 await button(payerPanel,'Consultar situação financeira').click();await waitText(payerPanel,'Recebimento confirmado pelas partes');
 for(const a of [fp,fw])assert.deepEqual((await db.doc('freelanceEngagementRestrictionsV1/'+a.uid).get()).get('openOfferIds'),[]);
 for(const page of [payerPage,receiverPage]){
  const modal=page.getByRole('dialog',{name:page===payerPage?'Solicitar Freelas':'Fazer Freelas',exact:true});
  await button(modal,'Fechar').click();
  const response=page.waitForResponse(r=>r.url().includes('/api/notifications?limit=')&&r.request().method()==='GET');
  await page.locator('#canonical-notification-trigger').click();
  const panel=page.locator('#canonical-notification-center');
  const inbox=await response;assert.equal(inbox.status(),200,await inbox.text());
  await waitText(panel,'Divergência financeira em Freelas');await waitText(panel,'Regularização financeira em Freelas');
  assert.ok(!(await panel.innerText()).includes('Relato fictício do não recebimento.'));
  await page.screenshot({path:'freelance-browser-evidence/financial-notices-'+(page===payerPage?'payer':'worker')+'.png',fullPage:true});
 }
 for(const page of [payerPage,receiverPage]){
  await page.locator('#canonical-notification-trigger').click();
  await page.locator('#header-user-profile-trigger').click();
  await page.getByRole('button',{name:/Movimentações/}).first().click();
  const movements=page.locator('#freela-movements');
  await movements.waitFor({state:'visible'});
  if(page===payerPage)await button(movements,'Como contratante').click();
  await waitText(movements,directTitle);await waitText(movements,'Recebimento confirmado pelas partes');
  await waitText(movements,'Não verificada');
  await page.screenshot({path:'freelance-browser-evidence/financial-movements-'+(page===payerPage?'payer':'worker')+'.png',fullPage:true});
 }
 console.log('PASS direct financial UI: two authenticated contexts, reverse-order dispute, private note/PNG, voluntary release, global bell notices and Central Pessoal movements');
 const adminActor=await account('financial-admin','requester','Administrador fictício');
 await db.doc('kyrub_admin/control_plane/admins/'+adminActor.uid).set({uid:adminActor.uid,email:adminActor.uid+'@example.invalid',role:'super_admin',status:'active'});
 const adminPage=await session(adminActor,1365);
 await adminPage.goto(origin+'/admin',{waitUntil:'domcontentloaded'});
 const section=adminPage.locator('#admin-freelance-financial-review');
 await section.locator('summary').click({timeout:30000});
 const adminPanel=section.locator('#admin-freelance-financial-review-workspace');
 await button(adminPanel,'Consultar divergências').click();
 await waitText(adminPanel,'Entre com autenticação multifator');
 // UI-only fixture: real endpoint denied without genuine MFA above. Do not
 // forge claims or alter server authorization to demonstrate rendering.
 const {sanitizeReceiptPng}=await import('../server/freelance/freelanceReceiptPng.ts');
 const png=sanitizeReceiptPng(receiptFixture()),now=new Date().toISOString();
 const item={offerId:directId,title:directTitle,amountMinor:15000,currency:'BRL',timing:'advance',requestedAt:now,requestedByRole:'freelancer',requesterUid:fp.uid,beneficiaryUid:fw.uid,restrictionActive:true,bankVerified:false,settlementEvidence:'participant_statements_only',statements:[{role:'requester',statement:'paid',recordedAt:now},{role:'freelancer',statement:'not_received',recordedAt:now}],evidenceRevision:2,evidenceNotes:[{role:'freelancer',note:'Nota privada fictícia.',recordedAt:now}],receipts:[{id:'fixture-png',role:'requester',recordedAt:now,size:png.bytes.length,mimeType:'image/png'}]};
 let posts=0;
 await adminPage.route('**/api/admin/freelance-financial-review**',async route=>{
  const req=route.request(),u=new URL(req.url());
  if(req.method()==='POST'){
   const b=req.postDataJSON();assert.equal(b.offerId,directId);assert.equal(b.expectedEvidenceRevision,2);assert.equal(b.expectedRequestedAt,now);assert.equal(b.confirmed,true);assert.equal(b.outcome,'inconclusive');
   posts++;await route.fulfill({status:posts===1?409:200,json:posts===1?{code:'FREELANCE_FINANCIAL_REVIEW_CONFLICT'}:{status:'resolved_administratively',outcome:'inconclusive',replay:false,bankVerified:false}});return;
  }
  await route.fulfill({status:200,json:u.searchParams.get('view')==='receipt'?{id:'fixture-png',mimeType:'image/png',pngBase64:png.bytes.toString('base64'),bankVerified:false}:{items:[item],nextCursor:null}});
 });
 async function prepareDecision(){
  await button(adminPanel,'Consultar divergências').click();await button(adminPanel,'Analisar divergência').click();
  await waitText(adminPanel,'Nota privada fictícia.');
  await adminPanel.getByLabel('Resultado da análise').selectOption('inconclusive');await adminPanel.getByLabel('Fundamentação').fill('Evidência fictícia insuficiente para concluir.');
  await adminPanel.getByLabel('Confirmo a decisão fundamentada e a liberação das restrições deste protocolo.').check();
  assert.equal(await button(adminPanel,'Registrar decisão financeira').isDisabled(),true);
  await button(adminPanel,'Visualizar comprovante de contratante').click();await waitText(adminPanel,'Visualizado');
  await adminPanel.getByLabel('Confirmo a decisão fundamentada e a liberação das restrições deste protocolo.').check();
  await button(adminPanel,'Registrar decisão financeira').click();
 }
 await prepareDecision();await waitText(adminPanel,'Consulte novamente antes de decidir');
 await prepareDecision();await waitText(adminPanel,'Decisão administrativa registrada.');
 assert.equal(posts,2);
 await adminPage.screenshot({path:'freelance-browser-evidence/admin-financial-review.png',fullPage:true});
 console.log('PASS admin financial UI: actual MFA denial; isolated intercepted fixture for receipt preview, stale revision and confirmation; no real decision from UI');
 assert.deepEqual(forbidden,[]);assert.deepEqual(uncaught,[]);
 console.log('PASS: two authenticated Chromium contexts, actual UI publication to completion, funding denial, earnings and bell');
}catch(e){
 for(const [i,context] of browser.contexts().entries())for(const page of context.pages()){
  await page.screenshot({path:'freelance-browser-evidence/failure-'+i+'.png',fullPage:true}).catch(()=>{});
 }
 console.error('Browser isolation diagnostics:',JSON.stringify({forbidden,uncaught}));
 throw e;
}finally{await browser.close();await db.terminate();}
