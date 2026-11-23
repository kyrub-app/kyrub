import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import type { Store } from '../src/types';
import { PublicStorefrontHero } from '../src/components/PublicStorefrontHero';

const store = {
  id: 'store_public_hero',
  name: 'Kyrub Oficial',
  slug: 'kyrub-oficial',
  description: 'Loja de demonstração',
  logo: '',
  banner: 'https://example.com/hero1.jpg',
  offerImages: ['https://example.com/hero2.jpg'],
  primaryColor: '#ef7c22',
  plan: 'free',
  status: 'open',
  ownerEmail: '',
  address: '',
  contact: '',
  isNew: false,
} as Store;

test('the public storefront hero merges banner, brand and touch-friendly icon actions', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    url: 'https://www.kyrub.com/@kyrub-oficial',
    pretendToBeVisual: true,
  });
  const prevWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const prevDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const prevAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  Object.defineProperty(globalThis, 'window', {configurable:true,writable:true,value:dom.window});
  Object.defineProperty(globalThis, 'document', {configurable:true,writable:true,value:dom.window.document});
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {configurable:true,writable:true,value:true});
  const events: string[] = [];
  const root = createRoot(dom.window.document.getElementById('app')!);
  try {
    await act(async () => root.render(createElement(PublicStorefrontHero, {
      store,
      movementLabel: 'Vitrine oficial de planos',
      movementColorClassName: 'text-cyan-400',
      actionsDisabled: false,
      onOpenInfo: () => events.push('info'),
      onClose: () => events.push('close'),
      onReviews: () => events.push('reviews'),
      onChat: () => events.push('chat'),
    })));

    const hero=dom.window.document.getElementById('public-storefront-hero')!;
    assert.equal(hero.dataset.kyrubPublicStorefrontHero, 'full-banner');
    assert.equal(dom.window.document.querySelectorAll('#storefront-banner').length,1);
    assert.equal(dom.window.document.querySelectorAll('#storefront-banner img').length,2);
    assert.equal(dom.window.document.querySelectorAll('img[aria-hidden="false"]').length,1);
    assert.match(hero.textContent??'', /Kyrub Oficial/);
    assert.match(hero.textContent??'', /kyrub.com\/@kyrub-oficial/);
    for(const [id,result] of [
      ['public-storefront-header-info-trigger','info'],
      ['public-storefront-reviews-trigger','reviews'],
      ['customer-store-chat-launcher','chat'],
      ['public-storefront-close','close'],
    ] as const) {
      const button=dom.window.document.getElementById(id) as HTMLButtonElement|null;
      assert.ok(button, 'Missing '+id);
      assert.equal(button!.getAttribute('type'),'button');
      assert.ok(button!.getAttribute('aria-label'));
      await act(async()=>button!.click());
      assert.equal(events.at(-1),result);
    }
    const next=dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Abrir destaque 2"]');
    assert.ok(next);
    await act(async()=>next!.click());
    assert.equal(dom.window.document.querySelectorAll('img[aria-hidden="false"]').length,1);
    assert.match(dom.window.document.querySelector('img[aria-hidden="false"]')?.getAttribute('src')??'', /hero2\.jpg/);
    assert.equal(next!.getAttribute('aria-current'),'true');
  } finally {
    await act(async()=>root.unmount());
    for(const [key,descriptor] of [
      ['window',prevWindow],['document',prevDocument],['IS_REACT_ACT_ENVIRONMENT',prevAct],
    ] as const){
      if(descriptor)Object.defineProperty(globalThis,key,descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
    dom.window.close();
  }
});

test('public hero is rendered once before catalog; other store contexts retain legacy carousel', () => {
  const app = readFileSync('src/components/PublicStorefrontApp.tsx','utf8');
  const legacy=readFileSync('src/components/LegacyStorefrontPanel.tsx','utf8');
  const wrapper=readFileSync('src/components/StorefrontPanel.tsx','utf8');
  assert.match(app, /<PublicStorefrontHero/);
  assert.equal((app.match(/\s+hideHero\s*\n/g)||[]).length,2);
  assert.ok(app.indexOf('<PublicStorefrontHero') < app.indexOf('<main className="mx-auto w-full max-w-5xl p-3'));
  assert.match(legacy, /!hideHero && <section/);
  assert.match(legacy, /<SharedPdvCatalog/);
  assert.match(wrapper, /!hasPublishedCatalog && <StoreCustomerChatLauncher/);
  assert.match(app, /<StoreCustomerChatBridge \/>/);
  assert.match(app, /openStoreCustomerChat\(\{ perspective: 'customer'/);
  assert.doesNotMatch(app, /#public-storefront-shell #storefront-banner > div/);
  assert.match(app, /onReviews=\{\(\) => \{ if \(user\) setStoreReviewsOpen\(true\); else void handleGoogleLogin\(\); \}\}/);
  assert.match(app, /onChat=\{\(\) => \{/);
  assert.match(app, /id="public-storefront-open-kyrub"/);
});
