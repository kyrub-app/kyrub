import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import type { EconomicObligation } from '../shared/economicObligations';
import {
  PICKUP_HANDOFF_ELIGIBILITY_AUTHORITY,
  buildStoreReceivablePickupEligibilityUpdate,
} from '../shared/economicObligationEligibility';

const pendingStoreReceivable = (
  overrides: Partial<EconomicObligation> = {}
): EconomicObligation => ({
  schemaVersion: 1,
  id: 'obligation:store_receivable:pay-1',
  storeId: 'store-1',
  kind: 'store_receivable',
  status: 'pending',
  currency: 'BRL',
  amountMinor: 2500,
  beneficiaryType: 'store',
  beneficiaryPrincipalId: 'store:store-1',
  paymentId: 'pay-1',
  orderId: 'order-1',
  fulfillmentId: '',
  sourceEconomicEntryId: 'payment:capture:pay-1',
  sourceAuthority: 'economic_allocation_snapshot',
  funding: {
    customerMinor: 2500,
    kyrubMinor: 0,
    partnerMinor: 0,
    storeFundedDiscountMinor: 500,
  },
  createdAt: '2026-08-29T10:00:00.000Z',
  eligibleAt: '',
  settledAt: '',
  reversedAt: '',
  ...overrides,
});

const securePickupEvidence = () => ({
  storeId: 'store-1',
  orderId: 'order-1',
  verifiedAt: '2026-08-29T11:00:00.000Z',
  verifiedBy: 'merchant-user-1',
  handedOverAt: '2026-08-29T11:01:00.000Z',
  handedOverBy: 'merchant-user-1',
});

