import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseProviderRefundListing } from '../shared/mercadoPagoRefundReadOnly';

const read = (path: string) => readFileSync(path, 'utf8');

test('provider refund list may prove no listed refund, never silently settle the failed Firebase attempt', () => {
  assert.deepEqual(parseProviderRefundListing([], 'mp1', 2330).summary, {
    refundCount: 0, approvedRefundCount: 0,
    approvedAmountMinor: 0, uncertainRefundCount: 0, statuses: {},
  });
  const service = read('server/payments/providerRefundReadOnlyDiagnosisService.ts');
  assert.match(service, /failed_partial_still_requires_reconciliation/);
  assert.match(service, /Nenhum reembolso foi solicitado e nenhum registro foi conciliado ou alterado/);
  assert.doesNotMatch(service, /transaction\.|\.update\(|\.set\(|\.delete\(/);
});
test('approved provider refund is counted in cents, not inferred from the Firebase status', () => {
  const result = parseProviderRefundListing([
    {id: 20, payment_id: 'mp1', amount: 7.50, status: 'approved'},
    {id: 21, payment_id: 'mp1', amount: 1.11, status: 'pending'},
  ], 'mp1', 2330);
  assert.equal(result.summary.approvedRefundCount, 1);
  assert.equal(result.summary.approvedAmountMinor, 750);
  assert.equal(result.summary.uncertainRefundCount, 1);
  assert.deepEqual(result.summary.statuses, { approved: 1, pending: 1 });
});
test('documented singleton response is counted, never treated as an empty refunds list', () => {
  const result = parseProviderRefundListing({
    id: 21, payment_id: 'mp1', amount: 4.50, status: 'approved',
  }, 'mp1', 2330);
  assert.equal(result.summary.refundCount, 1);
  assert.equal(result.summary.approvedAmountMinor, 450);
});
test('invalid/mismatched provider data fails closed instead of reporting zero refund', () => {
  assert.throws(() => parseProviderRefundListing({}, 'mp1', 2330), /INVALID_LIST/);
  assert.throws(() => parseProviderRefundListing([{id: 'x', payment_id: 'other', amount: 1, status: 'approved'}], 'mp1', 2330), /PAYMENT_MISMATCH/);
  assert.throws(() => parseProviderRefundListing([{id: 'x', payment_id: 'mp1', amount: 23.31, status: 'approved'}], 'mp1', 2330), /AMOUNT_MISMATCH/);
  assert.throws(() => parseProviderRefundListing(new Array(101).fill({id: 'x', payment_id:'mp1', amount:1, status:'approved'}), 'mp1', 2330), /INVALID_LIST/);
});
test('provider verification is GET-only, authenticated and cannot trigger reimbursement', () => {
  const service = read('server/payments/providerRefundReadOnlyDiagnosisService.ts');
  const router = read('server/payments/storePaymentRefundRouter.ts');
  const bridge = read('src/components/store/PaidOrderRefundBridge.tsx');
  assert.match(router, /router\.get\('\/provider-diagnostic'/);
  assert.match(router, /await requireOwner\(request\.get\('authorization'\) \?\? '', storeId\)/);
  assert.match(service, /method:\s*'GET'/);
  assert.match(service, /'\/refunds'/);
  assert.match(service, /loadMercadoPagoPaymentProviderBinding/);
  assert.match(service, /binding\.canonicalStoreId !== payment\.storeId/);
  assert.doesNotMatch(service, /method:\s*'POST'|requestCanonicalOrderRefund|markRefundRequest/);
  assert.match(bridge, /Conferir diretamente no Mercado Pago \(somente leitura\)/);
  assert.match(bridge, /providerDiagnostic\.refunds\.approvedAmountMinor/);
  assert.match(bridge, /registro parcial anterior continua pendente de conciliação/);
});
