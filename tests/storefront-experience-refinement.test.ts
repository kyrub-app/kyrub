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
const publicStorefrontSource = readFileSync(
  'src/components/PublicStorefrontApp.tsx',
  'utf8'
);
const storefrontEventsSource = readFileSync(
  'src/utils/storefrontEvents.ts',
  'utf8'
);
const sharedPdvSource = readFileSync(
  'src/components/pdv/SharedPdvCatalog.tsx',
  'utf8'
);
const staffPdvSource = readFileSync(
  'src/components/customer/TableServiceWorkspace.tsx',
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
  assert.match(storefrontSource, /<Flame/);
  assert.doesNotMatch(storefrontSource, /<Zap/);
});

test('header store logo opens public store information without private contact data', () => {
  assert.match(
    publicStorefrontSource,
    /id="public-storefront-header-info-trigger"/
  );
  assert.match(publicStorefrontSource, /OPEN_PUBLIC_STOREFRONT_INFO_EVENT/);
  assert.match(
    storefrontEventsSource,
    /kyrub:open-public-storefront-info/
  );
  assert.match(
    storefrontSource,
    /window\.addEventListener\(\s*OPEN_PUBLIC_STOREFRONT_INFO_EVENT/
  );
  assert.match(storefrontSource, /id="storefront-store-info-modal"/);
  assert.match(storefrontSource, /activeConsumerStore\.description/);
  assert.match(storefrontSource, /activeConsumerStore\.address/);
  assert.doesNotMatch(storefrontSource, /activeConsumerStore\.contact/);
  assert.doesNotMatch(storefrontSource, /activeConsumerStore\.ownerEmail/);
  assert.doesNotMatch(storefrontSource, /id="storefront-store-info-trigger"/);
});

test('customer and staff render the same shared PDV catalog', () => {
  assert.match(storefrontSource, /<SharedPdvCatalog/);
  assert.match(storefrontSource, /idPrefix="storefront"/);
  assert.match(staffPdvSource, /<SharedPdvCatalog/);
  assert.match(staffPdvSource, /idPrefix="staff-pdv"/);
  assert.match(staffPdvSource, /id="staff-shared-pdv-view"/);
  assert.match(sharedPdvSource, /PDV de produtos e serviços/);
  assert.match(sharedPdvSource, /Itens adicionados/);
});

test('marked storefront headings and offer counter are removed from both PDV views', () => {
  assert.doesNotMatch(storefrontSource, /Produtos e serviços publicados/);
  assert.doesNotMatch(storefrontSource, />\s*Ofertas da loja\s*</);
  assert.doesNotMatch(sharedPdvSource, /Produtos e serviços publicados/);
  assert.doesNotMatch(sharedPdvSource, />\s*Ofertas da loja\s*</);
  assert.doesNotMatch(staffPdvSource, /Buscar no cardápio/);
  assert.doesNotMatch(staffPdvSource, /Pedido do garçom/);
});

test('ERP-native filters precede optional keyword filters in the shared PDV', () => {
  const novidadesPosition = sharedPdvSource.indexOf('Novidades');
  const bestSellerPosition = sharedPdvSource.indexOf('Mais vendido');
  const keywordMapPosition = sharedPdvSource.indexOf('normalizedKeywords.map');

  assert.ok(novidadesPosition >= 0);
  assert.ok(bestSellerPosition > novidadesPosition);
  assert.ok(keywordMapPosition > bestSellerPosition);
  assert.doesNotMatch(sharedPdvSource, />\s*Todos\s*</);
  assert.match(sharedPdvSource, /filter-new/);
  assert.match(sharedPdvSource, /filter-best-sellers/);
  assert.match(sharedPdvSource, /getProductRecency/);
  assert.match(wrapperSource, /CONFIRMED_SALE_STATUSES/);
  assert.match(wrapperSource, /nextSalesByProductId\[item\.productId\]/);
  assert.match(sharedPdvSource, /salesByProductId\[right\.id\]/);
});

test('keywords open exact root categories with visual hierarchical collections', () => {
  assert.match(sharedPdvSource, /KEYWORD_FILTER_PREFIX/);
  assert.match(sharedPdvSource, /categoryStartsWithPath\(product\.category/);
  assert.match(sharedPdvSource, /setCollectionPath\(\[keyword\]\)/);
  assert.match(sharedPdvSource, /collection-browser/);
  assert.match(sharedPdvSource, /collection-breadcrumb/);
  assert.match(sharedPdvSource, /subcategory-collections/);
  assert.match(sharedPdvSource, /buildChildCollections/);
  assert.match(sharedPdvSource, /setCollectionPath\(collection\.segments\)/);
  assert.match(sharedPdvSource, /activeCollectionPath\.slice\(0, index \+ 1\)/);
});

test('collection cards prefer staff media and fall back to a product photo', () => {
  assert.match(sharedPdvSource, /findCollectionImage/);
  assert.match(sharedPdvSource, /product\.categoryCollections\?\.find/);
  assert.match(
    sharedPdvSource,
    /configuredImage\?\.trim\(\) \|\| product\.image\.trim\(\)/
  );
  assert.match(sharedPdvSource, /collection\.image/);
  assert.match(sharedPdvSource, /<FolderOpen/);
});

test('staff PDV keeps review, notes and direct KDS submission behind the send icon', () => {
  assert.match(staffPdvSource, /setIsReviewOpen\(true\)/);
  assert.match(staffPdvSource, /id="staff-pdv-order-review"/);
  assert.match(staffPdvSource, /Observação do item/);
  assert.match(staffPdvSource, /Observação geral \(opcional\)/);
  assert.match(staffPdvSource, /createStaffTableOrder/);
  assert.match(staffPdvSource, /Enviar ao KDS/);
  assert.match(staffPdvSource, /setView\('account'\)/);
});

test('staff account and transfer operations stay available without the old top tab bar', () => {
  assert.match(staffPdvSource, /id="staff-pdv-account-view"/);
  assert.match(staffPdvSource, /id="staff-pdv-transfer-view"/);
  assert.match(staffPdvSource, /Voltar ao PDV/);
  assert.match(staffPdvSource, /Registrar pagamento/);
  assert.match(staffPdvSource, /Transferir itens/);
  assert.doesNotMatch(staffPdvSource, /const tabs:/);
  assert.doesNotMatch(staffPdvSource, /grid grid-cols-3 gap-1/);
});

test('staff can attach Google Photos or Drive media to each subcategory level', () => {
  assert.match(productModalSource, /type SubcategoryDraft/);
  assert.match(productModalSource, /categoryCollections/);
  assert.match(productModalSource, /id="product-subcategory-media-list"/);
  assert.match(productModalSource, /Subcategorias e coleções/);
  assert.match(productModalSource, /Imagem da coleção/);
  assert.match(productModalSource, /<GooglePhotosImagePickerButton/);
  assert.match(productModalSource, /<GoogleDriveImagePickerButton/);
  assert.match(publicProductsSource, /parseProductCategoryCollections/);
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
  assert.match(storePersistenceSource, /keywords: \[\.\.\.\(store\.keywords \?\? \[\]\)\]/);
  assert.match(storePersistenceSource, /keywords: fields\.keywords/);
});

test('customer PDV exposes send and account actions directly in the shared selected-items bar', () => {
  assert.match(storefrontSource, /primaryAction=\{\{/);
  assert.match(storefrontSource, /secondaryAction=\{\{/);
  assert.match(storefrontSource, /Revisar e enviar itens para aprovação da loja/);
  assert.match(storefrontSource, /Abrir finalizar pedido, meu pedido e conta/);
  assert.match(sharedPdvSource, /send-selection-btn/);
  assert.match(sharedPdvSource, /account-btn/);
  assert.match(sharedPdvSource, /<Send className="h-4 w-4"/);
  assert.match(sharedPdvSource, /<ReceiptText className="h-4 w-4"/);
  assert.doesNotMatch(wrapperSource, /createPortal/);
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
  assert.match(
    checkoutSource,
    /A forma de pagamento e o fechamento são confirmados pela loja/
  );
});
