import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const client = readFileSync('src/utils/localPixCheckout.ts', 'utf8');
const panel = readFileSync(
  'src/components/store/ServiceLocationFinancialContextPanel.tsx',
  'utf8'
);

test('browser Pix client sends only scope, idempotency and opaque payment ids', () => {
  assert.match(client, /\/api\/local-attendance\/payment-intents\/pending/);
  assert.match(client, /\/api\/local-attendance\/payment-intents'/);
  assert.match(client, /\/api\/local-attendance\/payment-intents\/mercado-pago-pix/);
  assert.match(client, /\/api\/local-attendance\/payment-intents\/store-pix/);
  assert.match(client, /storeId: input\.storeId/);
  assert.match(client, /orderId: input\.orderId/);
  assert.match(client, /idempotencyKey: input\.idempotencyKey/);
  assert.match(client, /paymentIntentId: input\.paymentIntentId/);
  assert.match(client, /paymentId: input\.paymentId/);
  assert.doesNotMatch(client, /amount: input\./);
  assert.doesNotMatch(client, /email: input\./);
  assert.doesNotMatch(client, /buyerId: input\./);
  assert.doesNotMatch(client, /firebase\/firestore|setDoc|updateDoc|addDoc/);
});

test('service location Pix action recovers pending payment before creating a new attempt', () => {
  assert.match(panel, /loadPendingLocalPayment\(\{/);
  assert.match(panel, /if \(!pending\) \{/);
  assert.match(panel, /createLocalPaymentIntent\(\{/);
  assert.match(panel, /newLocalPaymentAttemptKey\(order\.id\)/);
  assert.match(panel, /attachLocalMercadoPagoPix\(\{/);
  assert.match(panel, /attachLocalStoreOwnedPix\(\{/);
  const recoveryIndex = panel.indexOf('loadPendingLocalPayment({');
  const creationIndex = panel.indexOf('createLocalPaymentIntent({');
  const mercadoPagoIndex = panel.indexOf('attachLocalMercadoPagoPix({');
  const storePixIndex = panel.indexOf('attachLocalStoreOwnedPix({');
  assert.ok(recoveryIndex >= 0 && creationIndex > recoveryIndex);
  assert.ok(mercadoPagoIndex > creationIndex && storePixIndex > creationIndex);
});

test('Pix UI never claims payment merely because a QR was generated', () => {
  assert.match(panel, /context\.state === 'paid'/);
  assert.match(panel, /Pix aguardando confirmação/);
  assert.match(panel, /webhook verificado do Mercado Pago/);
  assert.match(panel, /Confirmação manual — o Kyrub não consultou o banco/);
  assert.match(panel, /confirmLocalStoreOwnedPix/);
  assert.match(panel, /confirmedCredit/);
  assert.doesNotMatch(panel, /paymentStatus\s*=/);
  assert.doesNotMatch(panel, /paidQuantity\s*=/);
  assert.doesNotMatch(panel, /registerTablePayment/);
});

test('Pix UI exposes provider-specific QR only after explicit user action', () => {
  assert.match(panel, /onClick=\{\(\) => void preparePix\(order, context, 'mercado-pago'\)\}/);
  assert.match(panel, /onClick=\{\(\) => void preparePix\(order, context, 'store-pix'\)\}/);
  assert.match(panel, /qrCodeBase64/);
  assert.match(panel, /qrCode/);
  assert.match(panel, /navigator\.clipboard\.writeText/);
  assert.match(panel, /safeTicketUrl/);
  assert.match(panel, /startsWith\('https:\/\/'\)/);
  assert.doesNotMatch(panel, /useEffect\([^]*attachLocalMercadoPagoPix/);
  assert.doesNotMatch(panel, /useEffect\([^]*attachLocalStoreOwnedPix/);
});
