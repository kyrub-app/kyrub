import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bridge = readFileSync('src/components/store/PaidOrderRefundBridge.tsx', 'utf8');
const router = readFileSync('server/payments/storePaymentRefundRouter.ts', 'utf8');
const guard = readFileSync('server/payments/partialRefundSafetyService.ts', 'utf8');

test('paid but unrefunded cancelled order remains visible as an unresolved financial obligation', () => {
  assert.match(bridge, /order\.status === 'rejected' \|\| order\.status === 'cancelled'/);
  assert.match(bridge, /order\.paymentStatus === 'paid'/);
  assert.match(bridge, /order\.refundStatus !== 'refunded'/);
  assert.match(bridge, /Reembolso necessário/);
  assert.match(bridge, /Pendência financeira · ver detalhes/);
});

test('dismissal minimizes overlay rather than erasing payment, refund or order state', () => {
  assert.match(bridge, /minimizedRefundOrderId === active\.id/);
  assert.match(bridge, /setMinimizedRefundOrderId\(active\.id\)/);
  assert.match(bridge, /setMinimizedRefundOrderId\(null\)/);
  assert.match(bridge, /Minimizar aviso de reembolso/);
  assert.match(bridge, /Reabrir pendência financeira do pedido/);
  assert.doesNotMatch(bridge, /updateDoc\(.*refundStatus/);
});

test('a missing/zero operational amount is not presented as a real refund of R$ 0', () => {
  assert.match(bridge, /operationalRefundDisplayAmount/);
  assert.match(bridge, /Valor a conferir/);
  assert.match(bridge, /Valor do reembolso a conferir/);
  assert.match(bridge, /selectedDisplayAmount === null/);
  assert.match(bridge, /disabled=\{busy \|\| !reason\.trim\(\) \|\| selectedDisplayAmount === null\}/);
  assert.match(bridge, /servidor usa a cobrança canônica/);
});

test('refund safety gate remains unchanged for uncertain partial refund histories', () => {
  assert.match(router, /await assertFullRefundHasNoConfirmedPartialHistory\(\{ storeId, orderId \}\)/);
  assert.match(guard, /PAYMENT_REFUND_PARTIAL_HISTORY_REVIEW_REQUIRED/);
  assert.match(guard, /PAYMENT_REFUND_PARTIAL_HISTORY_REQUIRES_RESIDUAL/);
});

test('owner-only read-only diagnostic compares operational order and canonical payment scopes without refunding', () => {
  const diagnostic = readFileSync('server/payments/orderRefundReadOnlyDiagnosis.ts', 'utf8');
  assert.match(router, /router\.get\('\/diagnostic'/);
  assert.match(router, /await requireOwner\(request\.get\('authorization'\) \?\? '', storeId\)/);
  assert.match(router, /diagnoseOrderRefundReadOnly\(\{ storeId, orderId \}\)/);
  assert.match(diagnostic, /artifacts\/.*\/public\/data\/customerOrders/);
  assert.match(diagnostic, /paymentPartialRefunds/);
  assert.match(diagnostic, /stores\/.*\/payments/);
  assert.match(diagnostic, /\.limit\(51\)/);
  assert.match(diagnostic, /\.limit\(11\)/);
  assert.match(diagnostic, /source: 'firestore_read_only'/);
  assert.doesNotMatch(diagnostic, /providerRequest|requestCanonicalOrderRefund|fetchProviderPayment/);
  assert.doesNotMatch(diagnostic, /transaction\.update|transaction\.set|batch\.write|\.update\(|\.delete\(/);
  assert.match(bridge, /Conferir cobrança e histórico \(somente leitura\)/);
  assert.match(bridge, /selectedDisplayAmount === null/);
});

test('extended refund diagnostics remain scrollable in mobile viewport', () => {
  assert.match(bridge, /max-h-\[92dvh\] w-full max-w-md overflow-y-auto overscroll-contain/);
  assert.match(bridge, /Conferir cobrança e histórico \(somente leitura\)/);
});

test('financial diagnostic flags use readable Portuguese rather than raw internal codes', () => {
  assert.match(bridge, /REFUND_BLOCKER_LABELS/);
  assert.match(bridge, /tentativa de reembolso parcial ainda não conciliada/);
  assert.match(bridge, /REFUND_PAYMENT_STATUS_LABELS/);
  assert.match(bridge, /diagnostic\.blockers\.map\(code => REFUND_BLOCKER_LABELS\[code\]/);
});
