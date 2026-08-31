import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(path, 'utf8');
const wrapperSource = source('src/components/StorefrontPanel.tsx');
const storefrontSource = source('src/components/LegacyStorefrontPanel.tsx');
const publicStorefrontSource = source('src/components/PublicStorefrontApp.tsx');
const storefrontEventsSource = source('src/utils/storefrontEvents.ts');
const sharedPdvSource = source('src/components/pdv/SharedPdvCatalog.tsx');
const staffPdvSource = source('src/components/customer/TableServiceWorkspace.tsx');
const checkoutSource = source('src/components/modals/B2CCartDrawer.tsx');
const productModalSource = source('src/components/modals/NewProductModal.tsx');
const storeConfigSource = source('src/components/modals/StoreConfigModal.tsx');
const storePersistenceSource = source('src/utils/storePersistence.ts');
const publicProductsSource = source('src/utils/publicProducts.ts');

const matches = (value: string, patterns: RegExp[]) => patterns.forEach(pattern => assert.match(value, pattern));
const excludes = (value: string, patterns: RegExp[]) => patterns.forEach(pattern => assert.doesNotMatch(value, pattern));

test('storefront movement indicator uses live KDS order load', () => {
  matches(wrapperSource, [/subscribeToStoreCustomerOrders/, /'pending'/, /'accepted'/, /'preparing'/, /'ready'/]);
  matches(storefrontSource, [/activeKdsOrderCount > 20/, /activeKdsOrderCount > 10/, /text-orange-500/, /text-amber-400/, /text-emerald-400/, /text-slate-400/, /<Flame/]);
  excludes(storefrontSource, [/<Zap/]);
});