describe('economic obligation secure pickup eligibility', () => {
  test('verified and handed-over pickup makes a pending store receivable eligible with explicit authority', () => {
    const update = buildStoreReceivablePickupEligibilityUpdate({
      obligation: pendingStoreReceivable(),
      evidence: securePickupEvidence(),
    });

    assert.equal(update.status, 'eligible');
    assert.equal(update.eligibleAt, '2026-08-29T11:01:00.000Z');
    assert.equal(update.eligibility.authority, PICKUP_HANDOFF_ELIGIBILITY_AUTHORITY);
    assert.equal(update.eligibility.reference, 'order:order-1:pickup_handoff');
    assert.equal(update.eligibility.verifiedBy, 'merchant-user-1');
    assert.equal(update.eligibility.handedOverBy, 'merchant-user-1');
  });

  test('post-paid edge case never backdates eligibility before the obligation exists', () => {
    const update = buildStoreReceivablePickupEligibilityUpdate({
      obligation: pendingStoreReceivable({
        createdAt: '2026-08-29T11:05:00.000Z',
      }),
      evidence: securePickupEvidence(),
    });

    assert.equal(update.eligibleAt, '2026-08-29T11:05:00.000Z');
    assert.equal(update.eligibility.handedOverAt, '2026-08-29T11:01:00.000Z');
  });

  test('eligibility is fail-closed for non-pending, mismatched or courier obligations', () => {
    assert.throws(() => buildStoreReceivablePickupEligibilityUpdate({
      obligation: pendingStoreReceivable({
        status: 'eligible',
        eligibleAt: '2026-08-29T11:00:00.000Z',
      }),
      evidence: securePickupEvidence(),
    }), /ELIGIBILITY_STATUS_INVALID:eligible/);

    assert.throws(() => buildStoreReceivablePickupEligibilityUpdate({
      obligation: pendingStoreReceivable({ orderId: 'other-order' }),
      evidence: securePickupEvidence(),
    }), /ELIGIBILITY_RECEIVABLE_MISMATCH/);

    assert.throws(() => buildStoreReceivablePickupEligibilityUpdate({
      obligation: pendingStoreReceivable({
        id: 'obligation:courier_payable:pay-1:fulfillment-1:courier-1',
        kind: 'courier_payable',
        beneficiaryType: 'courier',
        beneficiaryPrincipalId: 'courier-1',
        fulfillmentId: 'fulfillment-1',
      }),
      evidence: securePickupEvidence(),
    }), /ELIGIBILITY_RECEIVABLE_MISMATCH/);
  });

  test('handoff evidence requires identified actors and chronological verification before handoff', () => {
    assert.throws(() => buildStoreReceivablePickupEligibilityUpdate({
      obligation: pendingStoreReceivable(),
      evidence: { ...securePickupEvidence(), verifiedBy: '' },
    }), /ELIGIBILITY_ACTOR_REQUIRED/);

    assert.throws(() => buildStoreReceivablePickupEligibilityUpdate({
      obligation: pendingStoreReceivable(),
      evidence: {
        ...securePickupEvidence(),
        verifiedAt: '2026-08-29T11:02:00.000Z',
      },
    }), /ELIGIBILITY_HANDOFF_ORDER_INVALID/);
  });

  test('server finalizes handoff and all pending store receivables in one transaction after reads', () => {
    const service = readFileSync(
      'server/payments/economicObligationEligibilityService.ts',
      'utf8'
    );
    const queryReadAt = service.indexOf('await transaction.get(receivableQuery)');
    const eligibilityWriteAt = service.indexOf('transaction.update(document.ref, eligibility)');
    const handoffWriteAt = service.indexOf('transaction.set(\n      legacyOrderRef');
    const secretDeleteAt = service.indexOf('transaction.delete(secretRef)');

    assert.match(service, /adminDb\.runTransaction/);
    assert.match(service, /order\.fulfillmentType !== 'pickup'/);
    assert.match(service, /order\.status !== 'completed'/);
    assert.match(service, /currentHandoffStatus !== 'verified'/);
    assert.match(service, /currentHandoffStatus !== 'handed_over'/);
    assert.match(service, /economicObligations/);
    assert.match(service, /\.where\('orderId', '==', orderId\)/);
    assert.ok(queryReadAt >= 0);
    assert.ok(eligibilityWriteAt > queryReadAt);
    assert.ok(handoffWriteAt > queryReadAt);
    assert.ok(secretDeleteAt > queryReadAt);
    assert.match(service, /if \(raw\.kind !== 'store_receivable'\) continue;/);
    assert.match(service, /if \(obligation\.status !== 'pending'\) continue;/);
    assert.match(service, /status: 'handed_over'/);
  });

  test('actual order completion flow invokes eligibility only behind the secure pickup completion gate', () => {
    const execution = readFileSync(
      'server/inventory/orderStatusExecutionService.ts',
      'utf8'
    );
    const transitionAt = execution.indexOf('transitionOrderStatusWithInventory(');
    const finalizeAt = execution.indexOf('finalizePickupHandoffWithEconomicEligibility({');

    assert.match(
      execution,
      /import \{ finalizePickupHandoffWithEconomicEligibility \} from '\.\.\/payments\/economicObligationEligibilityService\.js';/
    );
    assert.match(
      execution,
      /if \(input\.status === 'completed' && data\?\.fulfillmentType === 'pickup'\) \{\s*await finalizePickupHandoffWithEconomicEligibility/
    );
    assert.ok(transitionAt >= 0);
    assert.ok(finalizeAt > transitionAt);
    assert.doesNotMatch(
      execution,
      /fulfillmentType === 'delivery'[\s\S]{0,160}finalizePickupHandoffWithEconomicEligibility/
    );
  });

  test('eligibility layer does not infer courier economics or execute settlement, payout, transfer or custody', () => {
    const domain = readFileSync('shared/economicObligationEligibility.ts', 'utf8');
    const service = readFileSync(
      'server/payments/economicObligationEligibilityService.ts',
      'utf8'
    );
    const source = `${domain}\n${service}`;

    assert.doesNotMatch(source, /buildCourierPayableObligationFromCapture/);
    assert.doesNotMatch(
      source,
      /recordEconomicSettlementEvidence|initiateSettlement|initiateTransfer|createPayout|walletBalance|custodialBalance|application_fee_amount|splitRecipient|fetch\(|axios/i
    );
  });
});
