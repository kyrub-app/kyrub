import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string): string => readFileSync(path, 'utf8');

const refundService = read('server/payments/paymentRefundService.ts');
const refundRouter = read('server/payments/storePaymentRefundRouter.ts');
const transport = read('server/payments/storePromotionServerlessTransport.ts');
const refundBridge = read('src/components/store/PaidOrderRefundBridge.tsx');

test('full Mercado Pago refund stays canonical, idempotent and separate from manual cash', () => {
  assert.match(
    refundService,
    /\/v1\/payments\/\$\{encodeURIComponent\(payment\.providerPaymentId\)\}\/refunds/
  );
  assert.match(refundService, /X-Idempotency-Key/);
  assert.match(refundService, /refund_requested/);
  assert.match(refundService, /refund_processing/);
  assert.match(refundService, /refund_failed/);
  assert.match(refundService, /processVerifiedPaymentWebhook/);
  assert.match(refundService, /orderStatus !== 'rejected'.*orderStatus !== 'cancelled'/s);
  assert.doesNotMatch(
    refundService,
    /body:\s*JSON\.stringify\(\{\s*amount:/,
    'full refund must not become a partial refund payload'
  );

  assert.match(refundRouter, /loadOwnerStoreInstitutionalRepresentation/);
  assert.match(transport, /surface === 'refunds'/);
  assert.match(transport, /createStorePaymentRefundRouter/);

  assert.match(refundBridge, /Reembolso necessário/);
  assert.match(refundBridge, /não como saída manual de caixa/i);
  assert.match(refundBridge, /Confirmar reembolso/);
  assert.match(refundBridge, /Verificar reembolso/);
});
