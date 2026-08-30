import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { EconomicObligation } from '../shared/economicObligations';
import { buildDeliveryPaidWaitingCourierObligation } from '../shared/deliveryPaidWaitingObligation';
import {
  buildEconomicSettlementFundingRecord,
  deriveEconomicSettlementFundingRequirement,
} from '../shared/economicSettlementFunding';

const settlementServiceSource = readFileSync(
  'server/payments/economicSettlementsService.ts',
  'utf8'
);
const reconciliationSource = readFileSync(
  'shared/economicReconciliation.ts',
  'utf8'
);

const eligibleWaitingObligation = (payer: 'store' | 'kyrub'): EconomicObligation => {
  const pending = buildDeliveryPaidWaitingCourierObligation({
    canonicalStoreId: 'store-1',
    orderId: 'order-1',
    deliveryId: 'delivery-1',
    courierId: 'courier-1',
    amountMinor: 300,
    payer,
    policyId: 'waiting-v1',
    policyVersion: 1,
    responsibilityPolicyId: 'responsibility-v1',
    responsibilityPolicyVersion: 1,
    decidedAt: '2026-08-30T10:00:00.000Z',
  });
  return {
    ...pending,
    status: 'eligible',
    eligibleAt: '2026-08-30T10:05:00.000Z',
  } as EconomicObligation;
};

test('paid waiting remains explicitly unfunded until authoritative funding evidence exists', () => {
  const obligation = eligibleWaitingObligation('store');
  const requirement = deriveEconomicSettlementFundingRequirement(obligation);
  assert.deepEqual(requirement, {
    obligationId: obligation.id,
    status: 'evidence_required',
    payer: 'store',
    payerPrincipalId: 'store:store-1',
    amountMinor: 300,
    currency: 'BRL',
  });
});

test('store-paid waiting accepts only store funding evidence after eligibility', () => {
  const obligation = eligibleWaitingObligation('store');
  const record = buildEconomicSettlementFundingRecord({
    obligation,
    evidence: {
      payer: 'store',
      payerPrincipalId: 'store:store-1',
      source: 'store_external_funds',
      fundingReferenceId: 'funding-1',
      amountMinor: 300,
      currency: 'BRL',
      occurredAt: '2026-08-30T10:06:00.000Z',
      observedAt: '2026-08-30T10:07:00.000Z',
      authority: 'funding_provider_webhook',
    },
  });
  assert.equal(record.sourceAuthority, 'delivery_paid_waiting');
  assert.equal(record.payerPrincipalId, 'store:store-1');
  assert.equal(record.source, 'store_external_funds');
  assert.equal(record.amountMinor, 300);
});

test('Kyrub-paid waiting accepts only Kyrub operating funding evidence', () => {
  const obligation = eligibleWaitingObligation('kyrub');
  const record = buildEconomicSettlementFundingRecord({
    obligation,
    evidence: {
      payer: 'kyrub',
      payerPrincipalId: 'kyrub:platform',
      source: 'kyrub_operating_funds',
      fundingReferenceId: 'funding-2',
      amountMinor: 300,
      currency: 'BRL',
      occurredAt: '2026-08-30T10:06:00.000Z',
      observedAt: '2026-08-30T10:07:00.000Z',
      authority: 'funding_provider_statement',
    },
  });
  assert.equal(record.payerPrincipalId, 'kyrub:platform');
  assert.equal(record.source, 'kyrub_operating_funds');
});

test('funding evidence fails closed on payer, source, amount and time mismatches', () => {
  const obligation = eligibleWaitingObligation('store');
  assert.throws(() => buildEconomicSettlementFundingRecord({
    obligation,
    evidence: {
      payer: 'kyrub',
      payerPrincipalId: 'kyrub:platform',
      source: 'kyrub_operating_funds',
      fundingReferenceId: 'wrong-payer',
      amountMinor: 300,
      currency: 'BRL',
      occurredAt: '2026-08-30T10:06:00.000Z',
      observedAt: '2026-08-30T10:07:00.000Z',
      authority: 'funding_provider_webhook',
    },
  }), /ECONOMIC_SETTLEMENT_FUNDING_PAYER_MISMATCH/);

  assert.throws(() => buildEconomicSettlementFundingRecord({
    obligation,
    evidence: {
      payer: 'store',
      payerPrincipalId: 'store:store-1',
      source: 'kyrub_operating_funds',
      fundingReferenceId: 'wrong-source',
      amountMinor: 300,
      currency: 'BRL',
      occurredAt: '2026-08-30T10:06:00.000Z',
      observedAt: '2026-08-30T10:07:00.000Z',
      authority: 'funding_provider_webhook',
    },
  }), /ECONOMIC_SETTLEMENT_FUNDING_SOURCE_MISMATCH/);

  assert.throws(() => buildEconomicSettlementFundingRecord({
    obligation,
    evidence: {
      payer: 'store',
      payerPrincipalId: 'store:store-1',
      source: 'store_external_funds',
      fundingReferenceId: 'wrong-amount',
      amountMinor: 301,
      currency: 'BRL',
      occurredAt: '2026-08-30T10:06:00.000Z',
      observedAt: '2026-08-30T10:07:00.000Z',
      authority: 'funding_provider_webhook',
    },
  }), /ECONOMIC_SETTLEMENT_FUNDING_AMOUNT_MISMATCH/);

  assert.throws(() => buildEconomicSettlementFundingRecord({
    obligation,
    evidence: {
      payer: 'store',
      payerPrincipalId: 'store:store-1',
      source: 'store_external_funds',
      fundingReferenceId: 'too-early',
      amountMinor: 300,
      currency: 'BRL',
      occurredAt: '2026-08-30T10:04:00.000Z',
      observedAt: '2026-08-30T10:07:00.000Z',
      authority: 'funding_provider_webhook',
    },
  }), /ECONOMIC_SETTLEMENT_FUNDING_BEFORE_ELIGIBILITY/);
});

test('payment-derived obligations do not get retrofitted into the paid-waiting funding contract', () => {
  const obligation = {
    ...eligibleWaitingObligation('store'),
    sourceAuthority: 'economic_allocation_snapshot',
    paymentId: 'payment-1',
    sourceEconomicEntryId: 'entry-1',
  } as EconomicObligation;
  assert.equal(deriveEconomicSettlementFundingRequirement(obligation), null);
});

test('legacy settlement and reconciliation remain closed to paid waiting until funding is integrated', () => {
  assert.match(settlementServiceSource, /!clean\(obligation\.paymentId\)/);
  assert.match(settlementServiceSource, /!clean\(obligation\.sourceEconomicEntryId\)/);
  assert.match(
    settlementServiceSource,
    /obligation\.sourceAuthority !== 'economic_allocation_snapshot'/
  );
  assert.doesNotMatch(settlementServiceSource, /economicSettlementFunding/);
  assert.match(reconciliationSource, /!clean\(obligation\.paymentId\)/);
});
