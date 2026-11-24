// Full Kyrub entrypoint + native Conectados UI, with only local test identities.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';

const project='kyrub-security-test',origin='http://127.0.0.1:3000';
assert.equal(process.env.FIREBASE_PROJECT_ID,project);
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8088');
assert.equal(process.env.KYRUB_RESERVED_TRIBE_PILOT,'true');
assert.equal(process.env.KYRUB_RESERVED_TRIBE_NOTIFICATION_E2E,'true');
assert.ok(!process.env.FIREBASE_SERVICE_ACCOUNT_JSON&&!process.env.GOOGLE_APPLICATION_CREDENTIALS&&!process.env.VERCEL&&!process.env.VERCEL_ENV);
const app=initializeApp({projectId:project},'reserved-tribe-ui-browser');
const db=getFirestore(app),admin=getAuth(app);
const owner='ui-tribe-owner',peer='ui-tribe-peer',pair=[owner,peer].sort().join('_');
const ownerName='Pessoa Titular Teste',peerName='Pessoa Contato Teste';
const password='fictional-ui-login-123',code='fictional-ui-code';
const message='Mensagem privada de homologacao';
const newCode='fictional-recovery-code',privateNotice='Aviso reservado de homologacao',systemNotice='Aviso de sistema de homologacao';
const noticePath='users/'+owner+'/notifications/';
let browser;
const blockedFirebase=[];
async function open(uid){
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 let statusGate=null;
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if([origin,'http://127.0.0.1:9099','http://127.0.0.1:8088','http://127.0.0.1:9199'].includes(url.origin)){
   const gate=statusGate;
   if(gate&&url.origin===origin&&url.pathname==='/api/social/reserved-tribe'&&route.request().postDataJSON()?.action==='status'){
    gate.observe();await gate.wait;
   }
   return route.continue();
  }
  if(/(^|\.)(firebaseio\.com|firebaseapp\.com|firebasestorage\.app)$/.test(url.hostname)||['identitytoolkit.googleapis.com','securetoken.googleapis.com','firestore.googleapis.com','firebasestorage.googleapis.com'].includes(url.hostname))blockedFirebase.push(url.origin);
  return route.abort();
 });
 const page=await context.newPage();
 // Record only action names/status; never print request/response bodies, secrets or tokens.
 const allowedActions=new Set(['status','setup','unlock','directory','reserved-directory','membership','session-check','lock','chat-read','chat-send','chat-clear','ordinary-chat-read','notifications','notification-read','recover']);
 page.on('response',response=>{
  if(new URL(response.url()).pathname!=='/api/social/reserved-tribe')return;
  try{const action=response.request().postDataJSON()?.action;if(allowedActions.has(action))console.log('UI pilot action:',action,response.status());}catch{/* No raw payload diagnostics. */}
 });
 await page.goto(origin+'/tests/fixtures/reserved-tribe-browser.html');
 await page.waitForFunction(()=>window.fixture?.enabled()===true);
 assert.equal(await page.evaluate(credentials=>window.fixture.signInForApp(credentials),{email:uid+'@example.invalid',password}),uid);
 await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(async expected=>{
  const {auth}=await import('/src/utils/firebase.ts');
  return auth.app.options.projectId==='kyrub-security-test'&&auth.currentUser?.uid===expected;
 },uid);
 await page.locator('#header-user-profile-trigger').waitFor({state:'visible',timeout:30000});
 // Use the real app's established navigation event, not a synthetic panel mount.
 await page.evaluate(()=>window.dispatchEvent(new Event('kyrub:open-connections')));
 const panel=page.locator('[data-reserved-tribe-pilot="true"]');
 await panel.waitFor({state:'visible',timeout:30000});
 return {page,panel,holdStatus(){
  assert.equal(statusGate,null);
  let observe,release;
  const observed=new Promise(resolve=>{observe=resolve});
  const wait=new Promise(resolve=>{release=resolve});
  statusGate={observe,wait};
  return {observed,release:()=>{statusGate=null;release();}};
 }};
}
async function visible(locator){await locator.waitFor({state:'visible',timeout:20000});}
async function absent(locator){await locator.waitFor({state:'detached',timeout:20000});}
async function unlock(panel,secret=code){
 const search=panel.getByLabel('Pesquisar pessoas em Conectados');
 await visible(search);
 await search.fill('!');
 assert.equal(await search.getAttribute('type'),'password');
 await search.fill(secret);
 await search.press('Enter');
 await visible(panel.getByRole('region',{name:'Tribo Reservada'}));
 assert.equal(await search.count(),0);
}
try{
 for(const [uid,name] of [[owner,ownerName],[peer,peerName]]){
  await admin.createUser({uid,email:uid+'@example.invalid',password,emailVerified:true,displayName:name});
  await db.doc('users/'+uid).set({uid,name,email:uid+'@example.invalid',photoUrl:'',isProfileVisible:true,createdAt:new Date(),updatedAt:new Date()});
 }
 await db.doc('connections/'+pair).set({senderId:owner,receiverId:peer,participantIds:[owner,peer].sort(),status:'accepted',senderName:ownerName,receiverName:peerName});
 const notification=(id,category,title)=>({schemaVersion:1,id,recipientUserId:owner,category,eventType:'received',sourceId:id,actorPrincipalId:peer,title,body:'Conteudo ficticio',target:{kind:'none',storeId:'',customerId:'',orderId:''},createdAt:new Date().toISOString(),readAt:''});
 await Promise.all([db.doc(noticePath+'private-fixture').set(notification('private-fixture','user_forward',privateNotice)),db.doc(noticePath+'system-fixture').set(notification('system-fixture','system',systemNotice))]);
 browser=await chromium.launch({headless:true});
 const a=await open(owner);
 await visible(a.panel.getByText(peerName,{exact:true}));
 await a.panel.getByRole('button',{name:'Apresentação',exact:true}).click();
 const card=a.page.getByRole('dialog',{name:'Cartão de apresentação'});
 await visible(card.getByRole('heading',{name:peerName,exact:true}));
 await visible(card.getByRole('button',{name:'Abrir chat',exact:true}));
 await card.getByRole('button',{name:'Fechar apresentação'}).click();
 await absent(card);
 await a.panel.getByRole('button',{name:'Tribos',exact:true}).click();
 await a.panel.getByRole('button',{name:'Configurar código reservado'}).click();
 await a.panel.getByLabel('Novo código',{exact:true}).fill(code);
 await a.panel.getByLabel('Confirmar código',{exact:true}).fill(code);
 await a.panel.getByRole('button',{name:'Salvar código'}).click();
 await visible(a.panel.getByRole('button',{name:'Redefinir código de acesso'}));
 await unlock(a.panel);
 a.page.once('dialog',dialog=>dialog.accept());
 await a.panel.getByRole('button',{name:peerName,exact:true}).click();
 await absent(a.panel.getByRole('region',{name:'Tribo Reservada'}));
 await a.panel.getByRole('button',{name:'Geral',exact:true}).click();
 await absent(a.panel.getByText(peerName,{exact:true}));
 await absent(a.panel.getByRole('button',{name:'Apresentação',exact:true}));
 assert.deepEqual(await a.page.evaluate(async target=>{const {requestReservedTribePilot}=await import('/src/utils/reservedTribePilotClient.ts');return requestReservedTribePilot('contact-presentation',{peerId:target});},peer),{presentation:null});
 console.log('PASS native contact presentation opens before reservation, reserved contact card denied afterward');
 await unlock(a.panel);
 await visible(a.panel.getByText(peerName,{exact:true}));
 await a.panel.getByRole('button',{name:'Conversar',exact:true}).click();
 await visible(a.panel.getByRole('log',{name:'Mensagens'}));
 await a.panel.getByLabel('Mensagem',{exact:true}).fill(message);
 await a.panel.getByRole('button',{name:'Enviar',exact:true}).click();
 await visible(a.panel.getByText(message,{exact:true}));
 a.page.once('dialog',dialog=>dialog.accept());
 await a.panel.getByRole('button',{name:'Excluir conversa'}).click();
 await visible(a.panel.getByText('Nenhuma mensagem.',{exact:true}));
 await absent(a.panel.getByText(message,{exact:true}));
 assert.equal((await db.collection('social_chats/'+pair+'/messages').get()).size,1);
 await a.panel.getByRole('button',{name:'Trancar',exact:true}).click();
 await absent(a.panel.getByRole('region',{name:'Tribo Reservada'}));
 await absent(a.panel.getByText(peerName,{exact:true}));
 console.log('PASS native UI setup, masked unlock, reserve, send, own history clear and lock');
 const b=await open(peer);
 await visible(b.panel.getByText(ownerName,{exact:true}));
 await b.panel.getByRole('button',{name:'Apresentação',exact:true}).click();
 const otherCard=b.page.getByRole('dialog',{name:'Cartão de apresentação'});
 await visible(otherCard.getByRole('heading',{name:ownerName,exact:true}));
 await visible(otherCard.getByRole('button',{name:'Abrir chat',exact:true}));
 await otherCard.getByRole('button',{name:'Fechar apresentação'}).click();
 await absent(otherCard);
 await b.panel.getByRole('button',{name:'Conversar',exact:true}).click();
 await visible(b.panel.getByText(message,{exact:true}));
 console.log('PASS counterpart still sees shared conversation');
 await a.page.bringToFront();
 await unlock(a.panel);
 await visible(a.panel.getByText(peerName,{exact:true}));
 await a.page.context().setOffline(true);
 await absent(a.panel.getByRole('region',{name:'Tribo Reservada'}));
 await absent(a.panel.getByText(peerName,{exact:true}));
 await a.page.context().setOffline(false);
 await visible(a.panel.getByLabel('Pesquisar pessoas em Conectados'));
 await a.panel.getByRole('button',{name:'Tribos',exact:true}).click();
 await visible(a.panel.getByRole('button',{name:'Redefinir código de acesso'}));
 await absent(a.panel.getByRole('region',{name:'Tribo Reservada'}));
 assert.equal((await db.doc('connections/'+pair).get()).get('status'),'accepted');
 assert.deepEqual(blockedFirebase,[],'No browser request to remote Firebase');
 console.log('PASS actual app offline closes reserved surface without deleting shared relationship');
 // Use the actual header bell and inbox API with emulator-verified identity.
 assert.equal((await a.page.request.get(origin+'/api/notifications')).status(),401);
 await a.page.getByRole('button',{name:'Fechar meu perfil',exact:true}).click();
 await absent(a.panel);
 const bell=a.page.locator('#canonical-notification-trigger');
 await visible(bell);
 await bell.click();
 const inbox=a.page.getByRole('dialog',{name:'Central de notificações'});
 await visible(inbox.getByText(systemNotice,{exact:true}));
 await absent(inbox.getByText(privateNotice,{exact:true}));
 assert.equal(await bell.getAttribute('aria-label'),'Notificações, 1 não lidas, 0 solicitações pendentes');
 await inbox.getByRole('button',{name:'Marcar todas como lidas'}).click();
 await visible(inbox.getByText('Tudo lido',{exact:true}));
 assert.ok((await db.doc(noticePath+'system-fixture').get()).get('readAt'));
 assert.equal((await db.doc(noticePath+'private-fixture').get()).get('readAt'),'');
 // The integrated bell also displays incoming ordinary connections from the
 // authorized projection, even for an owner with a protected directory.
 const incoming='ui-tribe-bell-sender',incomingName='Pessoa Solicitação Teste';
 await admin.createUser({uid:incoming,email:incoming+'@example.invalid',password,emailVerified:true,displayName:incomingName});
 await db.doc('users/'+incoming).set({uid:incoming,name:incomingName,email:incoming+'@example.invalid',photoUrl:'',isProfileVisible:true,createdAt:new Date(),updatedAt:new Date()});
 const incomingPair=[owner,incoming].sort().join('_'),incomingRef=db.doc('connections/'+incomingPair);
 await db.runTransaction(async tx=>{
  tx.create(incomingRef,{senderId:incoming,receiverId:owner,participantIds:[owner,incoming].sort(),status:'pending',senderName:incomingName,receiverName:ownerName});
  for(const uid of [owner,incoming])tx.set(db.doc('social_directory_revisions/'+uid),{revision:FieldValue.increment(1)},{merge:true});
 });
 const requests=inbox.getByRole('region',{name:'Solicitações de conexão'});
 await visible(requests.getByText(incomingName+' deseja conectar-se com você.',{exact:true}));
 await absent(requests.getByText(peerName+' deseja conectar-se com você.',{exact:true}));
 assert.equal(await bell.getAttribute('aria-label'),'Notificações, 0 não lidas, 1 solicitações pendentes');
 await requests.getByRole('button',{name:'Aceitar',exact:true}).click();
 await absent(requests);
 assert.equal((await incomingRef.get()).get('status'),'accepted');
 assert.equal(await bell.getAttribute('aria-label'),'Notificações, 0 não lidas, 0 solicitações pendentes');
 assert.equal((await db.doc(noticePath+'private-fixture').get()).get('readAt'),'');
 await inbox.getByRole('button',{name:'Fechar notificações'}).click();
 // Remove the synthetic extra connection through the same authenticated API,
 // leaving the original reserved fixture and history untouched.
 assert.deepEqual(await a.page.evaluate(async target=>{
  const {requestReservedTribePilot}=await import('/src/utils/reservedTribePilotClient.ts');
  return requestReservedTribePilot('connection',{peerId:target,operation:'remove'});
 },incoming),{status:'none'});
 assert.equal((await incomingRef.get()).exists,false);
 console.log('PASS integrated general bell accepts ordinary request through authorized pilot without exposing private notices');
 // Hold status responses while reopening the actual panel. No secret may
 // enter an ordinary search before the server confirms configuration.
 const hold=a.holdStatus();
 let timer;
 try{
  await a.page.evaluate(()=>window.dispatchEvent(new Event('kyrub:open-connections')));
  await visible(a.panel);
  await Promise.race([hold.observed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('STATUS_REQUEST_NOT_OBSERVED')),10000);})]);
  await visible(a.panel.getByRole('status').filter({hasText:'Conectados indisponíveis enquanto a consulta não for confirmada.'}));
  assert.equal(await a.panel.getByLabel('Pesquisar pessoas em Conectados').count(),0);
 }finally{clearTimeout(timer);hold.release();}
 await visible(a.panel.getByLabel('Pesquisar pessoas em Conectados'));
 console.log('PASS reopened panel with delayed status never exposes premature ordinary search');
 console.log('PASS general bell hides private notice and read-all only marks ordinary inbox');
 // Notifications remain unread until a private session explicitly marks them.
 assert.equal((await db.doc(noticePath+'private-fixture').get()).get('readAt'),'');
 await unlock(a.panel);
 await a.panel.getByRole('button',{name:'Avisos',exact:true}).click();
 await visible(a.panel.getByText(privateNotice,{exact:true}));
 await absent(a.panel.getByText(systemNotice,{exact:true}));
 await a.panel.getByRole('button',{name:'Marcar como lida',exact:true}).click();
 await absent(a.panel.getByRole('button',{name:'Marcar como lida',exact:true}));
 assert.ok((await db.doc(noticePath+'private-fixture').get()).get('readAt'));
 assert.ok((await db.doc(noticePath+'system-fixture').get()).get('readAt'));
 await a.panel.getByRole('button',{name:'Trancar',exact:true}).click();
 await absent(a.panel.getByText(privateNotice,{exact:true}));
 console.log('PASS private notification displayed and read only in reserved UI');
 // Recover through actual Firebase reauthentication; no old code requested.
 await a.panel.getByRole('button',{name:'Tribos',exact:true}).click();
 await a.panel.getByRole('button',{name:'Redefinir código de acesso',exact:true}).click();
 const recovery=a.panel.getByRole('region',{name:'Redefinir código de acesso'});
 await visible(recovery);
 await recovery.getByLabel('Senha da conta').fill('wrong-fixture-password');
 await recovery.getByRole('button',{name:'Confirmar identidade'}).click();
 await visible(recovery.getByRole('alert'));
 assert.equal(await recovery.getByLabel('Novo código',{exact:true}).count(),0);
 await recovery.getByLabel('Senha da conta').fill(password);
 await recovery.getByRole('button',{name:'Confirmar identidade'}).click();
 await visible(recovery.getByLabel('Novo código',{exact:true}));
 await recovery.getByLabel('Novo código',{exact:true}).fill(newCode);
 await recovery.getByLabel('Confirmar código',{exact:true}).fill(newCode);
 await recovery.getByRole('button',{name:'Salvar novo código'}).click();
 await absent(recovery);
 await visible(a.panel.getByRole('button',{name:'Redefinir código de acesso'}));
 const oldSearch=a.panel.getByLabel('Pesquisar pessoas em Conectados');
 await oldSearch.fill('!');
 await oldSearch.fill(code);
 const oldAttempt=a.page.waitForResponse(response=>new URL(response.url()).pathname==='/api/social/reserved-tribe'&&response.request().postDataJSON()?.action==='unlock');
 await oldSearch.press('Enter');
 assert.equal((await oldAttempt).status(),200);
 await a.page.waitForFunction(()=>document.querySelector('[data-reserved-tribe-pilot] input[aria-label="Pesquisar pessoas em Conectados"]')?.type==='search');
 await absent(a.panel.getByRole('region',{name:'Tribo Reservada'}));
 await unlock(a.panel,newCode);
 await visible(a.panel.getByText(peerName,{exact:true}));
 await a.panel.getByRole('button',{name:'Conversar',exact:true}).click();
 await visible(a.panel.getByText('Nenhuma mensagem.',{exact:true}));
 await a.panel.getByRole('button',{name:'Trancar',exact:true}).click();
 await absent(a.panel.getByRole('region',{name:'Tribo Reservada'}));
 assert.equal((await db.doc('connections/'+pair).get()).get('status'),'accepted');
 assert.equal((await db.collection('social_chats/'+pair+'/messages').get()).size,1);
 assert.ok((await db.doc(noticePath+'private-fixture').get()).get('readAt'));
 assert.deepEqual(blockedFirebase,[]);
 console.log('PASS password reauthentication, wrong password denied, old code denied, new code works and shared history preserved');
 // Independent contexts share neither BroadcastChannel nor browser storage.
 // Do not focus the second page: the first must remain visible so this tests
 // server polling, rather than the existing visibility-change lock.
 await unlock(a.panel,newCode);
 await visible(a.panel.getByText(peerName,{exact:true}));
 await a.page.evaluate(()=>{
  if(document.hidden)throw Error('OWNER_DOCUMENT_NOT_VISIBLE');
  window.__fixtureVisibilityChanges=0;
  document.addEventListener('visibilitychange',()=>window.__fixtureVisibilityChanges++);
 });
 const block=db.doc('social_contact_blocks/'+peer+'/blocked/'+owner);
 const revisionRefs=[owner,peer].map(uid=>db.doc('social_directory_revisions/'+uid));
 const applyBlock=async blocked=>db.runTransaction(async tx=>{
  await tx.get(block);
  if(blocked)tx.set(block,{targetId:owner});else tx.delete(block);
  // Synthetic emulator-only mutation models the #1273 integration contract.
  // The actual block endpoint is not yet present in this branch.
  for(const ref of revisionRefs)tx.set(ref,{revision:FieldValue.increment(1)},{merge:true});
 });
 assert.notEqual(a.page.context(),b.page.context());
 await applyBlock(true);
 await absent(a.panel.getByRole('region',{name:'Tribo Reservada'}));
 await absent(a.panel.getByText(peerName,{exact:true}));
 await visible(a.panel.getByLabel('Pesquisar pessoas em Conectados'));
 assert.equal(await a.page.evaluate(()=>window.__fixtureVisibilityChanges),0);
 assert.equal(await a.page.evaluate(()=>document.hidden),false);
 await unlock(a.panel,newCode);
 await absent(a.panel.getByText(peerName,{exact:true}));
 await applyBlock(false);
 await absent(a.panel.getByRole('region',{name:'Tribo Reservada'}));
 await visible(a.panel.getByLabel('Pesquisar pessoas em Conectados'));
 await unlock(a.panel,newCode);
 await visible(a.panel.getByText(peerName,{exact:true}));
 assert.equal(await a.page.evaluate(()=>window.__fixtureVisibilityChanges),0);
 assert.equal((await db.doc('connections/'+pair).get()).get('status'),'accepted');
 console.log('PASS visible reserved panel invalidates after server-side block/unblock revision without a visibility change');
 // Now use the real authenticated ordinary relationship API in B, without
 // invoking a local browser event or writing the relationship from Admin.
 const removed=await b.page.evaluate(async target=>{
  const {requestReservedTribePilot}=await import('/src/utils/reservedTribePilotClient.ts');
  return requestReservedTribePilot('connection',{peerId:target,operation:'remove'});
 },owner);
 assert.deepEqual(removed,{status:'none'});
 await absent(a.panel.getByRole('region',{name:'Tribo Reservada'}));
 await visible(a.panel.getByLabel('Pesquisar pessoas em Conectados'));
 assert.equal(await a.page.evaluate(()=>window.__fixtureVisibilityChanges),0);
 assert.equal(await a.page.evaluate(()=>document.hidden),false);
 await unlock(a.panel,newCode);
 await absent(a.panel.getByText(peerName,{exact:true}));
 assert.equal((await db.doc('connections/'+pair).get()).exists,false);
 assert.equal((await db.collection('social_chats/'+pair+'/messages').get()).size,1);
 assert.ok((await db.doc('reserved_tribe_vaults/'+owner+'/contacts/'+peer).get()).exists);
 assert.deepEqual(blockedFirebase,[]);
 console.log('PASS authenticated removal in independent context closes visible reserved panel and preserves message history and reservation marker');
 // Reset ONLY the synthetic relationship fixture, not the message or marker.
 // This keeps the removal regression above and adds real block HTTP coverage.
 await a.panel.getByRole('button',{name:'Trancar',exact:true}).click();
 await absent(a.panel.getByRole('region',{name:'Tribo Reservada'}));
 await db.runTransaction(async tx=>{
  tx.create(db.doc('connections/'+pair),{senderId:owner,receiverId:peer,participantIds:[owner,peer].sort(),status:'accepted',senderName:ownerName,receiverName:peerName});
  for(const ref of revisionRefs)tx.set(ref,{revision:FieldValue.increment(1)},{merge:true});
 });
 // Reopen after the fixture reset so the initial revision is deterministic.
 await a.page.getByRole('button',{name:'Fechar meu perfil',exact:true}).click();
 await absent(a.panel);
 await a.page.evaluate(()=>window.dispatchEvent(new Event('kyrub:open-connections')));
 await visible(a.panel);
 await unlock(a.panel,newCode);
 await visible(a.panel.getByText(peerName,{exact:true}));
 // An ordinary action cannot expose or mutate the actor's own reserved peer.
 const forbidden=await a.page.evaluate(async target=>{
  const {requestReservedTribePilot}=await import('/src/utils/reservedTribePilotClient.ts');
  try{await requestReservedTribePilot('social-block',{peerId:target,blocked:true});return false;}catch{return true;}
 },peer);
 assert.equal(forbidden,true);
 assert.equal((await db.doc('connections/'+pair).get()).get('status'),'accepted');
 assert.equal((await block.get()).exists,false);
 const before=await Promise.all(revisionRefs.map(ref=>ref.get()));
 const remoteBlock=async blocked=>b.page.evaluate(async fields=>{
  const {requestReservedTribePilot}=await import('/src/utils/reservedTribePilotClient.ts');
  return requestReservedTribePilot('social-block',fields);
 },{peerId:owner,blocked});
 assert.deepEqual(await remoteBlock(true),{blocked:true});
 await absent(a.panel.getByRole('region',{name:'Tribo Reservada'}));
 await visible(a.panel.getByLabel('Pesquisar pessoas em Conectados'));
 assert.equal(await a.page.evaluate(()=>window.__fixtureVisibilityChanges),0);
 assert.equal(await a.page.evaluate(()=>document.hidden),false);
 assert.equal((await db.doc('connections/'+pair).get()).exists,false);
 assert.equal((await block.get()).get('targetId'),owner);
 assert.equal((await db.collection('social_chats/'+pair+'/messages').get()).size,1);
 assert.ok((await db.doc('reserved_tribe_vaults/'+owner+'/contacts/'+peer).get()).exists);
 const afterBlock=await Promise.all(revisionRefs.map(ref=>ref.get()));
 afterBlock.forEach((row,i)=>assert.equal(row.get('revision'),before[i].get('revision')+1));
 await unlock(a.panel,newCode);
 await absent(a.panel.getByText(peerName,{exact:true}));
 assert.deepEqual(await remoteBlock(false),{blocked:false});
 await absent(a.panel.getByRole('region',{name:'Tribo Reservada'}));
 await visible(a.panel.getByLabel('Pesquisar pessoas em Conectados'));
 await unlock(a.panel,newCode);
 await absent(a.panel.getByText(peerName,{exact:true}));
 assert.equal((await block.get()).exists,false);
 assert.equal((await db.doc('connections/'+pair).get()).exists,false);
 assert.equal((await db.collection('social_chats/'+pair+'/messages').get()).size,1);
 const afterUnblock=await Promise.all(revisionRefs.map(ref=>ref.get()));
 afterUnblock.forEach((row,i)=>assert.equal(row.get('revision'),afterBlock[i].get('revision')+1));
 assert.equal(await a.page.evaluate(()=>window.__fixtureVisibilityChanges),0);
 assert.deepEqual(blockedFirebase,[]);
 console.log('PASS real authenticated block/unblock invalidates visible remote panel, preserves history and never recreates connection');
 // Exercise the actual ordinary panel, not a direct API call.
 await db.runTransaction(async tx=>{
  tx.create(db.doc('connections/'+pair),{senderId:owner,receiverId:peer,participantIds:[owner,peer].sort(),status:'accepted',senderName:ownerName,receiverName:peerName});
  for(const ref of revisionRefs)tx.set(ref,{revision:FieldValue.increment(1)},{merge:true});
 });
 await b.page.bringToFront();
 await b.page.getByRole('button',{name:'Fechar meu perfil',exact:true}).click();
 await absent(b.panel);
 await b.page.evaluate(()=>window.dispatchEvent(new Event('kyrub:open-connections')));
 await visible(b.panel);
 await b.panel.getByRole('button',{name:'Geral',exact:true}).click();
 await visible(b.panel.getByText(ownerName,{exact:true}));
 b.page.once('dialog',dialog=>dialog.accept());
 await b.panel.getByRole('button',{name:'Bloquear',exact:true}).click();
 await absent(b.panel.getByText(ownerName,{exact:true}));
 await b.panel.getByRole('button',{name:'Novos',exact:true}).click();
 const blockedList=b.panel.getByRole('region',{name:'Contatos bloqueados'});
 await visible(blockedList.getByText('Contatos bloqueados · 1',{exact:true}));
 await visible(blockedList.getByText(ownerName,{exact:true}));
 await b.panel.getByLabel('Pesquisar pessoas em Conectados').fill(ownerName);
 const searchDone=b.page.waitForResponse(response=>new URL(response.url()).pathname==='/api/social/reserved-tribe'&&response.request().postDataJSON()?.action==='suggestions');
 await b.panel.getByRole('button',{name:'Buscar sugestões',exact:true}).click();
 assert.equal((await searchDone).status(),200);
 assert.equal(await b.panel.getByRole('button',{name:'Conectar',exact:true}).count(),0);
 b.page.once('dialog',dialog=>dialog.accept());
 await blockedList.getByRole('button',{name:'Desbloquear',exact:true}).click();
 await visible(blockedList.getByText('Contatos bloqueados · 0',{exact:true}));
 await absent(blockedList.getByText(ownerName,{exact:true}));
 await b.panel.getByRole('button',{name:'Buscar sugestões',exact:true}).click();
 await visible(b.panel.getByRole('button',{name:'Conectar',exact:true}));
 await b.panel.getByRole('button',{name:'Geral',exact:true}).click();
 await absent(b.panel.getByText(ownerName,{exact:true}));
 assert.equal((await db.doc('connections/'+pair).get()).exists,false);
 assert.equal((await db.collection('social_chats/'+pair+'/messages').get()).size,1);
 assert.deepEqual(blockedFirebase,[]);
 console.log('PASS native ordinary block list, suggestions suppressed while blocked, unblocking does not reconnect');
}finally{
 try{await browser?.close();}finally{await db.terminate();await deleteApp(app);}
}
