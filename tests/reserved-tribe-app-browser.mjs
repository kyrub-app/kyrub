// Full Kyrub entrypoint + native Conectados UI, with only local test identities.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';

const project='kyrub-security-test',origin='http://127.0.0.1:3000';
assert.equal(process.env.FIREBASE_PROJECT_ID,project);
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8088');
assert.equal(process.env.KYRUB_RESERVED_TRIBE_PILOT,'true');
assert.ok(!process.env.FIREBASE_SERVICE_ACCOUNT_JSON&&!process.env.GOOGLE_APPLICATION_CREDENTIALS&&!process.env.VERCEL&&!process.env.VERCEL_ENV);
const app=initializeApp({projectId:project},'reserved-tribe-ui-browser');
const db=getFirestore(app),admin=getAuth(app);
const owner='ui-tribe-owner',peer='ui-tribe-peer',pair=[owner,peer].sort().join('_');
const ownerName='Pessoa Titular Teste',peerName='Pessoa Contato Teste';
const password='fictional-ui-login-123',code='fictional-ui-code';
const message='Mensagem privada de homologacao';
let browser;
const blockedFirebase=[];
async function open(uid){
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());
  if([origin,'http://127.0.0.1:9099','http://127.0.0.1:8088','http://127.0.0.1:9199'].includes(url.origin))return route.continue();
  if(/(^|\.)(firebaseio\.com|firebaseapp\.com|firebasestorage\.app)$/.test(url.hostname)||['identitytoolkit.googleapis.com','securetoken.googleapis.com','firestore.googleapis.com','firebasestorage.googleapis.com'].includes(url.hostname))blockedFirebase.push(url.origin);
  return route.abort();
 });
 const page=await context.newPage();
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
 return {page,panel};
}
async function visible(locator){await locator.waitFor({state:'visible',timeout:20000});}
async function absent(locator){await locator.waitFor({state:'detached',timeout:20000});}
async function unlock(panel){
 const search=panel.getByLabel('Pesquisar pessoas em Conectados');
 await search.fill('!'+code);
 assert.equal(await search.getAttribute('type'),'password');
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
 browser=await chromium.launch({headless:true});
 const a=await open(owner);
 await visible(a.panel.getByText(peerName,{exact:true}));
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
 assert.equal((await db.doc('connections/'+pair).get()).get('status'),'accepted');
 assert.deepEqual(blockedFirebase,[],'No browser request to remote Firebase');
 console.log('PASS actual app offline closes reserved surface without deleting shared relationship');
}finally{
 try{await browser?.close();}finally{await db.terminate();await deleteApp(app);}
}
