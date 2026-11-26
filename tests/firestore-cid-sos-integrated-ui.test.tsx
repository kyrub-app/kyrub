import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {JSDOM} from 'jsdom';
import {randomBytes,createHash} from 'node:crypto';
import {initializeApp,getApps,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {assertCidSosEmulator,CID_EMULATOR_PROJECT,createCidSosEmulatorStore} from '../server/identity/cidSosEmulatorStore';
import {createCidChatEmulatorStore,CID_CHAT_EMULATOR_ORIGIN as origin} from '../server/identity/cidChatEmulatorStore';
import {prepareCidSosConfig,type ChannelGrant} from '../server/identity/cidSosPrivateConfig';
import {isolatedTagPasskeyScope,issueTagPasskeyChallenge} from '../server/identity/kyrubTagPasskeyPolicy';
import {tagRegistrationOptions,verifyTagRegistration} from '../server/identity/kyrubTagPasskeyVerifier';
import {makeSoftwareTagAuthenticator} from './fixtures/kyrub-tag-software-authenticator';
import type {HomologationChatSession,HomologationEntry} from '../src/components/KyrubCidSosHomologation';
assertCidSosEmulator();
const app=initializeApp({projectId:CID_EMULATOR_PROJECT},'cid-ui-fixtures');
const db=getFirestore(app),now=Date.UTC(2026,10,26,12);
const tagId='a'.repeat(32),ownerId='owner-test';
const tag={tagId,ownerId,displayName:'CID fictício',active:true};
const root=db.collection('cid_sos_emulator_tags').doc(tagId);
const person=(id:string)=>({id,name:id,channels:[{channel:'email',address:id+'@example.invalid'}]});
const config=prepareCidSosConfig(tag,ownerId,null,{expectedRevision:0,enabled:true,owner:person(ownerId),contacts:[person('contact-test')]});
const grants:ChannelGrant[]=[config.owner,...config.contacts].flatMap(p=>p.channels.map(c=>({...c,tagId,ownerId,participantId:p.id,verifiedAt:now-1000,consent:true})));
const token=()=>randomBytes(32).toString('base64url');
after(async()=>{for(const a of getApps().filter(a=>['cid-ui-fixtures','cid-sos-local-emulator','cid-chat-local-emulator'].includes(a.name)))await deleteApp(a);});
test('integrated React surfaces use actual local Firestore transactions for emitter, contact and signed owner',async()=>{
 await root.set({tag,revision:0});
 await root.collection('private').doc('config').set({config});
 await root.collection('private').doc('grants').set({grants});
 const scope=isolatedTagPasskeyScope(origin,origin),authenticator=makeSoftwareTagAuthenticator(origin,scope.rpId);
 const registration=issueTagPasskeyChallenge({tagId,purpose:'register',ownerId:null,credentialId:null,scope},now);
 const options=await tagRegistrationOptions(registration,now);
 const credential=await verifyTagRegistration(registration,authenticator.register(options),now);
 await db.collection('kyrub_official_tags').doc(tagId).set({ownerId,ownerAuthMode:'passkey',enabled:true,blocked:false});
 await db.collection('kyrub_tag_passkey_credentials').doc(tagId).set({ownerId,credential});
 await db.collection('kyrub_tag_passkey_credential_index').doc(createHash('sha256').update(credential.id).digest('hex')).set({ownerId,tagId});
 const dom=new JSDOM('<div id="emitter"></div><div id="owner"></div><div id="contact"></div>',{url:'https://kyrub.example/',pretendToBeVisual:true});
 const original=new Map<string,PropertyDescriptor|undefined>();
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Event:dom.window.Event,IS_REACT_ACT_ENVIRONMENT:true})){
  original.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 }
 let cleanup:(()=>Promise<void>)|undefined;
 try{
  const {createElement,act}=await import('react'),{createRoot}=await import('react-dom/client');
  const {KyrubCidSosHomologation}=await import('../src/components/KyrubCidSosHomologation');
  const doc=dom.window.document;
  const elements={emitter:doc.getElementById('emitter')!,owner:doc.getElementById('owner')!,contact:doc.getElementById('contact')!};
  const roots={emitter:createRoot(elements.emitter),owner:createRoot(elements.owner),contact:createRoot(elements.contact)};
  cleanup=async()=>{await act(async()=>Object.values(roots).forEach(r=>r.unmount()));};
  let clock=now,occurrenceId='';
  const session=(id:string,credentials:{id:string;secret:string},role:'owner'|'emitter'|'contact'):HomologationChatSession=>{
   const chat=createCidChatEmulatorStore(tagId,id);
   return {read:()=>chat.read(credentials,++clock),send:async input=>{await chat.send(credentials,input,++clock);},revoke:async()=>{await chat.revokeOwnSession(credentials,++clock);},...(role==='owner'?{close:async()=>{await chat.close(credentials,++clock);}}:{})};
  };
  const emitterSeed=token();
  const entries:Record<'emitter'|'owner'|'contact',HomologationEntry>={
   emitter:{role:'emitter',smsAvailable:false,submit:async request=>{occurrenceId=request.id;const result=await createCidSosEmulatorStore(tagId).submitEmitterAlert(request,emitterSeed,++clock);return session(request.id,result.session,'emitter');}},
   owner:{role:'owner',open:async()=>{const chat=createCidChatEmulatorStore(tagId,occurrenceId);const ceremony=await chat.beginOwnerPasskey(origin,++clock);const credentials=await chat.finishOwnerPasskey(origin,ceremony.challengeId,authenticator.assert(ceremony.options),++clock);return session(occurrenceId,credentials,'owner');}},
   contact:{role:'contact',requestConfirmation:async()=>{throw Error('unbound');},confirm:async()=>{throw Error('unbound');}}
  };
  const render=async(role:keyof typeof roots)=>{await act(async()=>roots[role].render(createElement(KyrubCidSosHomologation,{entry:entries[role],privacyUrl:'/privacy'})));};
  const wait=async(check:()=>boolean)=>{for(let i=0;i<120;i++){if(check())return;await act(async()=>{await new Promise(r=>setTimeout(r,25));});}assert.ok(check(),'UI operation did not complete');};
  const press=async(role:keyof typeof roots,label:string)=>{const b=[...elements[role].querySelectorAll('button')].find(x=>x.getAttribute('aria-label')===label||x.textContent?.trim()===label);assert.ok(b,label);await act(async()=>b.click());};
  const change=async(role:keyof typeof roots,selector:string,value:string)=>{
   const input=elements[role].querySelector<HTMLInputElement|HTMLTextAreaElement>(selector)!;assert.ok(input,selector);
   const prototype=input.tagName==='TEXTAREA'?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype;
   await act(async()=>{Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(input,value);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  };
  const chatVisible=(role:keyof typeof roots)=>!!elements[role].querySelector('[aria-label="Chat da ocorrência"]');
  await render('emitter');await press('emitter','Emitir alerta');
  assert.equal((await root.collection('occurrences').get()).size,0);
  await change('emitter','textarea','Animal encontrado');
  await press('emitter','Simular emissão do alerta');await wait(()=>chatVisible('emitter'));
  await change('emitter','textarea','Encontrei o animal.');await press('emitter','Enviar mensagem');
  await wait(()=>!!elements.emitter.querySelector('[role="log"]')?.textContent?.includes('Encontrei o animal.'));
  await render('owner');await press('owner','Acessar ocorrência por passkey');await wait(()=>chatVisible('owner'));
  assert.match(elements.owner.textContent??'',/Encontrei o animal/);
  const chat=createCidChatEmulatorStore(tagId,occurrenceId);
  const delivered=await chat.prepareContactInvitationForDelivery('contact-test','email',++clock);
  let confirmationSecret='',challengeId='';
  entries.contact={role:'contact',requestConfirmation:async()=>{const result=await chat.prepareContactConfirmationForDelivery(delivered.invitation,++clock);confirmationSecret=result.deliveryEnvelope.secret;challengeId=result.publicResult.challengeId;},confirm:async value=>session(occurrenceId,await chat.confirmContact(delivered.invitation,challengeId,value,++clock),'contact')};
  await render('contact');await press('contact','Solicitar confirmação do contato');
  await wait(()=>!!elements.contact.querySelector('input'));
  assert.ok(!elements.contact.textContent?.includes(confirmationSecret));
  await change('contact','input',confirmationSecret);await press('contact','Confirmar acesso');await wait(()=>chatVisible('contact'));
  await change('contact','textarea','Estou acompanhando.');await press('contact','Enviar mensagem');await wait(()=>!!elements.contact.querySelector('[role="log"]')?.textContent?.includes('Estou acompanhando.'));
  await press('owner','Atualizar conversa');await wait(()=>!!elements.owner.textContent?.includes('Estou acompanhando.'));
  await press('owner','Opções da ocorrência');await press('owner','Encerrar ocorrência');await press('owner','Confirmar encerramento');await wait(()=>!!elements.owner.textContent?.includes('Ocorrência encerrada'));
  await press('emitter','Atualizar conversa');await wait(()=>!!elements.emitter.textContent?.includes('Ocorrência encerrada'));
  assert.equal(elements.emitter.querySelector('textarea'),null);
  assert.equal((await root.collection('occurrences').get()).size,1);assert.equal((await root.collection('outbox').get()).size,2);
  await press('contact','Voltar');await wait(()=>!chatVisible('contact'));
 }finally{await cleanup?.();dom.window.close();for(const [key,value] of original){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}}
});
