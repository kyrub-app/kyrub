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
const checkoutSource = readFileSync(
  'src/components/modals/B2CCartDrawer.tsx',
  'utf8'
);
const productModalSource = readFileSync(
  'src/components/modals/NewProductModal.tsx',
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
const publicProductsSource = readFileSync(
  'src/utils/publicProducts.ts',
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

test('store keywords open exact root categories below the offers heading', () => {
  assert.match(storefrontSource, /id="storefront-offers-title"/);
  assert.match(storefrontSource, /id="storefront-keyword-filters"/);
  assert.match(storefrontSource, /storeKeywords\.map/);
  assert.match(storefrontSource, /KEYWORD_FILTER_PREFIX/);
  assert.match(storefrontSource, /categoryStartsWithPath\(product\.category/);
  assert.match(storefrontSource, /setCollectionPath\(\[keyword\]\)/);
  assert.match(storefrontSource, /filteredOffers\.map/);
});

test('hierarchical categories render iFood-style collection navigation', () => {
  assert.match(storefrontSource, /id="storefront-collection-browser"/);
  assert.match(storefrontSource, /id="storefront-collection-breadcrumb"/);
  assert.match(storefrontSource, /id="storefront-subcategory-collections"/);
  assert.match(storefrontSource, /buildChildCollections/);
  assert.match(storefrontSource, /Navegue pelas coleções/);
  assert.match(storefrontSource, /setCollectionPath\(collection\.segments\)/);
  assert.match(storefrontSource, /activeCollectionPath\.slice\(0, index \+ 1\)/);
  assert.match(storefrontSource, /collection\.itemCount/);
});

test('collection cards prefer staff media and fall back to a product photo', () => {
  assert.match(storefrontSource, /findCollectionImage/);
  assert.match(storefrontSource, /product\.categoryCollections\?\.find/);
  assert.match(storefrontSource, /configuredImage\?\.trim\(\) \|\| product\.image\.trim\(\)/);
  assert.match(storefrontSource, /collection\.image/);
  assert.match(storefrontSource, /<FolderOpen/);
});

test('staff can attach Google Photos or Drive media to each subcategory level', () => {
  assert.match(productModalSource, /type SubcategoryDraft/);
  assert.match(productModalSource, /categoryCollections/);
  assert.match(productModalSource, /id="product-subcategory-media-list"/);
  assert.match(productModalSource, /Subcategorias e coleções/);
  assert.match(productModalSource, /Imagem da coleção/);
  assert.match(productModalSource, /<GooglePhotosImagePickerButton/);
  assert.match(productModalSource, /<GoogleDriveImagePickerButton/);
  assert.match(productModalSource, /categoryCollections,/);
  assert.match(publicProductsSource, /parseProductCategoryCollections/);
  assert.match(publicProductsSource, /categoryCollections: parseProductCategoryCollections/);
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

test('selected items keep send action and expose an always-available customer panel shortcut', () => {
  assert.match(storefrontSource, /id="storefront-selected-items"/);
  assert.match(storefrontSource, /Itens adicionados/);
  assert.match(storefrontSource, /cart\.map/);
  assert.match(storefrontSource, /id="storefront-send-selection-btn"/);
  assert.match(storefrontSource, /<Send className="h-4 w-4"/);
  assert.match(wrapperSource, /storefront-customer-panel-host/);
  assert.match(wrapperSource, /id="storefront-customer-panel-btn"/);
  assert.match(wrapperSource, /<ReceiptText className="h-4 w-4"/);
  assert.match(wrapperSource, /props\.setIsCartOpen\(true\)/);
  assert.match(
    wrapperSource,
    /aria-label="Abrir finalizar pedido, meu pedido e conta"/
  );
});

test('customer checkout panel offers cart, order and account tabs in that order', () => {
  const cartPosition = checkoutSource.indexOf('id="customer-cart-tab"');
  const orderPosition = checkoutSource.indexOf('id="customer-order-tab"');
  const accountPosition = checkoutSource.indexOf('id="customer-account-tab"');

  assert.ok(cartPosition >= 0);
  assert.ok(orderPosition > cartPosition);
  assert.ok(accountPosition > orderPosition);
  assert.match(checkoutSource, /grid-cols-3/);
  assert.match(checkoutSource, /Finalizar pedido/);
  assert.match(checkoutSource, /Meu pedido/);
  assert.match(checkoutSource, />Conta</);
});

test('account tab tracks consumed, paid, transferred and outstanding amounts in realtime', () => {
  assert.match(checkoutSource, /id="customer-account-panel"/);
  assert.match(checkoutSource, /getCustomerOrderOutstandingTotal\(currentOrder\)/);
  assert.match(checkoutSource, /getCustomerOrderItemOpenQuantity\(item\)/);
  assert.match(checkoutSource, /Consumo total/);
  assert.match(checkoutSource, /Em aberto/);
  assert.match(checkoutSource, /Pago/);
  assert.match(checkoutSource, /Transferido/);
  assert.match(checkoutSource, /Total para fechamento/);
  assert.match(checkoutSource, /A forma de pagamento e o fechamento são confirmados pela loja/);
});
