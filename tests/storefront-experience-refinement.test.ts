import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapperSource = readFileSync(
  'src/components/StorefrontPanel.tsx',
  'utf8'
);
const storefrontSource = readFileSync(
  'src/components/LegacyStorefrontPanel.tsx',
  'utf8'
);

test('storefront movement indicator uses live KDS order load', () => {
  assert.match(wrapperSource, /subscribeToStoreCustomerOrders/);
  assert.match(wrapperSource, /'pending'/);
  assert.match(wrapperSource, /'accepted'/);
  assert.match(wrapperSource, /'preparing'/);
  assert.match(wrapperSource, /'ready'/);
  assert.match(storefrontSource, /activeKdsOrderCount > 20/);
  assert.match(storefrontSource, /activeKdsOrderCount > 10/);
  assert.match(storefrontSource, /text-orange-500/);
  assert.match(storefrontSource, /text-amber-400/);
  assert.match(storefrontSource, /text-emerald-400/);
  assert.match(storefrontSource, /text-slate-400/);
  assert.match(storefrontSource, /<Zap/);
});

test('store logo opens public store information without private contact data', () => {
  assert.match(storefrontSource, /id="storefront-store-info-trigger"/);
  assert.match(storefrontSource, /id="storefront-store-info-modal"/);
  assert.match(storefrontSource, /activeConsumerStore\.description/);
  assert.match(storefrontSource, /activeConsumerStore\.address/);
  assert.doesNotMatch(storefrontSource, /activeConsumerStore\.contact/);
  assert.doesNotMatch(storefrontSource, /activeConsumerStore\.ownerEmail/);
});

test('store keywords filter products below the offers heading', () => {
  assert.match(storefrontSource, /id="storefront-offers-title"/);
  assert.match(storefrontSource, /id="storefront-keyword-filters"/);
  assert.match(storefrontSource, /storeKeywords\.map/);
  assert.match(storefrontSource, /searchCorpus\.includes/);
  assert.match(storefrontSource, /filteredOffers\.map/);
});

test('selected items replace the old cart strip and use a send-only action', () => {
  assert.match(storefrontSource, /id="storefront-selected-items"/);
  assert.match(storefrontSource, /Itens adicionados/);
  assert.match(storefrontSource, /cart\.map/);
  assert.match(storefrontSource, /id="storefront-send-selection-btn"/);
  assert.match(storefrontSource, /<Send className="h-4 w-4"/);
  assert.match(
    storefrontSource,
    /aria-label="Revisar e enviar itens para aprovação da loja"/
  );
});
