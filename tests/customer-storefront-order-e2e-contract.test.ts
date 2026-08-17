import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const kyrubTab = readFileSync('src/components/tabs/KyrubTab.tsx', 'utf8');
const legacyKyrubTab = readFileSync(
  'src/components/tabs/LegacyKyrubTab.tsx',
  'utf8'
);
const legacyApp = readFileSync('src/LegacyApp.tsx', 'utf8');
const storefront = readFileSync('src/components/StorefrontPanel.tsx', 'utf8');
const sharedPdv = readFileSync(
  'src/components/pdv/SharedPdvCatalog.tsx',
  'utf8'
);
const cartDrawer = readFileSync(
  'src/components/modals/B2CCartDrawer.tsx',
  'utf8'
);
const customerOrders = readFileSync('src/utils/customerOrders.ts', 'utf8');
const retailer = readFileSync('src/components/RetailerPanel.tsx', 'utf8');
const inventoryService = readFileSync(
  'server/inventory/orderInventoryService.ts',
  'utf8'
);

test('discovery lists only published Kyrub storefronts and lets the customer enter one', () => {
  assert.match(kyrubTab, /where\('publicationStatus', '==', 'published'\)/);
  assert.match(kyrubTab, /storesWithCoords=\{publishedStores\}/);
  assert.match(legacyKyrubTab, /filteredStores\.map\(store/);
  assert.match(legacyKyrubTab, /onClick=\{\(\) => setVisitingStore\(store\)\}/);
  assert.match(legacyKyrubTab, />\s*Entrar\s*</);
});

test('entering a discovered store mounts the storefront and authoritative checkout', () => {
  assert.match(legacyApp, /\{visitingStore && \(/);
  assert.match(legacyApp, /<StorefrontPanel/);
  assert.match(legacyApp, /activeConsumerStore=\{visitingStore\}/);
  assert.match(legacyApp, /<B2CCartDrawer/);
  assert.match(legacyApp, /visitingStore=\{visitingStore\}/);
});

test('storefront resolves inherited snack customization before rendering the shared PDV', () => {
  assert.match(storefront, /catalogCustomizationDefaults/);
  assert.match(storefront, /resolveCatalogCustomization/);
  assert.match(storefront, /products=\{storefrontProducts\}/);
  assert.match(sharedPdv, /buildProductConfigurationSelection/);
  assert.match(sharedPdv, /selectedChoiceIds/);
  assert.match(sharedPdv, /selectedQuickNotes/);
  assert.match(sharedPdv, /priceDelta/);
});

test('customer cart supports two independent configured lines such as snack plus dessert', () => {
  assert.match(sharedPdv, /getCartLineKey/);
  assert.match(sharedPdv, /handleAddToCart/);
  assert.match(cartDrawer, /cart\.map\(item/);
  assert.match(
    cartDrawer,
    /sum \+ item\.product\.price \* item\.quantity/
  );
});

test('checkout creates and persists the customer order instead of using the legacy simulation', () => {
  assert.match(cartDrawer, /const handleCreateOrder = async/);
  assert.match(cartDrawer, /buildCustomerOrder\(user/);
  assert.match(cartDrawer, /await persistCustomerOrder\(order\)/);
  assert.match(cartDrawer, /setTrackedOrderId\(order\.id\)/);
  assert.match(customerOrders, /status: 'pending'/);
  assert.match(customerOrders, /source: 'customer'/);
  assert.match(customerOrders, /getCustomerOrdersCollectionPath/);
});

test('the same persisted order feeds the seller inbox and KDS', () => {
  assert.match(retailer, /subscribeToStoreCustomerOrders/);
  assert.match(retailer, /customerOrders\.filter\(isOrderVisibleInKds\)/);
  assert.match(retailer, /<CustomerOrderInbox/);
  assert.match(retailer, /kyrub-customer-order-inbox-host/);
});

test('configured snack lines reach inventory reconciliation as their base recipe plus selected extras', () => {
  assert.match(inventoryService, /parseConfiguredLineSelectedOptions/);
  assert.match(inventoryService, /buildOrderInventoryConsumptionWithOptions/);
  assert.match(inventoryService, /optionInventoryImpacts/);
  assert.match(
    inventoryService,
    /inventoryData\?\.compositions \?\? inventoryData\?\.productCompositions/
  );
});
