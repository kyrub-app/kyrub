import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
const project='kyrub-security-test',origin='http://127.0.0.1:3000';
for(const key of ['FIREBASE_PROJECT_ID','GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT'])assert.equal(process.env[key],project);
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8088');
for(const key of ['VERCEL','VERCEL_ENV','FIREBASE_SERVICE_ACCOUNT_JSON','GOOGLE_APPLICATION_CREDENTIALS'])assert.ok(!process.env[key],key);
const auth=getAuth(initializeApp({projectId:project})),uid='visual-'+randomUUID();
await auth.createUser({uid,email:uid+'@example.invalid',emailVerified:true});
const token=await auth.createCustomToken(uid);
const browser=await chromium.launch({headless:true});
const postId='reputation_'+'a'.repeat(64),createdAt=new Date(Date.now()-1000).toISOString();
const summary={experience:{completedServices:12,completedHires:8},reputations:{professional:{ratingCount:10,mean:4.9},personalRequester:{ratingCount:6,mean:4.5}}};
await mkdir('cocar-visual-evidence',{recursive:true});
try{
 for(const width of [337,390,1365]){
  const ctx=await browser.newContext({viewport:{width,height:1100}});
  const page=await ctx.newPage(),errors=[],forbidden=[];
  page.on('pageerror',e=>errors.push(e.message));
  let count=1234,connected=false,square=false;
  await ctx.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(!['127.0.0.1','localhost'].includes(url.hostname)&&['http:','https:'].includes(url.protocol)){
    if(/firebase|googleapis/.test(url.hostname))forbidden.push(url.origin);
    return route.abort();
   }
   if(url.pathname==='/api/freelance/workspace'){
    const headers=route.request().headers();
    assert.ok(headers.authorization?.startsWith('Bearer '));
    if(url.searchParams.get('view')==='reputation_square_post'){
     assert.equal(url.searchParams.get('offerId'),postId);square=true;
     return route.fulfill({json:{...summary,cocaresAtPublication:count}});
    }
    if(url.searchParams.get('view')==='reputation_connected_card'){
     connected=true;
     return route.fulfill({json:{...summary,publication:{authorName:'Autora original fictícia',authorImage:'',createdAtIso:createdAt,expiresAtIso:new Date(Date.now()+60000).toISOString(),cocaresAtPublication:count}}});
    }
    return route.fulfill({status:404,json:{}});
   }
   return route.continue();
  });
  await page.goto(origin+'/tests/cocar-visual-fixture.html');
  await page.waitForFunction(()=>typeof window.mountCocarFixture==='function');
  await page.evaluate(args=>window.mountCocarFixture(args),{token,postId,authorId:'fixture-author',connectionId:'fixture-connection',messageId:'fixture-message',createdAt});
  const feed=page.getByRole('region',{name:'Praça',exact:true}),chat=page.getByRole('region',{name:'Mensagem encaminhada',exact:true});
  await feed.getByLabel('1.234X — Cocares na data da publicação',{exact:true}).waitFor({state:'visible'});
  await chat.getByRole('button',{name:'Visualizar publicação',exact:true}).click();
  await chat.getByLabel('1.234X — Cocares na data da publicação',{exact:true}).waitFor({state:'visible'});
  for(const region of [feed,chat]){
   for(const label of ['Serviços concluídos','Contratações concluídas','Profissional','Contratante pessoal'])await region.getByText(label,{exact:true}).waitFor({state:'visible'});
   await region.getByText('Autora original fictícia',{exact:false}).first().waitFor({state:'visible'});
   assert.equal(await region.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'Horizontal overflow at '+width);
  }
  await chat.getByText('Autor original',{exact:true}).waitFor({state:'visible'});
  assert.ok(square&&connected);
  await page.screenshot({path:'cocar-visual-evidence/cocares-'+width+'.png',fullPage:true});
  count=null;
  await chat.getByRole('button',{name:'Atualizar indicadores',exact:true}).click();
  await chat.getByText('Autor original',{exact:true}).waitFor({state:'visible'});
  assert.equal(await chat.getByTitle('Cocares na data da publicação').count(),0);
  assert.deepEqual(forbidden,[]);assert.deepEqual(errors,[]);
  await ctx.close();
  console.log('PASS actual UI components with isolated HTTP fixtures, width',width);
 }
}finally{await browser.close();await auth.deleteUser(uid);}
