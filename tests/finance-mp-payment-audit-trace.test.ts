import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { classifyMercadoPagoPaymentReviewIssues } from '../shared/financeProviderPaymentReview';

const complete = {
  grossMinor: 10000,
  providerFeeEvidenceAvailable: true,
  providerFeeMinor: 0,
  netReceivedMinor: 10000,
  refundedMinor: 0,
  moneyReleaseDate: '',
  moneyReleaseStatus: 'released',
};

test('MP review distinguishes absent evidence from known zeroes', () => {
  assert.deepEqual(classifyMercadoPagoPaymentReviewIssues({
    canonicalGrossMinor: 10000, ledgerProviderFeeMinor: 0, provider: complete,
  }), []);
  assert.deepEqual(classifyMercadoPagoPaymentReviewIssues({
    canonicalGrossMinor: 10000, ledgerProviderFeeMinor: 0, provider: null,
  }), ['missing_reconciliation']);
});

test('MP review reports mismatches only for comparable values and missing proof separately', () => {
  assert.deepEqual(classifyMercadoPagoPaymentReviewIssues({
    canonicalGrossMinor: 10000, ledgerProviderFeeMinor: 0,
    provider: { ...complete, grossMinor: 9900, providerFeeMinor: 120 },
  }), ['gross_divergence', 'fee_divergence']);
  assert.deepEqual(classifyMercadoPagoPaymentReviewIssues({
    canonicalGrossMinor: 10000, ledgerProviderFeeMinor: null,
    provider: { ...complete, providerFeeMinor: 120 },
  }), []);
  assert.deepEqual(classifyMercadoPagoPaymentReviewIssues({
    canonicalGrossMinor: 10000, ledgerProviderFeeMinor: 0,
    provider: {
      ...complete, providerFeeEvidenceAvailable: false, providerFeeMinor: null,
      netReceivedMinor: null, refundedMinor: null, moneyReleaseStatus: '',
    },
  }), [
    'missing_provider_fee', 'missing_net_amount',
    'missing_refund_information', 'missing_release_information',
  ]);
});

test('monthly review is bounded and uses the existing owner-only endpoint', () => {
  const router = readFileSync('server/payments/storeMercadoPagoPeriodSummaryRouter.ts', 'utf8');
  const client = readFileSync('src/components/store/StoreMercadoPagoPeriodSummaryWorkspace.tsx', 'utf8');
  assert.match(router, /const REVIEW_ITEM_LIMIT = 25/);
  assert.match(router, /reviewIssueCount/);
  assert.match(router, /reviewItemsOmittedCount/);
  assert.match(router, /classifyMercadoPagoPaymentReviewIssues/);
  assert.match(router, /await requireOwner\(/);
  assert.match(client, /data-kyrub-mp-payment-review="true"/);
  assert.match(client, /summary\.reviewItems/);
  assert.match(client, /Nenhum valor é modificado/);
});
