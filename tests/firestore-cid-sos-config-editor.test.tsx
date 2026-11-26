import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {JSDOM} from 'jsdom';
import type {CidOwnerCentralSession} from '../src/components/KyrubCidOwnerCentralHomologation';
import {randomBytes,createHash} from 'node:crypto';
import {initializeApp,getApps,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {assertCidSosEmulator,CID_EMULATOR_PROJECT,createCidSosEmulatorStore} from '../server/identity/cidSosEmulatorStore';
import {CID_CHAT_EMULATOR_ORIGIN as origin,createCidChatEmulatorStore} from '../server/identity/cidChatEmulatorStore';
import {createCidOwnerCentralEmulator} from '../server/identity/cidOwnerCentralEmulator';
import {prepareCidSosConfig,type ChannelGrant} from '../server/identity/cidSosPrivateConfig';
import {isolatedTagPasskeyScope,issueTagPasskeyChallenge} from '../server/identity/kyrubTagPasskeyPolicy';
import {tagRegistrationOptions,verifyTagRegistration} from '../server/identity/kyrubTagPasskeyVerifier';
import {makeSoftwareTagAuthenticator} from './fixtures/kyrub-tag-software-authenticator';
assertCidSosEmulator();
const app=initializeApp({projectId:CID_EMULATOR_PROJECT},'cid-central-fixtures');
const db=getFirestore(app),now=Date.UTC(2026,10,26,12),tagId='a'.repeat(32),ownerId='owner-test',id='b'.repeat(32);
const tag={tagId,ownerId,displayName:'CID fictício',active:true};
const root=db.collection('cid_sos_emulator_tags').doc(tagId);
const person=(id:string)=>({id,name:id,channels:[{channel:'email',address:id+'@example.invalid'}]});
const config=prepareCidSosConfig(tag,ownerId,null,{expectedRevision:0,enabled:true,owner:person(ownerId),contacts:[person('contact-test')]});
const grants:ChannelGrant[]=[config.owner,...config.contacts].flatMap(p=>p.channels.map(c=>({...c,tagId,ownerId,participantId:p.id,verifiedAt:now-1000,consent:true})));
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
after(async()=>{for(const a of getApps().filter(a=>['cid-central-fixtures','cid-sos-local-emulator','cid-chat-local-emulator','cid-owner-central-local-emulator'].includes(a.name)))await deleteApp(a);});
test('owner Central config editor saves by fresh passkey and requests consent separately',async()=>{
 await root.set({tag,revision:0});
 const scope=isolatedTagPasskeyScope(origin,origin),auth=makeSoftwareTagAuthenticator(origin,scope.rpId);
 const reg=issueTagPasskeyChallenge({tagId,purpose:'register',ownerId:null,credentialId:null,scope},now);
 const stored=await verifyTagRegistration(reg,auth.register(await tagRegistrationOptions(reg,now)),now);
 await db.collection('kyrub_official_tags').doc(tagId).set({ownerId,ownerAuthMode:'passkey',enabled:true,blocked:false});
 await db.collection('kyrub_tag_passkey_credentials').doc(tagId).set({ownerId,credential:stored});
 await db.collection('kyrub_tag_passkey_credential_index').doc(hash(stored.id)).set({ownerId,tagId});
 const central=createCidOwnerCentralEmulator(tagId);
 let clock=now,saveCount=0,delivery:Awaited<ReturnType<typeof central.prepareChannelConsentForDelivery>>|undefined;
 const dom=new JSDOM('<div id="root"></div>',{url:origin,pretendToBeVisual:true});
 const previous=new Map<string,PropertyDescriptor|undefined>();
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Event:dom.window.Event,IS_REACT_ACT_ENVIRONMENT:true})){
  previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 }
 let cleanup:(()=>Promise<void>)|undefined;
 try{
  const {createElement,act}=await import('react'),{createRoot}=await import('react-dom/client');
  const {KyrubCidOwnerCentralHomologation}=await import('../src/components/KyrubCidOwnerCentralHomologation');
  const doc=dom.window.document,mount=createRoot(doc.getElementById('root')!);
  cleanup=async()=>{await act(async()=>mount.unmount());};
  const open=async():Promise<CidOwnerCentralSession>=>{
   const ceremony=await central.begin(origin,++clock),session=await central.finish(origin,ceremony.challengeId,auth.assert(ceremony.options),++clock);
   return {read:()=>central.read(session,++clock),revoke:async()=>{await central.revoke(session,++clock);},editor:{
    read:()=>central.readEditor(session,++clock),
    save:async draft=>{saveCount++;const challenge=await central.beginConfigChange(session,origin,draft,++clock);await central.finishConfigChange(session,origin,challenge.challengeId,auth.assert(challenge.options),++clock);},
    requestConsent:async(participant,channel)=>{delivery=await central.prepareChannelConsentForDelivery(session,participant,channel,++clock);}
   }};
  };
  await act(async()=>mount.render(createElement(KyrubCidOwnerCentralHomologation,{open,onOccurrence:()=>{throw Error('unexpected');}})));
  const find=(label:string)=>[...doc.querySelectorAll('button')].find(b=>b.textContent?.trim()===label);
  const press=async(label:string)=>{const b=find(label);assert.ok(b,label);assert.equal(b.disabled,false,label);await act(async()=>b.click());};
  const wait=async(check:()=>boolean)=>{for(let i=0;i<160;i++){if(check())return;await act(async()=>{await new Promise(r=>setTimeout(r,25));});}assert.ok(check(),'UI operation did not complete');};
  const change=async(label:string,value:string)=>{const input=[...doc.querySelectorAll<HTMLInputElement>('input')].find(e=>e.getAttribute('aria-label')===label);assert.ok(input,label);await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});};
  await press('Acessar meu CID por passkey');await wait(()=>!!find('Configurar SOS'));
  await press('Configurar SOS');await press('Editar configuração SOS');await wait(()=>!!find('Adicionar contato (0/3)'));
  assert.equal((await root.collection('private').doc('config').get()).exists,false);
  await change('E-mail — Titular','owner@example.invalid');
  await press('Adicionar contato (0/3)');await change('Nome — Contato 1','Contato de teste');await change('E-mail — Contato 1','contact@example.invalid');
  await press('Adicionar contato (1/3)');await press('Adicionar contato (2/3)');
  assert.equal(find('Adicionar contato (3/3)')?.disabled,true);
  await press('Remover contato 3');await press('Remover contato 2');
  await act(async()=>doc.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  assert.equal(find('Solicitar autorização — E-mail — Contato 1')?.disabled,true);
  assert.equal(saveCount,0);
  await press('Salvar com passkey');await wait(()=>!!find('Solicitar autorização — E-mail — Contato 1')&&!find('Solicitar autorização — E-mail — Contato 1')!.disabled);
  assert.equal(saveCount,1);
  const saved=(await root.collection('private').doc('config').get()).get('config');
  assert.equal(saved.revision,1);assert.equal(saved.contacts.length,1);
  assert.equal(delivery,undefined);
  await press('Solicitar autorização — E-mail — Contato 1');await wait(()=>!!delivery);
  assert.ok(delivery);assert.equal(delivery!.deliveryEnvelope.route.address,'contact@example.invalid');
  assert.ok(!doc.body.textContent?.includes(delivery!.deliveryEnvelope.secret));
  await central.confirmChannelConsent(delivery!.publicResult.challengeId,delivery!.deliveryEnvelope.secret,true,++clock);
  await wait(()=>!find('Recarregar e descartar alterações não salvas')?.disabled);
  await press('Recarregar e descartar alterações não salvas');
  await wait(()=>!find('Solicitar autorização — E-mail — Contato 1')&&!!doc.body.textContent?.includes('Verificado e autorizado'));
  await press('Sair da Central');await wait(()=>!!find('Acessar meu CID por passkey'));
  assert.equal(doc.querySelector('[aria-label="E-mail — Contato 1"]'),null);
 }finally{await cleanup?.();dom.window.close();for(const [key,value] of previous){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}}
});
