import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const STORE = 'store-ae53dc42e57eb9d5c3f7151c1431';
const BUSINESS = 'draft_5f46706373714839a55846e6d8cb102c';
const QUOTE_ID = 'a'.repeat(64);

// This is a DOM interaction test of existing PublicStorefrontApp,
// InitialPrepaidSubscriptionCheckout and src/utils/storeSubscription.
// Network and Firebase identity are test boundaries; real financial
// settlement remains covered by firestore-official-plan-pix.test.ts.
test('Praça deep link quotes, accepts and opens official Business Pix without adding a cart item', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://www.kyrub.com/@kyrub-oficial?coupon=BIZ1',
    pretendToBeVisual: true,
  });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Event: dom.window.Event,
    MutationObserver: dom.window.MutationObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const originalFetch = globalThis.fetch;
  const requests: Array<{operation: string; payload: any; authorization: string}> = [];
  let fetchStorefrontCount = 0;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const json = (data: unknown) => new Response(JSON.stringify(data), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
    if (url.includes('/api/marketplace-discovery/public/')) {
      fetchStorefrontCount++;
      return json({ store: {
        id: STORE, slug: 'kyrub-oficial', name: 'Kyrub Oficial', description: '', logo: '',
        banner: '', primaryColor: '#888', address: '', keywords: [], status: 'open',
      }, offers: [{
        id: BUSINESS, supplierId: STORE, name: 'Kyrub Business', description: 'Plano Business',
        price: 397, image: '', stock: 99, isService: true, category: 'Planos',
        saleModality: { schemaVersion: 1, mode: 'subscription', subscription: {
          schemaVersion: 1, autoRenew: false, billingInterval: { unit: 'month', count: 1 },
          benefit: { kind: 'access', unitsPerCycle: null },
        } },
        contractDiscounts: [{months: 1, discountPercent: 0}],
      }] });
    }
    if (url.includes('/api/plan-control?op=')) {
      const operation = new URL(url, 'https://www.kyrub.com').searchParams.get('op') || '';
      const payload = JSON.parse(String(init?.body || '{}'));
      const authorization = new Headers(init?.headers).get('authorization') || '';
      requests.push({operation, payload, authorization});
      if (operation === 'official.prepaid.quote') {
        return json({ checkoutId: QUOTE_ID, status: 'quoted', quote: {
          months: 1, totalMinor: 100, originalTotalMinor: 39700,
          promotionDiscountMinor: 39600, promotionCode: 'BIZ1',
          discountPercent: 0, monthlyEquivalentMinor: 39700,
        } });
      }
      if (operation === 'official.prepaid.accept') return json({status:'accepted'});
      if (operation === 'official.prepaid.checkout') return json({state:'awaiting_payment',
        pix:{qrCode:'FAKE-PIX-NOT-PAYABLE',expiresAt:'2099-11-16T15:00:00.000Z'}});
      if (operation === 'official.prepaid.payment-status') return json({state:'awaiting_payment'});
    }
    throw new Error('UNEXPECTED_NETWORK_ACCESS:' + url);
  };
  const mocks = {
    'firebase/auth': `export class GoogleAuthProvider {setCustomParameters() {}}; export const onAuthStateChanged=(auth,cb)=>{cb(auth.currentUser);return ()=>{}};export const signInWithPopup=async()=>{throw Error('REAL_LOGIN_NOT_ALLOWED')};`,
    'utils/firebase': `export const auth={currentUser:{uid:'buyer',email:'buyer@example.test',emailVerified:true,getIdToken:async()=> 'isolated-fake-token'}}; export const db={};`,
    'utils/customerOrders': `export const subscribeToStoreCustomerOrders=()=>()=>{};`,
    'utils/storefrontOriginContext': `export const loadStorefrontCart=()=>[];export const saveStorefrontCart=()=>{};export const saveStorefrontOriginContext=()=>{};export const reconcilePublishedStorefrontCart=(saved,offers)=>saved.filter(item=>offers.some(offer=>offer.id===item.product.id));`,
    'utils/storefrontEvents': `export const OPEN_PUBLIC_STOREFRONT_INFO_EVENT='open-storefront-info';`,
    'utils/marketplaceCheckout': `export const listMarketplacePromotions=async()=>[{id:'pilot',code:'BIZ1',title:'Business',badge:'PILOTO',discountType:'fixed',discountValue:396,productIds:['${BUSINESS}'],endsAt:'2099-12-31T00:00:00.000Z'}];`,
    'components/LegacyStorefrontPanel': `import {createElement} from 'react';export const StorefrontPanel=({products,handleAddToCart})=>createElement('button',{type:'button',id:'test-select-official-product',onClick:()=>handleAddToCart(products[0])},'Escolher Business');`,
    'components/StorefrontPanel': `import {createElement} from 'react';export const StorefrontPanel=({products,handleAddToCart})=>createElement('button',{type:'button',id:'test-select-official-product',onClick:()=>handleAddToCart(products[0])},'Escolher Business');`,
    'components/modals/B2CCartDrawer': `export const B2CCartDrawer=()=>null;`,
    'components/store/BuyerDeliveryTrackingBridge': `export const BuyerDeliveryTrackingBridge=()=>null;`,
  } as Record<string,string>;
  const bundle = await build({
    entryPoints:['src/components/PublicStorefrontApp.tsx'], bundle:true,
    platform:'node', format:'esm', packages:'external', write:false,
    plugins:[{name:'isolated-firebase-and-marketplace',setup(b) {
      // Virtual UI stubs still use the *installed* React runtime.
      b.onResolve({filter:/^react$/},()=>({path:'react',external:true}));
      b.onResolve({filter:/.*/},args=>{
        const p=args.path.replace(/\\.js$/, '');
        const key = p==='firebase/auth' ? 'firebase/auth'
          : p.endsWith('/utils/firebase')||p==='./firebase' ? 'utils/firebase'
          : p.endsWith('/utils/customerOrders') ? 'utils/customerOrders'
          : p.endsWith('/utils/storefrontOriginContext') ? 'utils/storefrontOriginContext'
          : p.endsWith('/utils/storefrontEvents') ? 'utils/storefrontEvents'
          : p.endsWith('/utils/marketplaceCheckout') ? 'utils/marketplaceCheckout'
          : p.endsWith('/LegacyStorefrontPanel') ? 'components/LegacyStorefrontPanel'
          : p.endsWith('/StorefrontPanel') ? 'components/StorefrontPanel'
          : p.endsWith('/modals/B2CCartDrawer') ? 'components/modals/B2CCartDrawer'
          : p.endsWith('/store/BuyerDeliveryTrackingBridge') ? 'components/store/BuyerDeliveryTrackingBridge'
          : null;
        return key ? {path:key,namespace:'isolated'} : undefined;
      });
      b.onLoad({filter:/.*/,namespace:'isolated'},args=>({contents:mocks[args.path],loader:'js'}));
    }}],
  });
  const filename = new URL(`../.official-plan-praça-dom-${randomUUID()}.mjs`,import.meta.url);
  let root: { render: (element: unknown)=>void; unmount:()=>void } | undefined;
  try {
    await writeFile(filename,bundle.outputFiles[0].text);
    const { createElement, act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { default: Component } = await import(filename.href).then(x=>({
      default:x.PublicStorefrontApp,
    }));
    root=createRoot(dom.window.document.getElementById('root')!);
    const settle=async () => { await act(async()=>{await new Promise(resolve=>setTimeout(resolve,15))}) };
    const click=async (selector:string) => {
      const element=dom.window.document.querySelector(selector) as HTMLElement | null;
      assert.ok(element,`Expected clickable ${selector}: ${dom.window.document.body.textContent?.slice(0,650)}`);
      await act(async()=>element.click());
      await settle();
    };
    await act(async()=>root!.render(createElement(Component,{slug:'kyrub-oficial'})));
    await settle();
    await settle();
    assert.equal(fetchStorefrontCount,1);
    const section=dom.window.document.querySelector('#official-plan-contract-section');
    assert.ok(section,'official plan section must render');
    assert.equal(section?.getAttribute('data-official-plan-route'),'canonical-prepaid');
    assert.match(section!.textContent||'',/BIZ1/);
    await click('button#test-select-official-product');
    const quoteButton=[...dom.window.document.querySelectorAll<HTMLButtonElement>('#official-plan-contract-section button')]
      .find(b=>b.textContent?.includes('Consultar preço oficial do contrato'));
    assert.ok(quoteButton,'existing subscription component must offer a server quote');
    await act(async()=>quoteButton.click());
    await settle();
    assert.equal(requests.length,1,'one quote only');
    assert.equal(requests[0].operation,'official.prepaid.quote');
    assert.equal(requests[0].payload.promotionCode,'BIZ1');
    assert.equal(requests[0].payload.productId,BUSINESS);
    assert.equal(requests[0].payload.storeId,STORE);
    assert.equal(requests[0].authorization,'Bearer isolated-fake-token');
    assert.match(section!.textContent||'',/397,00/);
    assert.match(section!.textContent||'',/396,00/);
    assert.match(section!.textContent||'',/1,00/);
    const checkbox=dom.window.document.querySelector('#official-plan-contract-section input[type="checkbox"]') as HTMLInputElement;
    assert.ok(checkbox,'buyer must explicitly accept original contract');
    await act(async()=>checkbox.click());
    const payButton=[...dom.window.document.querySelectorAll<HTMLButtonElement>('#official-plan-contract-section button')]
      .find(b=>b.textContent?.includes('Confirmar contratação e gerar Pix'));
    assert.ok(payButton,'existing checkout button must be available');
    await act(async()=>payButton.click());
    await settle();
    assert.deepEqual(requests.map(r=>r.operation),[
      'official.prepaid.quote','official.prepaid.accept','official.prepaid.checkout',
    ]);
    assert.equal(requests[1].payload.acceptedTotalMinor,100);
    assert.equal(requests[2].payload.checkoutId,QUOTE_ID);
    assert.match(section!.textContent||'',/Aguardando pagamento Pix/);
    assert.equal(dom.window.document.querySelectorAll('#public-storefront-shell [data-retail-checkout]').length,0);
  } finally {
    if (root) {
      const {act}=await import('react');
      await act(async()=>root!.unmount());
    }
    await unlink(filename).catch(()=>{});
    globalThis.fetch=originalFetch;
    for(const [key,value] of originals) {
      if(value) Object.defineProperty(globalThis,key,value);
      else delete (globalThis as any)[key];
    }
    dom.window.close();
  }
});
