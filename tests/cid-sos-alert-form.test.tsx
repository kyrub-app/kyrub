import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import type {CidSosRequest} from '../shared/cidSosRequest';

test('SOS requires explicit confirmation, voluntary location, optional SMS and legal notice',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://kyrub.example/',pretendToBeVisual:true});
 const originals=new Map<string,PropertyDescriptor|undefined>();
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Event:dom.window.Event,IS_REACT_ACT_ENVIRONMENT:true})){
  originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 }
 let cleanup:(()=>Promise<void>)|undefined;
 try{
  const {createElement,act}=await import('react');
  const {createRoot}=await import('react-dom/client');
  const {KyrubCidSosAlertForm}=await import('../src/components/KyrubCidSosAlertForm');
  const root=createRoot(dom.window.document.getElementById('root')!);
  cleanup=async()=>{await act(async()=>root.unmount());};
  let locationCalls=0;const calls:CidSosRequest[]=[];
  await act(async()=>root.render(createElement(KyrubCidSosAlertForm,{simulation:true,smsAvailable:true,privacyUrl:'/privacy',requestLocation:async()=>{locationCalls++;return {latitude:0,longitude:0,accuracy:15};},submitAlert:async request=>{calls.push(request);return {accepted:true,simulated:true};}})));
  const doc=dom.window.document;
  const press=async(name:string)=>{const button=[...doc.querySelectorAll('button')].find(b=>b.textContent?.trim()===name);assert.ok(button,name);await act(async()=>button.click());};
  assert.equal(calls.length,0);assert.equal(locationCalls,0);
  await press('Emitir alerta');
  assert.ok(doc.body.textContent?.includes('autoridades competentes'));
  assert.equal(doc.querySelector<HTMLButtonElement>('button[type=submit]')?.disabled,true);
  const reason=doc.querySelector('textarea')!;
  const change=async(value:string)=>{await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value')!.set!.call(reason,value);reason.dispatchEvent(new dom.window.Event('input',{bubbles:true}));reason.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});};
  await change('Animal encontrado');
  assert.equal(locationCalls,0);assert.equal(calls.length,0);
  await press('Compartilhar minha localização atual');
  assert.equal(locationCalls,1);
  await press('Não compartilhar localização');
  const sms=doc.querySelector<HTMLInputElement>('input[type=checkbox]')!;
  assert.equal(sms.checked,false);await act(async()=>sms.click());
  await press('Simular emissão do alerta');
  assert.equal(calls.length,1);assert.equal(calls[0].reason,'Animal encontrado');assert.equal(calls[0].sms,true);assert.equal(calls[0].location,undefined);
  assert.ok(doc.body.textContent?.includes('Nenhuma mensagem foi enviada'));
  await press('Fechar');await press('Emitir alerta');
  assert.equal(doc.querySelector<HTMLInputElement>('input[type=checkbox]')?.checked,false);
  assert.equal(doc.querySelector('textarea')?.value,'');
 }finally{await cleanup?.();dom.window.close();for(const [key,value] of originals){if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}}
});
