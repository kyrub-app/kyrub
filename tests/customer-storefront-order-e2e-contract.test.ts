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
const checkoutClient = readFileSync('src/utils/marketplaceCheckout.ts', 'utf8');
const paymentIntentRouter = readFileSync(
  'server/payments/paymentIntentRouter.ts',
  'utf8'
);
const webhookProcessor = readFileSync(
  'server/payments/paymentWebhookProcessor.ts',
  'utf8'
);
const materialization = readFileSync(
  'src/utils/paymentOrderMaterialization.ts',
  'utf8'
);
const retailer = readFileSync('src/components/RetailerPanel.tsx', 'utf8');
const deliveryOpportunity = readFileSync(
  'server/delivery/deliveryOpportunityRouter.ts',
  'utf8'
);
const deliveryTracking = readFileSync(
  'server/delivery/deliveryTrackingRouter.ts',
  'utf8'
);
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

test('storefront resolves customization before rendering the shared PDV', () => {
  assert.match(storefront, /catalogCustomizationDefaults/);
  assert.match(storefront, /resolveCatalogCustomization/);
  assert.match(storefront, /products=\{storefrontProducts\}/);
  assert.match(sharedPdv, /buildProductConfigurationSelection/);
  assert.match(sharedPdv, /selectedChoiceIds/);
  assert.match(sharedPdv, /selectedQuickNotes/);
  assert.match(sharedPdv, /priceDelta/);
});

test('delivery and pickup create a server-side pending PaymentIntent instead of an operational order', () => {
  assert.match(
    cartDrawer,
    /fulfillmentType === 'delivery' \|\| fulfillmentType === 'pickup'/
  );
  assert.match(cartDrawer, /initiateMarketplaceCheckout\(user/);
  assert.match(checkoutClient, /\/api\/payments\/intents/);
  assert.match(checkoutClient, /productId: item\.product\.id/);
  assert.doesNotMatch(checkoutClient, /price: item\.product\.price/);
  assert.match(paymentIntentRouter, /tenant\?\.publicProducts/);
  assert.match(paymentIntentRouter, /status: 'pending'/);
  assert.match(paymentIntentRouter, /context: 'marketplace'/);
});

test('dine-in remains an attendance order and does not inherit the marketplace payment gate', () => {
  assert.match(cartDrawer, /const order = buildCustomerOrder\(user/);
  assert.match(cartDrawer, /await persistCustomerOrder\(order\)/);
  const marketplaceBranch = cartDrawer.indexOf("fulfillmentType === 'delivery'");
  const directOrderBuild = cartDrawer.indexOf('const order = buildCustomerOrder');
  assert.ok(marketplaceBranch >= 0);
  assert.ok(directOrderBuild > marketplaceBranch);
  assert.match(cartDrawer.slice(marketplaceBranch, directOrderBuild), /return;/);
});

test('only an authoritative paid provider event materializes the marketplace CustomerOrder', () => {
  assert.match(webhookProcessor, /normalizeVerifiedProviderEvent/);
  assert.match(webhookProcessor, /buildPaymentWebhookIdempotencyKey/);
  assert.match(webhookProcessor, /effectiveStatus === 'paid'/);
  assert.match(webhookProcessor, /materializePaidMarketplaceOrder/);
  assert.match(webhookProcessor, /operationalOrderExists/);
  assert.match(materialization, /canMaterializeOperationalOrder/);
  assert.match(materialization, /PAYMENT_REQUIRED_BEFORE_ORDER_MATERIALIZATION/);
  assert.match(materialization, /paymentStatus: 'paid'/);
  assert.match(materialization, /source: 'customer'/);
});

test('the materialized paid order feeds the seller inbox and KDS without a second payment truth', () => {
  assert.match(retailer, /subscribeToStoreCustomerOrders/);
  assert.match(retailer, /customerOrders\.filter\(isOrderVisibleInKds\)/);
  assert.match(retailer, /<CustomerOrderInbox/);
  assert.match(retailer, /kyrub-customer-order-inbox-host/);
  assert.doesNotMatch(retailer, /setPaymentIntent.*paid|isPaid\s*=\s*true/i);
});

test('a ready delivery order can become a courier opportunity tied to the source order', () => {
  assert.match(deliveryOpportunity, /fulfillmentType !== 'delivery'/);
  assert.match(deliveryOpportunity, /\['ready', 'out_for_delivery'\]/);
  assert.match(deliveryOpportunity, /sourceOrderId/);
  assert.match(deliveryOpportunity, /deliveryClaims/);
  assert.match(deliveryOpportunity, /transaction\.create\(claimReference/);
});

test('live GPS stays private and can be read only by buyer, merchant or assigned courier while active', () => {
  assert.match(deliveryTracking, /deliveryTracking/);
  assert.match(deliveryTracking, /router\.get\('\/:deliveryId\/location'/);
  assert.match(deliveryTracking, /order\.buyerId/);
  assert.match(
    deliveryTracking,
    /actorId === storeId \|\| actorId === buyerId \|\| actorId === courierId/
  );
  assert.match(deliveryTracking, /TRACKING_FORBIDDEN/);
  assert.match(deliveryTracking, /deliveryInProgress/);
  assert.match(deliveryTracking, /tracking\?\.active === true/);
  assert.match(deliveryTracking, /json\(\{ deliveryId, active: false \}\)/);
});

test('configured lines still reach inventory reconciliation after the paid-order boundary', () => {
  assert.match(inventoryService, /parseConfiguredLineSelectedOptions/);
  assert.match(inventoryService, /buildOrderInventoryConsumptionWithOptions/);
  assert.match(inventoryService, /optionInventoryImpacts/);
  assert.match(
    inventoryService,
    /inventoryData\?\.compositions \?\? inventoryData\?\.productCompositions/
  );
});
