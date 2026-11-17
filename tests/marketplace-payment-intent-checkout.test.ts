import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './mercado-pago-current-main-contract.test';
import { buildProductConfigurationSelection } from '../src/utils/productCustomization';
import type { Product } from '../src/types';
import { assertMarketplaceCheckoutQuoteUnchanged, priceMarketplaceCheckoutItems, type MarketplaceCatalogPricingProduct } from '../server/payments/marketplaceItemPricing';
import { parseCatalogCustomizationDefaults, resolveCatalogCustomization } from '../src/utils/catalogCustomizationInheritance';

const drawerSource = readFileSync(
  'src/components/modals/B2CCartDrawer.tsx',
  'utf8'
);
const approvalBaseSource = readFileSync(
  'src/components/modals/B2CCartDrawerApprovalBase.tsx',
  'utf8'
);
const checkoutClientSource = readFileSync(
  'src/utils/marketplaceCheckout.ts',
  'utf8'
);
const approvedPaymentSource = readFileSync(
  'src/utils/marketplaceApprovedPayment.ts',
  'utf8'
);
const intentRouterSource = readFileSync(
  'server/payments/paymentIntentRouter.ts',
  'utf8'
);
const checkoutBridgeSource = readFileSync(
  'server/payments/mercadoPagoCheckoutBridge.ts',
  'utf8'
);
const settlementSource = readFileSync(
  'server/payments/marketplaceOrderPaymentSettlementService.ts',
  'utf8'
);
const vercelActionSource = readFileSync('api/action-execute.ts', 'utf8');
const vercelConfig = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  rewrites?: Array<{ source?: string; destination?: string }>;
};
const serverSource = readFileSync('server.ts', 'utf8');
const materializationSource = readFileSync(
  'src/utils/paymentOrderMaterialization.ts',
  'utf8'
);



