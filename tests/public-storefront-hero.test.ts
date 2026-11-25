import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement, act } from 'react';
import { JSDOM } from 'jsdom';
import type { Store } from '../src/types';
import { PublicStorefrontHero } from '../src/components/PublicStorefrontHero';
import { PublicStorefrontQuickPanel } from '../src/components/PublicStorefrontQuickPanel';

const store = {
  id:'store_public_hero',name:'Kyrub Oficial',slug:'kyrub-oficial',
  description:'Loja de demonstração',policies:'Solicite trocas pelo chat da loja.',logo:'',
  banner:'https://example.com/hero1.jpg',
  bannerImages:['https://example.com/hero1.jpg','https://example.com/hero2.jpg'],
  offerImages:['https://example.com/not-a-banner.jpg'],
  galleryImages:['https://example.com/gallery1.jpg','https://example.com/gallery2.jpg'],
  primaryColor:'#ef7c22',plan:'free',status:'open',
  ownerEmail:'',address:'',contact:'',
  isNew:false,reservationsEnabled:false,
} as Store;

test('public storefront uses visual logo, swipeable footer and inline section controls',async()=>{
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>',{
    url:'https://www.kyrub.com/@kyrub-oficial',pretendToBeVisual:true,
  });
  const saved = new Map<string,PropertyDescriptor|undefined>();
  for(const [key,value] of [
    ['window',dom.window],['document',dom.window.document],['navigator',dom.window.navigator],
    ['HTMLElement',dom.window.HTMLElement],['Event',dom.window.Event],
    ['IS_REACT_ACT_ENVIRONMENT',true],
  ] as const){
    saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  const {createRoot}=await import('react-dom/client');
  const root=createRoot(dom.window.document.getElementById('app')!);
  const events:string[]=[];
  try{
    await act(async()=>root.render(createElement(PublicStorefrontHero,{
      store,selectedSection:null,actionsDisabled:false,
      onSelectSection:section=>events.push(section),
      onChat:()=>events.push('chat'),onShare:()=>events.push('share'),
    })));
    const hero=dom.window.document.getElementById('public-storefront-hero')!;
    assert.equal(hero.dataset.kyrubPublicStorefrontHero,'full-banner');
    assert.equal(hero.querySelectorAll('#storefront-banner').length,1);
    assert.equal(hero.querySelectorAll('#storefront-banner img').length,1);
    assert.match(hero.querySelector('#storefront-banner img')?.getAttribute('src')??'',/hero1\.jpg/);
    assert.match(hero.textContent??'',/kyrub.com\/@kyrub-oficial/);
    assert.ok(hero.querySelector('img[alt="Logo de Kyrub Oficial"]')===null);
    assert.equal(hero.querySelectorAll('nav[aria-label="Atalhos da loja"] button').length,6);
    assert.equal(dom.window.document.getElementById('public-storefront-reviews-trigger')?.getAttribute('aria-label'),'Momentos');
    assert.equal(dom.window.document.getElementById('public-storefront-reviews-trigger')?.textContent?.trim(),'Momentos');
    for(const [id,result]of [
      ['public-storefront-action-info','info'],
      ['public-storefront-action-reservas','reservas'],
      ['public-storefront-action-galeria','galeria'],
      ['public-storefront-reviews-trigger','avaliacoes'],
      ['customer-store-chat-launcher','chat'],
      ['public-storefront-action-share','share'],
    ] as const){
      const button=dom.window.document.getElementById(id)as HTMLButtonElement|null;
      assert.ok(button,'Missing '+id);
      assert.equal(button.type,'button');
      assert.ok(button.getAttribute('aria-label'));
      await act(async()=>button.click());
      assert.equal(events.at(-1),result);
    }
    const next=dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Abrir destaque 2"]');
    assert.ok(next);
    await act(async()=>next!.click());
    assert.match(dom.window.document.querySelector('img[aria-hidden="false"]')?.getAttribute('src')??'',/hero2\.jpg/);
    assert.equal(next!.getAttribute('aria-current'),'true');
    assert.equal(hero.querySelectorAll('#storefront-banner img').length,2);
  }finally{
    await act(async()=>root.unmount());
    for(const [key,descriptor]of saved){
      if(descriptor)Object.defineProperty(globalThis,key,descriptor);
      else delete(globalThis as Record<string,unknown>)[key];
    }
    dom.window.close();
  }
});

