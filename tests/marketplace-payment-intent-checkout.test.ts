import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './mercado-pago-current-main-contract.test';

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
  const providerCreation = checkoutBridgeSource.indexOf('createMercadoPagoPixPayment({');
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

test('backend reconstructs marketplace totals from the published store catalog', () => {
  assert.match(intentRouterSource, /const loadPublishedCatalog = async/);
  assert.match(intentRouterSource, /adminDb\.doc\(`tenants\/\$\{storeId\}`\)/);
  assert.match(intentRouterSource, /tenant\?\.publicationStatus !== 'published'/);
  assert.match(intentRouterSource, /catalogProducts\(tenant\?\.publicProducts\)/);
  assert.match(intentRouterSource, /const catalog = await loadPublishedCatalog\(input\.storeId\)/);
  assert.match(intentRouterSource, /product\.price \* item\.quantity/);
  assert.match(intentRouterSource, /unitPrice: product\.price/);
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
  assert.match(settlementSource, /if \(order\.status !== 'accepted'\)/);
  assert.match(settlementSource, /PAYMENT_ORDER_SETTLEMENT_REQUIRES_ACCEPTED_ORDER/);
  assert.match(settlementSource, /settleExistingMarketplaceOrder/);
  assert.match(materializationSource, /paymentStatus: 'paid'/);
});

test('marketplace materialization preserves checkout item metadata', () => {
  assert.match(materializationSource, /note: item\.note \?\? ''/);
  assert.match(materializationSource, /image: item\.image \?\? ''/);
  assert.match(materializationSource, /isService: item\.isService === true/);
});