test('new first-store order quote rejects a changed price or option amount before financial commit', () => {
  const quote = [{
    productId: 'meal::options=extras:cheese', sourceProductId: 'meal',
    name: 'Refeição', quantity: 2, unitPrice: 38, total: 76,
    note: '', image: '', isService: false, storePointsPerUnit: 0,
  }];
  assert.doesNotThrow(() => assertMarketplaceCheckoutQuoteUnchanged(quote, [...quote]));
  assert.throws(() => assertMarketplaceCheckoutQuoteUnchanged(quote, [{
    ...quote[0], unitPrice: 39, total: 78,
  }]), /CHECKOUT_PUBLISHED_OFFER_CHANGED/);
  assert.throws(() => assertMarketplaceCheckoutQuoteUnchanged(quote, [{
    ...quote[0], storePointsPerUnit: 4,
  }]), /CHECKOUT_PUBLISHED_OFFER_CHANGED/);
  assert.throws(() => assertMarketplaceCheckoutQuoteUnchanged(quote, []),
    /CHECKOUT_PUBLISHED_OFFER_CHANGED/);
  assert.match(intentRouterSource, /const listing = await transaction\.get\(/);
  assert.match(intentRouterSource, /const canonical = await transaction\.get\(/);
  assert.match(intentRouterSource, /transaction\.get\(adminDb\.doc\(`stores\/\$\{canonicalId\}\/products\/\$\{id\}\`\)\)/);
  assert.match(intentRouterSource, /await assertFreshVerifiedFirstStoreQuote\(/);
  assert.match(intentRouterSource, /assertMarketplaceCheckoutQuoteUnchanged\(/);
});

test('authoritative pricing for configured cart items ignores forged browser amounts', () => {
  const product = {
    id: 'meal', name: 'Refeição', description: '', price: 30, image: '',
    category: 'Almoço > Pratos', stock: 8, supplierId: 'owner',
    optionGroups: [{
      id: 'extras', name: 'Extras', minSelections: 1, maxSelections: 1,
      choices: [{ id: 'cheese', name: 'Queijo', priceDelta: 8 }],
    }],
  } as Product;
  const selection = buildProductConfigurationSelection(product, { extras: ['cheese'] });
  const catalog: MarketplaceCatalogPricingProduct[] = [{
    id: product.id, name: product.name, price: product.price, image: product.image,
    category: product.category, isService: false, isComplimentary: false,
    storePointsPerUnit: 0, optionGroups: product.optionGroups!, quickNotes: [],
  }];
  const items = priceMarketplaceCheckoutItems(catalog, [{
    productId: selection.id, quantity: 2, note: '',
    selectedOptions: [{ groupId: 'extras', choiceId: 'cheese' }],
    selectedQuickNotes: [], customerNote: '',
    price: 0.01,
  } as Parameters<typeof priceMarketplaceCheckoutItems>[1][number]]);
  assert.equal(items[0].sourceProductId, 'meal');
  assert.equal(items[0].productId, selection.id);
  assert.equal(items[0].unitPrice, 38);
  assert.equal(items[0].total, 76);
});

test('server refuses selected extras not in published groups or missing required choices', () => {
  const catalog: MarketplaceCatalogPricingProduct[] = [{
    id: 'meal', name: 'Refeição', price: 30, image: '', category: 'Almoço',
    isService: false, isComplimentary: false, storePointsPerUnit: 0,
    optionGroups: [{
      id: 'extras', name: 'Extras', minSelections: 1, maxSelections: 1,
      choices: [{ id: 'cheese', name: 'Queijo', priceDelta: 7 }],
    }],
    quickNotes: [],
  }];
  const entry = (productId: string, choiceId: string) => [{
    productId, quantity: 1, selectedOptions: [{ groupId: 'extras', choiceId }],
    selectedQuickNotes: [], customerNote: '',
  }];
  assert.throws(() =>
    priceMarketplaceCheckoutItems(catalog, entry('meal::options=extras:fake', 'fake')),
    /CHECKOUT_ITEM_CONFIGURATION_INVALID/);
  assert.throws(() =>
    priceMarketplaceCheckoutItems(catalog, entry('meal', 'cheese')),
    /CHECKOUT_ITEM_CONFIGURATION_INVALID/);
  assert.throws(() =>
    priceMarketplaceCheckoutItems(catalog, entry('meal', 'fake')),
    /CHECKOUT_ITEM_CONFIGURATION_INVALID/);
  assert.throws(() =>
    priceMarketplaceCheckoutItems(catalog, [{
      productId: 'meal', quantity: 1, selectedOptions: [],
      selectedQuickNotes: [], customerNote: '',
    }]), /CHECKOUT_ITEM_CONFIGURATION_INVALID/);
  assert.throws(() =>
    priceMarketplaceCheckoutItems(catalog, [{
      productId: 'withdrawn', quantity: 1, selectedOptions: [],
      selectedQuickNotes: [], customerNote: '',
    }]), /CHECKOUT_PRODUCT_NOT_AVAILABLE/);
});

test('server respects published category-wide customization defaults and surcharges', () => {
  const defaults = parseCatalogCustomizationDefaults([{
    path: 'Almoço > Pratos',
    quickNotes: ['Sem sal'],
    optionGroups: [{
      id: 'sauce', name: 'Molho', minSelections: 1, maxSelections: 1,
      choices: [{ id: 'hot', name: 'Picante', priceDelta: 4 }],
    }],
  }]);
  const resolved = resolveCatalogCustomization({
    category: 'Almoço > Pratos > Executivo',
    optionGroups: undefined, quickNotes: undefined,
  }, defaults);
  assert.equal(resolved.optionGroups[0].choices[0].priceDelta, 4);
  assert.deepEqual(resolved.quickNotes, ['Sem sal']);
  const priced = priceMarketplaceCheckoutItems([{
    id: 'meal', name: 'Refeição', price: 20, image: '',
    category: 'Almoço > Pratos > Executivo',
    isService: false, isComplimentary: false, storePointsPerUnit: 0,
    ...resolved,
  }], [{
    productId: 'meal::options=sauce:hot', quantity: 1,
    selectedOptions: [{ groupId: 'sauce', choiceId: 'hot' }],
    selectedQuickNotes: [], customerNote: '',
  }]);
  assert.equal(priced[0].unitPrice, 24);
});

test('configured coupons target source product while discount allocation targets actual order line', () => {
  assert.match(checkoutClientSource, /selectedOptions: \(item\.product\.selectedOptions/);
  assert.match(checkoutClientSource, /choiceId: option\.choiceId/);
  assert.doesNotMatch(checkoutClientSource, /price: item\.product\.price/);
  assert.match(intentRouterSource, /priceMarketplaceCheckoutItems\(catalog, items\)/);
  assert.match(intentRouterSource, /productId: item\.sourceProductId/);
  assert.match(intentRouterSource, /\.map\(item => item\.productId\)/);
  assert.match(intentRouterSource, /resolveCatalogCustomization\(product, defaults\)/);
  assert.match(intentRouterSource, /item\.productId\.split\('::', 1\)\[0\]/);
});

test('delivery and pickup materialize an unpaid approval-gated order without creating Pix before merchant acceptance', () => {
  assert.match(
    approvalBaseSource,
    /fulfillmentType === 'delivery' \|\| fulfillmentType === 'pickup'/
  );
  assert.match(approvalBaseSource, /initiateMarketplaceCheckout\(user/);
  assert.match(intentRouterSource, /materializePendingMarketplaceOrder/);
  assert.match(intentRouterSource, /transaction\.set\(orderRef, pendingOrder\)/);
  assert.match(materializationSource, /checkoutAuthority: 'merchant_approval_required'/);
  assert.match(materializationSource, /paymentStatus: paid \? 'paid' : 'unpaid'/);
  assert.match(checkoutBridgeSource, /if \(status === 'pending'\)/);
  assert.match(checkoutBridgeSource, /approvalRequired: true/);
  assert.match(checkoutBridgeSource, /if \(approval\.approvalRequired\)/);
  assert.match(checkoutBridgeSource, /return emptyBridge\(intent\.expiresAt/);

  const approvalGate = checkoutBridgeSource.indexOf('if (approval.approvalRequired)');
  const providerCreation = checkoutBridgeSource.indexOf('createStoreScopedMercadoPagoMarketplacePix({');
  assert.ok(approvalGate >= 0);
  assert.ok(providerCreation > approvalGate);
});

test('dine-in keeps the direct attendance-order path outside the marketplace payment gate', () => {
  assert.match(approvalBaseSource, /const order = buildCustomerOrder/);
  assert.match(approvalBaseSource, /await persistCustomerOrder\(order\)/);
  assert.match(approvalBaseSource, /No local/);
  assert.doesNotMatch(drawerSource, /const order = buildCustomerOrder/);
});

test('accepted marketplace order exposes an explicit buyer action that resumes the existing payment intent', () => {
  assert.match(drawerSource, /approvalGatedOrder\?\.status === 'accepted'/);
  assert.match(drawerSource, /approvalGatedOrder\?\.paymentStatus !== 'paid'/);
  assert.match(drawerSource, /resumeMarketplaceApprovedPayment/);
  assert.match(drawerSource, /Pagar agora por Pix/);
  assert.match(approvedPaymentSource, /resumeOrderId: input\.orderId\.trim\(\)/);
  assert.match(intentRouterSource, /if \(status === 'pending'\) throw new Error\('CHECKOUT_ORDER_APPROVAL_REQUIRED'\)/);
  assert.match(intentRouterSource, /if \(status !== 'accepted'\) throw new Error\('CHECKOUT_ORDER_NOT_PAYABLE'\)/);
});

test('checkout client sends only item identity and quantity, not authoritative prices', () => {
  assert.match(checkoutClientSource, /productId: item\.product\.id/);
  assert.match(checkoutClientSource, /quantity: item\.quantity/);
  assert.doesNotMatch(checkoutClientSource, /price: item\.product\.price/);
  assert.match(checkoutClientSource, /\/api\/payments\/intents/);
  assert.match(checkoutClientSource, /method: 'pix'/);
});


test('verified first-store checkout uses the same published canonical catalog as the public storefront', () => {
  const storefront = readFileSync('server/payments/marketplaceDiscoveryService.ts', 'utf8');

  assert.match(intentRouterSource, /loadVerifiedFirstStorePublishedCatalog/);
  assert.match(intentRouterSource, /marketplace_listings\/\$\{listingId\}/);
  assert.match(intentRouterSource, /listing\.get\('publicationStatus'\) !== 'published'/);
  assert.match(intentRouterSource, /users\/\$\{publicStoreId\}\/stores\/\$\{publicStoreId\}/);
  assert.match(intentRouterSource, /canonicalStore\.get\('firstStoreCreationVerified'\) !== true/);
  assert.match(intentRouterSource, /canonicalStore\.get\('ownerId'\) !== publicStoreId/);
  assert.match(intentRouterSource, /canonicalStore\.get\('publicationStatus'\) !== 'published'/);
  assert.match(intentRouterSource, /projectVerifiedFirstStoreCatalogOffers\(/);
  assert.match(intentRouterSource, /const products = verifiedFirstStoreCatalog \?\? catalogProducts\(tenant\?\.publicProducts\)/);
  assert.match(intentRouterSource, /const products = verifiedFirstStoreCatalog \?\? catalogProducts\(tenant\?\.publicProducts\)/);
  assert.match(storefront, /projectVerifiedFirstStoreCatalogOffers\(canonicalProducts\.docs, verifiedFirstStoreId, storeId\)/);
  assert.match(storefront, /data\.publicationStatus !== 'published'/);
});

test('backend reconstructs marketplace totals from the published store catalog', () => {
  assert.match(intentRouterSource, /const loadPublishedCatalog = async/);
  assert.match(intentRouterSource, /adminDb\.doc\(`tenants\/\$\{storeId\}`\)/);
  assert.match(intentRouterSource, /tenant\?\.publicationStatus !== 'published'/);
  assert.match(intentRouterSource, /catalogProducts\(tenant\?\.publicProducts\)/);
  assert.match(intentRouterSource, /const catalog = await loadPublishedCatalog\(input\.storeId\)/);
  assert.match(intentRouterSource, /priceMarketplaceCheckoutItems\(catalog, items\)/);
  assert.match(readFileSync('server/payments/marketplaceItemPricing.ts', 'utf8'), /unitPrice,/);
  assert.match(intentRouterSource, /CHECKOUT_PRODUCT_NOT_AVAILABLE/);
});

test('coupon pricing is reconstructed on the backend and snapshotted before merchant approval', () => {
  assert.match(intentRouterSource, /resolveStorePromotionForCheckout/);
  assert.match(intentRouterSource, /couponCode: normalizePromotionCode/);
  assert.match(intentRouterSource, /discountTotal = resolvedPromotion\?\.quote\.discountTotal/);
  assert.match(intentRouterSource, /promotionSnapshot: resolvedPromotion/);
  assert.match(intentRouterSource, /amount = Number\(\(subtotal - discountTotal\)\.toFixed\(2\)\)/);
  assert.match(checkoutClientSource, /couponCode: input\.couponCode\?\.trim\(\) \?\? ''/);
  assert.doesNotMatch(checkoutClientSource, /discountTotal:\s*input/);
});

test('backend atomically creates pending PaymentIntent, Payment and approval-gated operational order with idempotency', () => {
  assert.match(intentRouterSource, /status: 'pending'/);
  assert.match(intentRouterSource, /context: 'marketplace'/);
  assert.match(intentRouterSource, /paymentIntents\/\$\{intentId\}/);
  assert.match(intentRouterSource, /payments\/\$\{paymentId\}/);
  assert.match(intentRouterSource, /adminDb\.runTransaction/);
  assert.match(intentRouterSource, /existingIntent/);
  assert.match(intentRouterSource, /existingPayment/);
  assert.match(intentRouterSource, /existingOrder/);
  assert.match(intentRouterSource, /idempotencyKey/);
  assert.match(intentRouterSource, /providerReady: false/);
  assert.match(intentRouterSource, /transaction\.set\(orderRef, pendingOrder\)/);
  assert.doesNotMatch(intentRouterSource, /simulat|mock.*success|isMockGatewaySuccessful/i);
});

test('Express and Vercel expose payment intent plus Mercado Pago webhook without adding a function', () => {
  assert.match(serverSource, /createPaymentIntentRouter/);
  assert.match(serverSource, /"\/api\/payments"/);
  assert.match(intentRouterSource, /attachMercadoPagoPixToExistingIntent/);
  assert.match(intentRouterSource, /router\.post\('\/webhooks\/mercado-pago'/);
  assert.match(intentRouterSource, /processMercadoPagoWebhook/);

  const paymentIntentRewrite = vercelConfig.rewrites?.find(
    rewrite => rewrite.source === '/api/payments/intents'
  );
  assert.deepEqual(paymentIntentRewrite, {
    source: '/api/payments/intents',
    destination: '/api/action-execute?transport=marketplace-payment-intent',
  });

  const mercadoPagoWebhookRewrite = vercelConfig.rewrites?.find(
    rewrite => rewrite.source === '/api/payments/webhooks/mercado-pago'
  );
  assert.deepEqual(mercadoPagoWebhookRewrite, {
    source: '/api/payments/webhooks/mercado-pago',
    destination: '/api/action-execute?transport=mercado-pago-webhook',
  });

  assert.match(vercelActionSource, /transport === 'marketplace-payment-intent'/);
  assert.match(vercelActionSource, /attachMercadoPagoPixToExistingIntent/);
  assert.match(vercelActionSource, /transport === 'mercado-pago-webhook'/);
  assert.match(vercelActionSource, /processMercadoPagoWebhook/);
});

test('paid settlement requires the same accepted operational order before marking it paid', () => {
  assert.match(settlementSource, /order\.status !== 'accepted' && !\(prepaid && order\.status === 'pending'\)/);
  assert.match(settlementSource, /approval: order\.status === 'pending' \? 'pending' : 'approved'/);
  assert.match(settlementSource, /fulfillmentAuthorized \? confirmation : null/);
  assert.match(settlementSource, /PAYMENT_ORDER_SETTLEMENT_REQUIRES_ACCEPTED_ORDER/);
  assert.match(settlementSource, /settleExistingMarketplaceOrder/);
  assert.match(materializationSource, /paymentStatus: 'paid'/);
});

test('marketplace materialization preserves checkout item metadata', () => {
  assert.match(materializationSource, /note: item\.note \?\? ''/);
  assert.match(materializationSource, /image: item\.image \?\? ''/);
  assert.match(materializationSource, /isService: item\.isService === true/);
});
