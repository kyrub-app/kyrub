import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { normalizeStoreProviderPaymentReconciliation } from '../shared/storeProviderPaymentReconciliation';

const legacyReconciliation = () => ({
  schemaVersion: 1 as const,
  storeId: 'store-1',
  paymentId: 'pay-1',
  orderId: 'order-1',
  provider: 'mercado-pago' as const,
  providerPaymentId: 'mp-1',
  currency: 'BRL' as const,
  canonicalPaymentMethod: 'pix' as const,
  providerPaymentMethodId: 'pix',
  providerPaymentTypeId: 'bank_transfer',
  installments: 1,
  providerStatus: 'approved',
  providerStatusDetail: 'accredited',
  grossMinor: 2950,
  totalPaidMinor: 2950,
  providerFeeMinor: null,
  mercadoPagoFeeMinor: null,
  financingFeeMinor: null,
  otherCollectorFeeMinor: null,
  netReceivedMinor: null,
  feeEvidence: [],
  moneyReleaseDate: '',
  moneyReleaseStatus: '',
  providerUpdatedAt: '2026-09-01T10:00:00.000Z',
  reconciledAt: '2026-09-01T10:01:00.000Z',
  sourceAuthority: 'mercado_pago_payment_api' as const,
  evidenceFingerprint: 'fingerprint-1',
});

