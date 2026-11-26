import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import type {CidChatView,CidChatAction} from '../src/components/KyrubCidOccurrenceChat';
import {CID_SOS_CHAT_GREETING} from '../shared/cidSosRequest';

test('private chat interaction and capabilities without real services',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://kyrub.example/',pretendToBeVisual:true});
 const originals=new Map<string,PropertyDescriptor|undefined>();
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Event:dom.window.Event,IS_REACT_ACT_ENVIRONMENT:true})){
  originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 }
 let cleanup:(()=>Promise<void>)|undefined;
 try{
  const {createElement,act}=await import('react');
  const {createRoot}=await import('react-dom/client');
  const {KyrubCidOccurrenceChat}=await import('../src/components/KyrubCidOccurrenceChat');
  const root=createRoot(dom.window.document.getElementById('root')!);
  cleanup=async()=>{await act(async()=>root.unmount());};
  const now=Date.UTC(2026,10,26,12);
  const view:CidChatView={id:'chat-a',reason:'Animal encontrado',role:'owner',closed:false,participantCount:5,messages:[{id:'greeting',authorLabel:'Sistema',mine:false,kind:'system',body:CID_SOS_CHAT_GREETING,createdAt:now}]};
  const events:string[]=[],sent:{id:string;body:string}[]=[];
  const actions:Partial<Record<CidChatAction,()=>Promise<void>>>={participants:async()=>{events.push('participants');},close:async()=>{events.push('close');}};
  let fail=true;
  const props={actions,simulation:true,onBack:()=>{events.push('back');},sendMessage:async(input:{id:string;body:string})=>{sent.push({...input});if(fail)throw Error('simulated');}};
  const render=async(v:CidChatView)=>{await act(async()=>root.render(createElement(KyrubCidOccurrenceChat,{...props,view:v})));};
  const doc=dom.window.document;
  const press=async(name:string)=>{const b=[...doc.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')===name||x.textContent?.trim()===name);assert.ok(b,name);await act(async()=>b.click());};
  await render(view);
  assert.ok(doc.body.textContent?.includes(CID_SOS_CHAT_GREETING));
  assert.ok(doc.body.textContent?.includes('autoridades competentes'));
  assert.equal(doc.querySelector<HTMLButtonElement>('[aria-label="Enviar mensagem"]')?.disabled,true);
  await press('Opções da ocorrência');
  const download=[...doc.querySelectorAll('button')].find(x=>x.textContent?.includes('Baixar conversa'));
  assert.equal(download?.disabled,true);
  await press('Participantes');assert.deepEqual(events,['participants']);
  const textarea=doc.querySelector('textarea')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value')!.set!.call(textarea,'Encontrei o animal.');textarea.dispatchEvent(new dom.window.Event('input',{bubbles:true}));textarea.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  await press('Enviar mensagem');
  assert.match(doc.body.textContent??'',/Não foi possível enviar/);
  fail=false;await press('Enviar mensagem');
  assert.equal(sent.length,2);assert.deepEqual(sent[0],sent[1]);
  assert.equal(textarea.value,'');
  await press('Opções da ocorrência');await press('Encerrar ocorrência');
  assert.deepEqual(events,['participants']);
  await press('Cancelar');await press('Opções da ocorrência');await press('Encerrar ocorrência');await press('Confirmar encerramento');
  assert.deepEqual(events,['participants','close']);
  await render({...view,closed:true});
  assert.equal(doc.querySelector('textarea'),null);
  await render({...view,id:'chat-b',role:'contact'});
  await press('Opções da ocorrência');
  assert.ok(![...doc.querySelectorAll('button')].some(x=>x.textContent?.includes('Encerrar ocorrência')));
  await press('Voltar');assert.equal(events.at(-1),'back');
 }finally{await cleanup?.();dom.window.close();for(const [key,value] of originals){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}}
});
