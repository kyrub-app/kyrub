import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { buildProductConfigurationSelection } from '../src/utils/productCustomization.js';

const discounts = [
  { months: 1, discountPercent: 0 }, { months: 3, discountPercent: 20 },
  { months: 6, discountPercent: 30 }, { months: 12, discountPercent: 40 },
];
const business: any = { id: 'business', supplierId: 'official', name: 'Kyrub Business', price: 199.9,
  image: '', description: '', category: 'Planos', stock: 0, isService: true,
  saleModality: { schemaVersion: 1, mode: 'subscription', subscription: { schemaVersion: 1,
    billingInterval: { unit: 'month', count: 1 }, benefit: { kind: 'access', unitsPerCycle: null }, autoRenew: true } },
  contractDiscounts: discounts };
const fixture: any = { states: [], cursor: 0, effects: [], subscriptions: 0, fallback: [{ ...business, contractDiscounts: undefined }] };
fixture.useState = (initial: any) => {
  const index = fixture.cursor++;
  if (!(index in fixture.states)) fixture.states[index] = typeof initial === 'function' ? initial() : initial;
  return [fixture.states[index], (next: any) => { fixture.states[index] = typeof next === 'function' ? next(fixture.states[index]) : next; }];
};
(globalThis as any).__contractTermsFixture = fixture;

async function loadComponent(entry: string, controlledHooks = false) {
  const bundle = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false,
    plugins: [{ name: 'isolated-catalog-and-checkout', setup(b) {
      b.onResolve({ filter: /^react$/ }, args => controlledHooks && /[/\\]StorefrontPanel\.tsx$/.test(args.importer)
        ? { path: 'hooks', namespace: 'fixture' } : undefined);
      b.onResolve({ filter: /firebase\/firestore$|(?:^|\/)(publicProducts|firebase|customerOrders|marketplaceCheckout|storeSubscription|catalogCustomizationInheritance)(?:\.js)?$|LegacyStorefrontPanel$|CustomerStoreRelationshipPanel$|StoreCustomerChatLauncher$|InitialPrepaidSubscriptionCheckout$/ }, args => ({ path: args.path.replace(/\.js$/, ''), namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => {
        const path = args.path;
        const contents = path === 'hooks'
          ? 'const f=globalThis.__contractTermsFixture;export const useState=f.useState;export const useMemo=(fn)=>fn();export const useEffect=(fn)=>f.effects.push(fn);'
          : path.endsWith('publicProducts')
            ? 'export const subscribeToPreferredPublicProducts=(id,callback)=>{const f=globalThis.__contractTermsFixture;f.subscriptions++;callback({products:f.fallback});return ()=>{};};'
          : path.endsWith('catalogCustomizationInheritance')
            ? 'export const parseCatalogCustomizationDefaults=()=>[];export const resolveCatalogCustomization=()=>({quickNotes:[],optionGroups:[]});'
          : path.endsWith('customerOrders')
            ? 'export const subscribeToStoreCustomerOrders=()=>()=>{};export const subscribeToCustomerOrder=()=>()=>{};export const loadLastCustomerOrderId=()=>"";export const buildCustomerOrder=()=>{};export const getCustomerOrderItemOpenQuantity=()=>0;export const getCustomerOrderOutstandingTotal=()=>0;export const getCustomerOrderStatusLabel=()=>"";export const getFulfillmentLabel=()=>"";export const persistCustomerOrder=()=>{};export const saveLastCustomerOrderId=()=>{};'
          : path.endsWith('marketplaceCheckout')
            ? 'export const listMarketplacePromotions=async()=>[];export const initiateMarketplaceCheckout=()=>{throw Error("PAYMENT_NOT_ALLOWED")};export const quoteMarketplaceCoupon=()=>{throw Error("QUOTE_NOT_EXPECTED")};'
          : path.endsWith('storeSubscription')
            ? 'export const createCatalogSubscriptionCheckout=()=>{throw Error("PAYMENT_NOT_ALLOWED")};export const quoteMerchantSubscriptionContract=()=>{throw Error("QUOTE_NOT_EXPECTED")};export const loadCatalogSubscriptionBillingRoute=async()=>({kind:"platform-plan"});'
          : path.endsWith('firebase')
            ? 'export const db={};export const auth={currentUser:null};'
          : path === 'firebase/firestore'
            ? 'export const doc=()=>({});export const onSnapshot=()=>()=>{};'
          : 'export const StorefrontPanel=()=>null;export const CustomerStoreRelationshipPanel=()=>null;export const StoreCustomerChatLauncher=()=>null;export const InitialPrepaidSubscriptionCheckout=()=>null;';
        return { contents };
      });
    } }],
  });
  const path = new URL(`.contract-terms-${randomUUID()}.cjs`, import.meta.url);
  writeFileSync(path, bundle.outputFiles[0].text);
  try { return createRequire(import.meta.url)(fileURLToPath(path)); }
  finally { unlinkSync(path); }
}

