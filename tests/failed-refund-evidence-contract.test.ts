import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assessFailedPartialRefundObservation, type ProviderRefundObservation } from '../shared/orderRefundReconciliationEvidence';

const source = (path: string): string => readFileSync(path, 'utf8');
const base: ProviderRefundObservation = {
  paymentStatus: 'approved',
  paymentAmountMinor: 2330,
  storedPaymentAmountMinor: 2330,
  amountMatches: true,
  refundedAmountReportedMinor: 0,
  refunds: {
    refundCount: 0, approvedRefundCount: 0,
    approvedAmountMinor: 0, uncertainRefundCount: 0,
  },
  partialAttempt: {count: 1, statusCounts: {failed: 1}},
  blockers: ['failed_partial_still_requires_reconciliation'],
};

test('R$23.30 approved, no provider refunds, a failed local partial: only time-bound zero-refund audit evidence', () => {
  const result = assessFailedPartialRefundObservation(base);
  assert.equal(result.state, 'verified_zero_refund_observation');
  assert.equal(result.eligibleToRecordEvidence, true);
  assert.equal(result.remainingFinancialObligationMinor, 2330);
  assert.match(result.message, /sem apagar o histórico e sem quitar a pendência/);
});

test('missing explicit provider refunded-total cannot be treated as proof of zero', () => {
  const result = assessFailedPartialRefundObservation({...base, refundedAmountReportedMinor: null});
  assert.equal(result.state, 'provider_no_refund_listed_but_incomplete');
  assert.equal(result.eligibleToRecordEvidence, false);
  assert.equal(result.remainingFinancialObligationMinor, null);
});

test('approved partial, uncertain provider refund, mismatch and multiple attempts fail closed', () => {
  for (const caseValue of [
    {...base, paymentStatus: 'refunded'},
    {...base, paymentAmountMinor: 2400, amountMatches: false},
    {...base, refundedAmountReportedMinor: 1},
    {...base, refunds: {...base.refunds, refundCount:1, approvedRefundCount:1, approvedAmountMinor:500}},
    {...base, refunds: {...base.refunds, refundCount:1, uncertainRefundCount:1}},
    {...base, partialAttempt: {count:2, statusCounts:{failed:2}}},
    {...base, partialAttempt: {count:1, statusCounts:{processing:1}}},
    {...base, blockers: ['failed_partial_still_requires_reconciliation','provider_refund_totals_mismatch']},
  ]) {
    assert.equal(assessFailedPartialRefundObservation(caseValue).eligibleToRecordEvidence, false);
  }
});

test('recorded receipt is append-only and never marks money refunded or credit issued', () => {
  const service = source('server/payments/failedRefundEvidenceService.ts');
  const router = source('server/payments/storePaymentRefundRouter.ts');
  const bridge = source('src/components/store/PaidOrderRefundBridge.tsx');
  assert.match(service, /diagnoseMercadoPagoRefundReadOnly/);
  assert.match(service, /transaction\.create\(evidenceRef, result\)/);
  assert.match(service, /fullRefundSnapshot\.exists/);
  assert.match(service, /prior\.providerRefundedAmountMinor !== 0/);
  assert.match(service, /paymentRefunded: false/);
  assert.match(service, /creditIssued: false/);
  assert.doesNotMatch(service, /transaction\.(set|update|delete)\((orderRef|paymentRef|attemptRef|fullRefundRef)/);
  assert.doesNotMatch(service, /requestCanonicalOrderRefund|refund\.amount|method:\s*'POST'/);
  assert.match(router, /router\.post\('\/provider-evidence'/);
  assert.match(router, /await requireOwner\(request\.get\('authorization'\) \?\? '', storeId\)/);
  assert.match(bridge, /Registrar evidência da tentativa falha \(não é estorno\)/);
  assert.match(bridge, /Esse valor de referência não altera o pedido nem autoriza reembolso integral/);
});

test('provider diagnosis is never itself a settlement signal', () => {
  const diagnostic = source('server/payments/providerRefundReadOnlyDiagnosisService.ts');
  const guard = source('server/payments/partialRefundSafetyService.ts');
  assert.match(diagnostic, /assessFailedPartialRefundObservation/);
  assert.match(diagnostic, /assessment,/);
  assert.match(guard, /Failed is not proof the provider did not refund the money/);
  assert.match(guard, /PAYMENT_REFUND_PARTIAL_HISTORY_REVIEW_REQUIRED/);
});
