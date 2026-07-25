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
const storeConfigSource = readFileSync(
  'src/components/modals/StoreConfigModal.tsx',
  'utf8'
);
const storePersistenceSource = readFileSync(
  'src/utils/storePersistence.ts',
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

test('ERP-native filters precede optional store keyword filters', () => {
  const novidadesPosition = storefrontSource.indexOf('Novidades');
  const bestSellerPosition = storefrontSource.indexOf('Mais vendido');
  const keywordMapPosition = storefrontSource.indexOf('storeKeywords.map');

  assert.ok(novidadesPosition >= 0);
  assert.ok(bestSellerPosition > novidadesPosition);
  assert.ok(keywordMapPosition > bestSellerPosition);
  assert.doesNotMatch(storefrontSource, />\s*Todos\s*</);
  assert.match(storefrontSource, /id="storefront-filter-new"/);
  assert.match(storefrontSource, /id="storefront-filter-best-sellers"/);
  assert.match(storefrontSource, /getProductRecency/);
  assert.match(wrapperSource, /CONFIRMED_SALE_STATUSES/);
  assert.match(wrapperSource, /nextSalesByProductId\[item\.productId\]/);
  assert.match(storefrontSource, /salesByProductId\[right\.id\]/);
});

test('store keywords filter products below the offers heading', () => {
  assert.match(storefrontSource, /id="storefront-offers-title"/);
  assert.match(storefrontSource, /id="storefront-keyword-filters"/);
  assert.match(storefrontSource, /storeKeywords\.map/);
  assert.match(storefrontSource, /KEYWORD_FILTER_PREFIX/);
  assert.match(storefrontSource, /searchCorpus\.includes/);
  assert.match(storefrontSource, /filteredOffers\.map/);
});

test('saving store keywords refreshes private state and published marketplace copies', () => {
  assert.match(storeConfigSource, /props\.configStoreKeywords\.split\(','\)/);
  assert.match(storeConfigSource, /persistPrivateUserStore\(user, configuredStore\)/);
  assert.match(storeConfigSource, /resolvePublishedState/);
  assert.match(
    storeConfigSource,
    /setStoreMarketplacePublication\(user, configuredStore, true\)/
  );
  assert.match(storeConfigSource, /kyrub-user-store-saved/);
  assert.match(storeConfigSource, /detail: \{ store: configuredStore \}/);
  assert.match(storePersistenceSource, /keywords: \[\.\.\.\(store\.keywords \?\? \[\]\)\]/);
  assert.match(storePersistenceSource, /keywords: fields\.keywords/);
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