const { StorefrontPanel } = await loadComponent('src/components/StorefrontPanel.tsx', true);
const { B2CCartDrawer } = await loadComponent('src/components/modals/B2CCartDrawerApprovalBase.tsx');
const store: any = { id: 'official', name: 'Kyrub Oficial', keywords: [], primaryColor: '#000000' };
const checkoutHtml = (product: any) => renderToStaticMarkup(createElement(B2CCartDrawer, {
  isOpen: true, visitingStore: store, cart: [{ product, quantity: 1 }], onClose() {}, updateCartQty() {},
  buyerName: '', buyerEmail: '', buyerAddress: '', setBuyerName() {}, setBuyerEmail() {}, setBuyerAddress() {},
}));
const terms = (html: string) => {
  const select = html.match(/<select[^>]*id="subscription-contract-months"[^>]*>([\s\S]*?)<\/select>/)?.[1];
  assert.ok(select, 'the actual checkout must render Duração contratual');
  return [...select.matchAll(/<option[^>]*value="(\d+)"/g)].map(match => Number(match[1]));
};

test('published API catalog survives a competing client read and reaches checkout with 1/3/6/12 months', () => {
  fixture.states = []; fixture.effects = []; fixture.subscriptions = 0;
  let cartProduct: any;
  const props = { catalogSource: 'published-api', activeConsumerStore: store, products: [business], cart: [],
    handleAddToCart: (product: any) => { cartProduct = product; }, setIsCartOpen() {}, stores: [store], setActiveConsumerStore() {} };
  const draw = () => { fixture.cursor = 0; return StorefrontPanel(props); };
  draw();
  fixture.effects[0](); // Execute the real catalog subscription effect, then render its resulting state.
  const rendered = draw();
  const legacyPanel = rendered.props.children.at(-1);
  const selection = buildProductConfigurationSelection(legacyPanel.props.products[0], {});
  legacyPanel.props.handleAddToCart(selection);
  assert.equal(fixture.subscriptions, 0, 'the published API catalog must not be replaced by the fallback reader');
  assert.deepEqual(cartProduct.saleModality, business.saleModality);
  assert.deepEqual(cartProduct.contractDiscounts, discounts);
  assert.deepEqual(terms(checkoutHtml(cartProduct)), [1, 3, 6, 12]);
  assert.deepEqual(business.contractDiscounts, discounts, 'ERP discounts remain unchanged');
  assert.match(readFileSync('src/components/PublicStorefrontApp.tsx', 'utf8'), /<StorefrontPanel\s+catalogSource="published-api"/);
});

test('internal live catalogs retain their existing unverified-offer suppression and monthly fallback', () => {
  fixture.states = []; fixture.effects = []; fixture.subscriptions = 0;
  const props = { activeConsumerStore: store, products: [business], cart: [], handleAddToCart() {}, setIsCartOpen() {}, stores: [store], setActiveConsumerStore() {} };
  const draw = () => { fixture.cursor = 0; return StorefrontPanel(props); };
  draw(); fixture.effects[0]();
  const product = draw().props.children.at(-1).props.products[0];
  assert.equal(fixture.subscriptions, 1);
  assert.equal(product.contractDiscounts, undefined);
  assert.deepEqual(terms(checkoutHtml(product)), [1]);
});
