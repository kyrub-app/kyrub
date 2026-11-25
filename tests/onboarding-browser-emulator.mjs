import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { adminAuth, adminDb } from '../server/firebaseAdmin.ts';
import { ageScreeningEmulatorsReady } from '../server/identity/ageScreeningRouter.ts';
assert.ok(ageScreeningEmulatorsReady(process.env));
assert.equal(process.env.VITE_KYRUB_ONBOARDING_EMULATOR,'true');
const origin = 'http://127.0.0.1:3000';
const browser = await chromium.launch({headless:true});
const context = await browser.newContext({viewport:{width:360,height:800}});
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.hostname !== '127.0.0.1' || !['3000','9099','8088','9199'].includes(url.port)) return route.abort();
  await route.continue();
});
const page = await context.newPage();
const password = 'Only-use-in-emulators1';
try {
  await page.goto(origin);
  await page.getByRole('heading',{name:'Ingresso Kyrub'}).waitFor();
  for (const [kind,date,expected] of [
    ['adult','2000-01-01','Maioridade declarada. A comprovação ainda está pendente.'],
    ['minor','2020-01-01','O ingresso não está disponível para menores de 18 anos.'],
  ]) {
    const email = 'browser-'+kind+'-'+Date.now()+'@example.invalid';
    await page.getByLabel('E-mail',{exact:true}).fill(email);
    await page.getByLabel('Senha',{exact:true}).fill(password);
    await page.getByRole('button',{name:'Criar conta',exact:true}).click();
    await page.getByText('Confirme seu e-mail para continuar.',{exact:true}).waitFor();
    const created = await adminAuth.getUserByEmail(email);
    assert.equal(created.emailVerified,false);
    assert.equal(await page.getByLabel('Data de nascimento').count(),0);
    // Verification is simulated solely by Admin SDK in the dedicated emulator.
    await adminAuth.updateUser(created.uid,{emailVerified:true});
    await page.getByRole('button',{name:'Já confirmei meu e-mail'}).click();
    await page.getByLabel('Data de nascimento').fill(date);
    if(kind==='adult') await page.getByLabel('Declaro ter 18 anos ou mais.').check();
    await page.getByRole('button',{name:'Enviar triagem'}).click();
    await page.getByText(expected,{exact:true}).waitFor();
    assert.equal(await page.getByLabel('Data de nascimento').count(),0);
    const stored=(await adminDb.doc('age_eligibility_private/'+created.uid).get()).data();
    assert.equal(stored?.status,kind==='adult'?'declared_adult':'declared_underage');
    assert.equal('birthDate' in stored,false);
    assert.equal((await adminDb.doc('users/'+created.uid).get()).exists,false);
    await page.reload();
    await page.getByText(expected,{exact:true}).waitFor();
    await page.getByRole('button',{name:'Sair',exact:true}).click();
    await page.getByLabel('E-mail',{exact:true}).fill(email);
    await page.getByLabel('Senha',{exact:true}).fill(password);
    await page.getByRole('button',{name:'Entrar',exact:true}).click();
    await page.getByText(expected,{exact:true}).waitFor();
    await page.getByRole('button',{name:'Sair',exact:true}).click();
  }
  // Exercise passwordless sign-in using a real emulator-issued OOB code.
  const linkEmail='browser-link-'+Date.now()+'@example.invalid';
  await page.getByLabel('E-mail',{exact:true}).fill(linkEmail);
  await page.getByRole('button',{name:'Enviar link de acesso',exact:true}).click();
  await page.getByText('Confira o link de acesso enviado ao seu e-mail.',{exact:true}).waitFor();
  const oobResponse=await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-kyrub-onboarding/oobCodes');
  assert.equal(oobResponse.status,200);
  const {oobCodes}=await oobResponse.json();
  const oob=oobCodes.find(x=>x.email===linkEmail&&x.requestType==='EMAIL_SIGNIN');
  assert.ok(oob?.oobCode);
  // Reproduce the application's fixed continuation URL; never navigate to a real mail provider.
  const callback=new URL('/?entry=email-access',origin);
  callback.searchParams.set('mode','signIn');
  callback.searchParams.set('apiKey','fake-emulator-key');
  callback.searchParams.set('oobCode',oob.oobCode);
  await page.goto(callback.toString());
  await page.getByLabel('E-mail',{exact:true}).fill(linkEmail);
  await page.getByRole('button',{name:'Confirmar acesso por e-mail'}).click();
  await page.getByLabel('Data de nascimento').waitFor();
  assert.equal(new URL(page.url()).search,'');
  const linkUser=await adminAuth.getUserByEmail(linkEmail);
  assert.equal(linkUser.emailVerified,true);
  assert.equal((await adminDb.doc('users/'+linkUser.uid).get()).exists,false);
  await page.getByRole('button',{name:'Sair',exact:true}).click();
  await page.getByRole('button',{name:'Enviar link de acesso',exact:true}).waitFor();
  // Fresh browser context proves rejection independently of local session state.
  const replayContext=await browser.newContext({viewport:{width:360,height:800}});
  await replayContext.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname!=='127.0.0.1'||!['3000','9099','8088','9199'].includes(url.port))return route.abort();
    await route.continue();
  });
  try{
    const replay=await replayContext.newPage();
    await replay.goto(callback.toString());
    await replay.getByLabel('E-mail',{exact:true}).fill(linkEmail);
    await replay.getByRole('button',{name:'Confirmar acesso por e-mail'}).click();
    await replay.getByRole('alert').waitFor();
    assert.equal(await replay.getByLabel('Data de nascimento').count(),0);
    await replay.getByRole('button',{name:'Cancelar link'}).click();
  }finally{await replayContext.close();}
  // Synthetic inconclusive result in the dedicated emulator; not an actual legal approval.
  assert.equal(process.env.KYRUB_PERSONAL_PREVIEW_ENABLED,'true');
  const personalEmail='personal-'+Date.now()+'@example.invalid';
  const personal=await adminAuth.createUser({email:personalEmail,password,emailVerified:true});
  await adminDb.doc('age_eligibility_private/'+personal.uid).set({uid:personal.uid,status:'inconclusive'});
  await page.getByLabel('E-mail',{exact:true}).fill(personalEmail);
  await page.getByLabel('Senha',{exact:true}).fill(password);
  const initialNotes=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/onboarding/personal/notes'&&r.request().method()==='GET');
  await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await page.getByRole('heading',{name:'Modo pessoal restrito'}).waitFor();
  const initialResponse=await initialNotes;
  assert.equal(initialResponse.status(),200,'Private notes GET must succeed before rendering the form');
  assert.deepEqual(await initialResponse.json(),{items:[]});
  await page.getByLabel('Nota',{exact:true}).fill('Nota privada teste');
  await page.getByRole('button',{name:'Adicionar nota'}).click();
  await page.getByText('Nota privada teste',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Editar',exact:true}).click();
  await page.getByLabel('Nota',{exact:true}).fill('Nota privada editada');
  await page.getByRole('button',{name:'Salvar edição'}).click();
  await page.getByText('Nota privada editada',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Tarefas privadas'}).click();
  await page.getByLabel('Tarefa',{exact:true}).fill('Tarefa privada teste');
  await page.getByRole('button',{name:'Adicionar tarefa'}).click();
  await page.getByText('Tarefa privada teste',{exact:true}).waitFor();
  // The controlled checkbox intentionally remains unchanged until the server
  // confirms the mutation; Playwright.check() expects an immediate change.
  const completionResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/onboarding/personal/tasks'&&r.request().method()==='POST');
  await page.getByLabel('Concluída',{exact:true}).click();
  const completion=await completionResponse;
  assert.equal(completion.status(),200);
  const completed=await completion.json();
  assert.equal(completed.items.find(item=>item.text==='Tarefa privada teste')?.done,true);
  await page.waitForFunction(()=>document.querySelector('input[type=checkbox]')?.checked===true&&!document.querySelector('input[type=checkbox]')?.disabled);
  await page.reload();
  await page.getByText('Nota privada editada',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Excluir',exact:true}).click();
  await page.getByText('Nota privada editada',{exact:true}).waitFor({state:'detached'});
  await page.getByRole('button',{name:'Tarefas privadas'}).click();
  await page.getByText('Tarefa privada teste',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Concluída',{exact:true}).isChecked(),true);
  assert.equal((await adminDb.doc('users/'+personal.uid).get()).exists,false);
  await adminDb.doc('age_eligibility_private/'+personal.uid).update({status:'suspended'});
  await page.getByRole('button',{name:'Excluir',exact:true}).click();
  await page.getByText('Não foi possível concluir. Consulte novamente sua situação.',{exact:true}).waitFor();
  assert.equal(await page.getByText('Tarefa privada teste',{exact:true}).count(),0);
  await page.reload();
  await page.getByText('A conta precisa de revisão.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'Modo pessoal restrito'}).count(),0);
  await page.getByRole('button',{name:'Sair',exact:true}).click();
  await page.getByRole('button',{name:'Enviar link de acesso',exact:true}).waitFor();
  assert.equal((await fetch(origin+'/api/onboarding/personal/notes')).status,401);
  assert.equal((await fetch(origin+'/api/notifications')).status,404);
  assert.equal((await fetch(origin+'/api/onboarding/age')).status,401);
  console.log('PASS: isolated onboarding registration, verification, age screening, reload, login and sign-out.');
} catch(error) {
  await page.screenshot({path:'onboarding-emulator-failure.png',fullPage:true}).catch(()=>{});
  throw error;
} finally { await browser.close(); }