describe('Mercado Pago authoritative receivables reconciliation', () => {
  test('legacy snapshots keep missing provider fee/refund evidence unknown instead of inventing zero', () => {
    const normalized = normalizeStoreProviderPaymentReconciliation(legacyReconciliation());
    assert.equal(normalized.providerFeeEvidenceAvailable, false);
    assert.equal(normalized.providerFeeMinor, null);
    assert.equal(normalized.refundedMinor, null);
    assert.equal(normalized.netReceivedMinor, null);
    assert.equal(normalized.moneyReleaseDate, '');
  });

  test('provider payment parser distinguishes absent fee evidence from an authoritative empty fee list', () => {
    const router = readFileSync('server/payments/storeMercadoPagoReconciliationRouter.ts', 'utf8');
    assert.match(router, /if \(!Array\.isArray\(payment\.fee_details\)\) \{\s*return \{ available: false, evidence: \[\] \}/);
    assert.match(router, /return \{ available: true, evidence \}/);
    assert.match(router, /providerFeeMinor: sum\(collectorFees\)/);
    assert.match(router, /providerFeeEvidenceAvailable: feeState\.available/);
  });

  test('local Pix coupon provider reconciliation uses net payment as provider gross, not pre-discount merchandise', () => {
    const router = readFileSync('server/payments/storeMercadoPagoReconciliationRouter.ts', 'utf8');
    const period = readFileSync('server/payments/storeMercadoPagoPeriodSummaryRouter.ts', 'utf8');
    assert.match(router, /grossMinor: toMinor\(input\.providerPayment\.transaction_amount\)|grossMinor,/);
    assert.match(router, /paymentId: input\.payment\.id/);
    assert.match(router, /orderId: input\.payment\.orderId/);
    assert.match(period, /reconciliation\.grossMinor !== capture\.canonicalGrossMinor/);
    // The discount belongs to the immutable commercial allocation, not the PSP gross.
    const ledger = readFileSync('server/payments/storeEconomicLedgerService.ts', 'utf8');
    assert.match(ledger, /subtotal: commercial\.subtotal/);
    assert.match(ledger, /discountTotal: commercial\.discountTotal/);
    assert.match(ledger, /total: commercial\.total/);
  });

  test('provider refund, net and release facts are persisted independently', () => {
    const router = readFileSync('server/payments/storeMercadoPagoReconciliationRouter.ts', 'utf8');
    assert.match(router, /transaction_amount_refunded/);
    assert.match(router, /refundedMinor: toMinor\(input\.providerPayment\.transaction_amount_refunded\)/);
    assert.match(router, /netReceivedMinor: toMinor\(input\.providerPayment\.transaction_details\?\.net_received_amount\)/);
    assert.match(router, /moneyReleaseDate: normalizeProviderIso\(input\.providerPayment\.money_release_date\)/);
    assert.match(router, /moneyReleaseStatus: clean\(input\.providerPayment\.money_release_status\)/);
  });

  test('gross divergence is preserved as provider evidence instead of blocking storage', () => {
    const router = readFileSync('server/payments/storeMercadoPagoReconciliationRouter.ts', 'utf8');
    assert.doesNotMatch(router, /grossMinor !== expectedMinor/);
    const period = readFileSync('server/payments/storeMercadoPagoPeriodSummaryRouter.ts', 'utf8');
    assert.match(period, /reconciliation\.grossMinor !== capture\.canonicalGrossMinor/);
    assert.match(period, /grossDivergenceCount/);
    assert.match(period, /hasDivergences: grossDivergenceCount > 0/);
  });

  test('same provider evidence fingerprint is idempotent and preserves the original reconciliation timestamp', () => {
    const router = readFileSync('server/payments/storeMercadoPagoReconciliationRouter.ts', 'utf8');
    const readAt = router.indexOf('const current = await transaction.get(reference)');
    const fingerprintAt = router.indexOf('existing.evidenceFingerprint === reconciliation.evidenceFingerprint', readAt);
    const writeAt = router.indexOf('transaction.set(reference, reconciliation)', fingerprintAt);
    assert.ok(readAt >= 0);
    assert.ok(fingerprintAt > readAt);
    assert.ok(writeAt > fingerprintAt);
    assert.match(router, /return existing;/);
  });

  test('historical reconciliation backfill is owner-only, bounded, deterministic and tenant-bound', () => {
    const router = readFileSync('server/payments/storeMercadoPagoReconciliationRouter.ts', 'utf8');
    assert.match(router, /orderBy\(FieldPath\.documentId\(\), 'asc'\)/);
    assert.match(router, /limit\(requestedLimit \+ 1\)/);
    assert.match(router, /query = query\.startAfter\(cursor\.documentId\)/);
    assert.match(router, /parsed\.storeId !== storeId/);
    assert.match(router, /limit > MAX_BACKFILL_LIMIT/);
    const routeAt = router.indexOf("router.post('/provider-reconciliation/backfill'");
    const ownerAt = router.indexOf('await requireOwner', routeAt);
    const backfillAt = router.indexOf('backfillMercadoPagoReconciliations', ownerAt);
    assert.ok(routeAt >= 0);
    assert.ok(ownerAt > routeAt);
    assert.ok(backfillAt > ownerAt);
  });

  test('empty financial period cannot claim complete or balanced provider reconciliation', () => {
    const period = readFileSync('server/payments/storeMercadoPagoPeriodSummaryRouter.ts', 'utf8');
    assert.match(period, /const complete = paymentCount > 0\s*&& reconciledPaymentCount === paymentCount/);
    assert.match(period, /balanced: complete && grossDivergenceCount === 0/);
  });

  test('period completeness requires provider-authoritative fee, net, refund and release evidence', () => {
    const period = readFileSync('server/payments/storeMercadoPagoPeriodSummaryRouter.ts', 'utf8');
    assert.doesNotMatch(period, /complete: true/);
    assert.match(period, /providerFeeEvidenceCount === paymentCount/);
    assert.match(period, /explicitNetReceivedCount === paymentCount/);
    assert.match(period, /providerRefundedEvidenceCount === paymentCount/);
    assert.match(period, /releaseEvidenceCount === paymentCount/);
    assert.match(period, /unreconciledPaymentCount/);
    assert.match(period, /missingProviderFeeEvidenceCount/);
    assert.match(period, /missingNetReceivedEvidenceCount/);
    assert.match(period, /missingRefundEvidenceCount/);
    assert.match(period, /missingReleaseEvidenceCount/);
  });

  test('period UI distinguishes provider gross divergences from missing evidence', () => {
    const workspace = readFileSync('src/components/store/StoreMercadoPagoPeriodSummaryWorkspace.tsx', 'utf8');
    assert.match(workspace, /summary\.hasDivergences/);
    assert.match(workspace, /summary\.grossDivergenceCount/);
    assert.match(workspace, /summary\.complete && !summary\.balanced && !summary\.hasDivergences/);
    assert.match(workspace, /!summary\.complete/);
    assert.match(workspace, /data futura ou prevista/);
  });

  test('period UI retains incomplete evidence instead of hiding financial rows', () => {
    const workspace = readFileSync('src/components/store/StoreMercadoPagoPeriodSummaryWorkspace.tsx', 'utf8');
    assert.doesNotMatch(workspace, /if \(!payload\.summary\?\.complete\)/);
    assert.match(workspace, /if \(!payload\.summary\)/);
    assert.match(workspace, /!summary\.complete/);
    assert.match(workspace, /summary\.missingRefundEvidenceCount > 0/);
    assert.match(workspace, /summary\.missingReleaseEvidenceCount/);
    assert.match(workspace, /summary\.explicitNetReceivedCount\}\/\{summary\.paymentCount\}/);
    assert.match(workspace, /grid-cols-1 gap-2 sm:grid-cols-2/);
  });

  test('internal economic ledger fees remain separate from authoritative provider fee totals', () => {
    const period = readFileSync('server/payments/storeMercadoPagoPeriodSummaryRouter.ts', 'utf8');
    assert.match(period, /ledgerProviderFeesMinor/);
    assert.match(period, /authoritativeProviderFeesMinor/);
    assert.match(period, /providerFeeEvidenceAvailable/);
    assert.match(period, /balanced: complete && grossDivergenceCount === 0/);
  });
});