test('header store logo opens public store information without private contact data', () => {
  matches(publicStorefrontSource, [/id="public-storefront-header-info-trigger"/, /OPEN_PUBLIC_STOREFRONT_INFO_EVENT/]);
  matches(storefrontEventsSource, [/kyrub:open-public-storefront-info/]);
  matches(storefrontSource, [/window\.addEventListener\(\s*OPEN_PUBLIC_STOREFRONT_INFO_EVENT/, /id="storefront-store-info-modal"/, /activeConsumerStore\.description/, /activeConsumerStore\.address/]);
  excludes(storefrontSource, [/activeConsumerStore\.contact/, /activeConsumerStore\.ownerEmail/, /id="storefront-store-info-trigger"/]);
});

test('customer and staff render the same shared PDV catalog', () => {
  matches(storefrontSource, [/<SharedPdvCatalog/, /idPrefix="storefront"/]);
  matches(staffPdvSource, [/<SharedPdvCatalog/, /idPrefix="staff-pdv"/, /id="staff-shared-pdv-view"/]);
  matches(sharedPdvSource, [/PDV de produtos e serviços/, /Itens adicionados/]);
});

test('marked storefront headings and offer counter are removed from both PDV views', () => {
  excludes(storefrontSource, [/Produtos e serviços publicados/, />\s*Ofertas da loja\s*</]);
  excludes(sharedPdvSource, [/Produtos e serviços publicados/, />\s*Ofertas da loja\s*</]);
  excludes(staffPdvSource, [/Buscar no cardápio/, /Pedido do garçom/]);
});

test('ERP-native filters precede optional keyword filters in the shared PDV', () => {
  const novidadesPosition = sharedPdvSource.indexOf('Novidades');
  const bestSellerPosition = sharedPdvSource.indexOf('Mais vendido');
  const keywordMapPosition = sharedPdvSource.indexOf('normalizedKeywords.map');
  assert.ok(novidadesPosition >= 0);
  assert.ok(bestSellerPosition > novidadesPosition);
  assert.ok(keywordMapPosition > bestSellerPosition);
  excludes(sharedPdvSource, [/>\s*Todos\s*</]);
  matches(sharedPdvSource, [/filter-new/, /filter-best-sellers/, /getProductRecency/, /salesByProductId\[right\.id\]/]);
  matches(wrapperSource, [/CONFIRMED_SALE_STATUSES/, /const productId = sourceProductId\(item\.productId\)/, /nextSalesByProductId\[productId\]/]);
});

test('keywords open exact root categories with visual hierarchical collections', () => {
  matches(sharedPdvSource, [/KEYWORD_FILTER_PREFIX/, /categoryStartsWithPath\(product\.category/, /setCollectionPath\(\[keyword\]\)/, /collection-browser/, /collection-breadcrumb/, /subcategory-collections/, /buildChildCollections/, /setCollectionPath\(collection\.segments\)/, /activeCollectionPath\.slice\(0, index \+ 1\)/]);
});

test('collection cards prefer staff media and fall back to a product photo', () => {
  matches(sharedPdvSource, [/findCollectionImage/, /product\.categoryCollections\?\.find/, /configuredImage\?\.trim\(\) \|\| product\.image\.trim\(\)/, /collection\.image/, /<FolderOpen/]);
});

test('staff PDV keeps review, notes and direct KDS submission behind the send icon', () => {
  matches(staffPdvSource, [/setIsReviewOpen\(true\)/, /id="staff-pdv-order-review"/, /Observação do item/, /Observação geral \(opcional\)/, /createStaffTableOrder/, /Enviar ao KDS/, /setView\('account'\)/]);
});

test('staff account and transfer operations stay available without the old top tab bar', () => {
  matches(staffPdvSource, [/id="staff-pdv-account-view"/, /id="staff-pdv-transfer-view"/, /Voltar ao PDV/, /Registrar pagamento/, /Transferir itens/]);
  excludes(staffPdvSource, [/const tabs:/, /grid grid-cols-3 gap-1/]);
});

test('staff can attach Google Photos or Drive media to each subcategory level', () => {
  matches(productModalSource, [/type SubcategoryDraft/, /categoryCollections/, /id="product-subcategory-media-list"/, /Subcategorias e coleções/, /Imagem da coleção/, /<GooglePhotosImagePickerButton/, /<GoogleDriveImagePickerButton/]);
  matches(publicProductsSource, [/parseProductCategoryCollections/]);
});

test('saving store keywords refreshes private state and published marketplace copies', () => {
  matches(storeConfigSource, [/props\.configStoreKeywords\.split\(','\)/, /persistPrivateUserStore\(user, storeToSave\)/, /resolvePublishedState/, /setStoreMarketplacePublication\(user, storeToSave, true\)/, /kyrub-user-store-saved/]);
  matches(storePersistenceSource, [/keywords: \[\.\.\.\(store\.keywords \?\? \[\]\)\]/, /keywords: fields\.keywords/]);
});

test('customer PDV exposes send and account actions directly in the shared selected-items bar', () => {
  matches(storefrontSource, [/primaryAction=\{\{/, /secondaryAction=\{\{/, /Revisar e enviar itens para aprovação da loja/, /Abrir finalizar pedido, meu pedido e conta/]);
  matches(sharedPdvSource, [/send-selection-btn/, /account-btn/, /<Send className="h-4 w-4"/, /<ReceiptText className="h-4 w-4"/]);
  excludes(wrapperSource, [/createPortal/]);
});

test('customer checkout panel offers cart, order and account tabs in that order', () => {
  const cartPosition = checkoutSource.indexOf('id="customer-cart-tab"');
  const orderPosition = checkoutSource.indexOf('id="customer-order-tab"');
  const accountPosition = checkoutSource.indexOf('id="customer-account-tab"');
  assert.ok(cartPosition >= 0);
  assert.ok(orderPosition > cartPosition);
  assert.ok(accountPosition > orderPosition);
  matches(checkoutSource, [/grid-cols-3/, /Finalizar pedido/, /Meu pedido/, />Conta</]);
});

test('account tab tracks consumed, paid, transferred and outstanding amounts in realtime', () => {
  matches(checkoutSource, [/id="customer-account-panel"/, /getCustomerOrderOutstandingTotal\(currentOrder\)/, /getCustomerOrderItemOpenQuantity\(item\)/, /Consumo total/, /Em aberto/, /Pago/, /Transferido/, /Total para fechamento/, /A forma de pagamento e o fechamento são confirmados pela loja/]);
});