test('reservation accordion shows explicit disabled state and does not invent availability',async()=>{
  const dom=new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>',{
    url:'https://www.kyrub.com/@kyrub-oficial',pretendToBeVisual:true,
  });
  const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
  const oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  const oldAct=Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT');
  Object.defineProperty(globalThis,'window',{configurable:true,value:dom.window});
  Object.defineProperty(globalThis,'document',{configurable:true,value:dom.window.document});
  Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{configurable:true,value:true});
  const {createRoot}=await import('react-dom/client');
  const root=createRoot(dom.window.document.getElementById('app')!);
  const calls:string[]=[];
  const render=(enabled:boolean)=>createElement(PublicStorefrontQuickPanel,{
    store:{...store,reservationsEnabled:enabled},
    selected:'reservas',onClose:()=>calls.push('close'),
    onChat:()=>calls.push('chat'),onReviews:()=>calls.push('review'),actionsDisabled:false,
  });
  try{
    await act(async()=>root.render(render(false)));
    assert.match(dom.window.document.body.textContent??'',/Esta loja não trabalha com reservas\./);
    assert.equal(dom.window.document.querySelectorAll('button').length,1);
    await act(async()=>root.render(render(true)));
    assert.match(dom.window.document.body.textContent??'',/Esta loja aceita solicitações de reservas/);
    assert.match(dom.window.document.body.textContent??'',/não representa uma reserva confirmada/);
    const button=[...dom.window.document.querySelectorAll('button')]
      .find(x=>x.textContent?.includes('Consultar reserva pelo chat'));
    assert.ok(button);
    await act(async()=>button!.click());
    assert.deepEqual(calls,['chat']);
  }finally{
    await act(async()=>root.unmount());
    if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);
    else delete(globalThis as Record<string,unknown>).window;
    if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);
    else delete(globalThis as Record<string,unknown>).document;
    if(oldAct)Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',oldAct);
    else delete(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT;
    dom.window.close();
  }
});

test('gallery images remain independent of the banner, and policy content lives under Information',async()=>{
  const dom=new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>',{
    pretendToBeVisual:true,url:'https://www.kyrub.com/@kyrub-oficial',
  });
  const globals=new Map<string,PropertyDescriptor|undefined>();
  for(const [name,value]of [['window',dom.window],['document',dom.window.document],
    ['IS_REACT_ACT_ENVIRONMENT',true]] as const){
    globals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));
    Object.defineProperty(globalThis,name,{configurable:true,value});
  }
  const {createRoot}=await import('react-dom/client');
  const root=createRoot(dom.window.document.getElementById('app')!);
  const render=(section:'info'|'galeria',policies=store.policies)=>createElement(PublicStorefrontQuickPanel,{
    store:{...store,policies},selected:section,onClose:()=>{},onChat:()=>{},onReviews:()=>{},actionsDisabled:false,
  });
  try{
    await act(async()=>root.render(render('info')));
    assert.match(dom.window.document.body.textContent??'',/Políticas e condições/);
    assert.match(dom.window.document.body.textContent??'',/Solicite trocas pelo chat da loja/);
    await act(async()=>root.render(render('info','')));
    assert.equal(dom.window.document.getElementById('public-storefront-policies-inside-info'),null);
    await act(async()=>root.render(render('galeria')));
    assert.equal(dom.window.document.querySelectorAll('#public-storefront-gallery-grid img').length,2);
    assert.doesNotMatch(dom.window.document.body.textContent??'',/Políticas e condições/);
    const image=dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Ampliar foto 1 de 2"]');
    assert.ok(image);
    await act(async()=>image!.click());
    assert.ok(dom.window.document.querySelector('[role="dialog"]'));
    await act(async()=>(dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Próxima foto"]'))?.click());
    assert.match(dom.window.document.querySelector('[role="dialog"] img')?.getAttribute('src')??'',/gallery2\.jpg/);
    await act(async()=>(dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Fechar foto ampliada"]'))?.click());
    assert.equal(dom.window.document.querySelector('[role="dialog"]'),null);
  }finally{
    await act(async()=>root.unmount());
    for(const [name,descriptor]of globals){
      if(descriptor)Object.defineProperty(globalThis,name,descriptor);
      else delete (globalThis as Record<string,unknown>)[name];
    }
    dom.window.close();
  }
});

test('catalog remains after one hero; reservation setting is server-owned',()=>{
  const app=readFileSync('src/components/PublicStorefrontApp.tsx','utf8');
  const legacy=readFileSync('src/components/LegacyStorefrontPanel.tsx','utf8');
  const wrapper=readFileSync('src/components/StorefrontPanel.tsx','utf8');
  const hero=readFileSync('src/components/PublicStorefrontHero.tsx','utf8');
  assert.match(app,/<PublicStorefrontHero/);
  assert.match(app,/<PublicStorefrontQuickPanel/);
  assert.equal((app.match(/\s+hideHero\s*\n/g)||[]).length,2);
  assert.ok(app.indexOf('<PublicStorefrontHero')<app.indexOf('<main className="mx-auto w-full max-w-5xl p-3'));
  assert.match(legacy,/!hideHero && <section/);
  assert.match(legacy,/<SharedPdvCatalog/);
  assert.match(wrapper,/<StoreCustomerChatLauncher/);
  assert.match(app,/<StoreCustomerChatBridge \/>/);
  assert.match(app,/openStoreCustomerChat\(\{ perspective: 'customer'/);
  assert.match(hero,/overflow-x-auto/);
  assert.match(hero,/event\.stopPropagation\(\)/);
  assert.doesNotMatch(hero,/id="public-storefront-close"/);
  assert.doesNotMatch(hero,/id="public-storefront-header-info-trigger"/);
  assert.match(app,/navigator\.share/);
  assert.match(app,/navigator\.clipboard/);
  assert.match(app,/id="public-storefront-open-kyrub"/);
});
