import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const drawerSource = readFileSync(
  'src/components/modals/B2CCartDrawer.tsx',
  'utf8'
);
const checkoutClientSource = readFileSync(
  'src/utils/marketplaceCheckout.ts',
  'utf8'
);
const intentRouterSource = readFileSync(
  'server/payments/paymentIntentRouter.ts',
  'utf8'
);
const vercelActionSource = readFileSync('api/action-execute.ts', 'utf8');
const vercelConfigSource = readFileSync('vercel.json', 'utf8');
const serverSource = readFileSync('server.ts', 'utf8');
const materializationSource = readFileSync(
  'src/utils/paymentOrderMaterialization.ts',
  'utf8'
);

test('delivery and pickup initiate payment without materializing an order in the browser', () => {
  assert.match(drawerSource, /fulfillmentType === 'delivery' \|\| fulfillmentType === 'pickup'/);
  assert.match(drawerSource, /initiateMarketplaceCheckout\(user/);
  assert.match(drawerSource, /nenhum pedido foi enviado à loja/i);
  assert.match(drawerSource, /Continuar para pagamento Pix/);

  const marketplaceBranch = drawerSource.indexOf("fulfillmentType === 'delivery'");
  const directOrderBuild = drawerSource.indexOf('const order = buildCustomerOrder');
  assert.ok(marketplaceBranch >= 0);
  assert.ok(directOrderBuild > marketplaceBranch);
  assert.match(drawerSource.slice(marketplaceBranch, directOrderBuild), /return;/);
});

test('dine-in keeps the attendance order path', () => {
  assert.match(drawerSource, /const order = buildCustomerOrder/);
  assert.match(drawerSource, /await persistCustomerOrder\(order\)/);
  assert.match(drawerSource, /No local/);
  assert.match(drawerSource, /aprovação do atendimento/);
});

test('checkout client sends only item identity and quantity, not authoritative prices', () => {
  assert.match(checkoutClientSource, /productId: item\.product\.id/);
  assert.match(checkoutClientSource, /quantity: item\.quantity/);
  assert.doesNotMatch(checkoutClientSource, /price: item\.product\.price/);
  assert.match(checkoutClientSource, /\/api\/payments\/intents/);
  assert.match(checkoutClientSource, /method: 'pix'/);
});

test('backend reconstructs marketplace totals from the published store catalog', () => {
  assert.match(intentRouterSource, /adminDb\.doc\(`tenants\/\$\{input\.storeId\}`\)/);
  assert.match(intentRouterSource, /tenant\?\.publicationStatus !== 'published'/);
  assert.match(intentRouterSource, /catalogProducts\(tenant\?\.publicProducts\)/);
  assert.match(intentRouterSource, /product\.price \* item\.quantity/);
  assert.match(intentRouterSource, /unitPrice: product\.price/);
  assert.match(intentRouterSource, /CHECKOUT_PRODUCT_NOT_AVAILABLE/);
});

test('backend atomically creates pending PaymentIntent and Payment with idempotency', () => {
  assert.match(intentRouterSource, /status: 'pending'/);
  assert.match(intentRouterSource, /context: 'marketplace'/);
  assert.match(intentRouterSource, /paymentIntents\/\$\{intentId\}/);
  assert.match(intentRouterSource, /payments\/\$\{paymentId\}/);
  assert.match(intentRouterSource, /adminDb\.runTransaction/);
  assert.match(intentRouterSource, /existingIntent/);
  assert.match(intentRouterSource, /existingPayment/);
  assert.match(intentRouterSource, /idempotencyKey/);
  assert.match(intentRouterSource, /providerReady: false/);
  assert.doesNotMatch(intentRouterSource, /simulat|mock.*success|isMockGatewaySuccessful/i);
});

test('Express and Vercel expose the same marketplace intent core without adding a function', () => {
  assert.match(serverSource, /createPaymentIntentRouter/);
  assert.match(serverSource, /"\/api\/payments"/);
  assert.match(vercelConfigSource, /"source": "\/api\/payments\/intents"/);
  assert.match(
    vercelConfigSource,
    /"destination": "\/api\/action-execute\?transport=marketplace-payment-intent"/
  );
  assert.match(vercelActionSource, /transport === 'marketplace-payment-intent'/);
  assert.match(vercelActionSource, /createMarketplacePaymentIntent/);
  assert.match(vercelActionSource, /mapMarketplaceCheckoutError/);
});

test('paid materialization preserves checkout item metadata', () => {
  assert.match(materializationSource, /note: item\.note \?\? ''/);
  assert.match(materializationSource, /image: item\.image \?\? ''/);
  assert.match(materializationSource, /isService: item\.isService === true/);
});
