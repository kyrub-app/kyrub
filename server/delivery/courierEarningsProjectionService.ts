import { adminDb } from '../firebaseAdmin.js';
import { derivePayableProjections } from '../../shared/economicObligationProjections.js';
import type { EconomicObligation } from '../../shared/economicObligations.js';
import type { EconomicSettlementRecord } from '../../shared/economicSettlements.js';

export interface CourierEarningsProjectionSnapshot {
  currency: 'BRL';
  totals: {
    projectedMinor: number;
    eligibleMinor: number;
    settledMinor: number;
    reversedMinor: number;
  };
  integrityErrorCount: number;
  entries: Array<{
    obligationId: string;
    storeId: string;
    orderId: string;
    deliveryId: string;
    amountMinor: number;
    state: 'projected' | 'eligible' | 'settled' | 'reversed' | 'integrity_error';
    createdAt: string;
    eligibleAt: string;
    settledAt: string;
    reversedAt: string;
    settlementId: string;
    settlementProvider: string;
  }>;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const addSafe = (left: number, right: number): number => {
  const total = left + right;
  if (!Number.isSafeInteger(total)) throw new Error('COURIER_EARNINGS_TOTAL_OVERFLOW');
  return total;
};

export const loadCourierEarningsProjection = async (
  courierUserIdInput: string
): Promise<CourierEarningsProjectionSnapshot> => {
  const courierUserId = clean(courierUserIdInput);
  if (!courierUserId || courierUserId.includes('/')) {
    throw new Error('COURIER_EARNINGS_ACTOR_INVALID');
  }

  const [obligationsSnapshot, settlementsSnapshot] = await Promise.all([
    adminDb
      .collectionGroup('economicObligations')
      .where('beneficiaryPrincipalId', '==', courierUserId)
      .limit(250)
      .get(),
    adminDb
      .collectionGroup('economicSettlements')
      .where('beneficiaryPrincipalId', '==', courierUserId)
      .limit(250)
      .get(),
  ]);

  const obligations = obligationsSnapshot.docs
    .map(document => document.data() as EconomicObligation)
    .filter(obligation => obligation.kind === 'courier_payable');
  const settlements = settlementsSnapshot.docs.map(
    document => document.data() as EconomicSettlementRecord
  );
  const projections = derivePayableProjections({ obligations, settlements });
  const obligationById = new Map(obligations.map(obligation => [obligation.id, obligation]));
  const settlementById = new Map(settlements.map(settlement => [settlement.id, settlement]));

  let projectedMinor = 0;
  let eligibleMinor = 0;
  let settledMinor = 0;
  let reversedMinor = 0;
  let integrityErrorCount = 0;

  for (const projection of projections) {
    if (projection.beneficiaryPrincipalId !== courierUserId) {
      throw new Error('COURIER_EARNINGS_BENEFICIARY_MISMATCH');
    }
    if (projection.state === 'integrity_error') {
      integrityErrorCount += 1;
      continue;
    }
    if (projection.state === 'projected') {
      projectedMinor = addSafe(projectedMinor, projection.amountMinor);
    } else if (projection.state === 'eligible') {
      eligibleMinor = addSafe(eligibleMinor, projection.amountMinor);
    } else if (projection.state === 'settled') {
      settledMinor = addSafe(settledMinor, projection.amountMinor);
    } else if (projection.state === 'reversed') {
      reversedMinor = addSafe(reversedMinor, projection.amountMinor);
    }
  }

  return {
    currency: 'BRL',
    totals: {
      projectedMinor,
      eligibleMinor,
      settledMinor,
      reversedMinor,
    },
    integrityErrorCount,
    entries: projections
      .slice()
      .sort((left, right) => {
        const leftObligation = obligationById.get(left.obligationId);
        const rightObligation = obligationById.get(right.obligationId);
        const leftTime = left.settledAt || leftObligation?.eligibleAt || leftObligation?.createdAt || '';
        const rightTime = right.settledAt || rightObligation?.eligibleAt || rightObligation?.createdAt || '';
        return rightTime.localeCompare(leftTime);
      })
      .slice(0, 50)
      .map(projection => {
        const obligation = obligationById.get(projection.obligationId);
        if (!obligation) throw new Error('COURIER_EARNINGS_OBLIGATION_MISSING');
        const settlement = projection.settlementId
          ? settlementById.get(projection.settlementId)
          : undefined;
        if (projection.state === 'settled' && !settlement) {
          throw new Error('COURIER_EARNINGS_SETTLEMENT_MISSING');
        }
        return {
          obligationId: projection.obligationId,
          storeId: projection.storeId,
          orderId: projection.orderId,
          deliveryId: projection.fulfillmentId,
          amountMinor: projection.amountMinor,
          state: projection.state,
          createdAt: obligation.createdAt,
          eligibleAt: obligation.eligibleAt,
          settledAt: projection.settledAt,
          reversedAt: obligation.reversedAt,
          settlementId: projection.settlementId,
          settlementProvider: settlement?.provider ?? '',
        };
      }),
  };
};
