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
    settledAt: string;
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
      .where('kind', '==', 'courier_payable')
      .limit(250)
      .get(),
    adminDb
      .collectionGroup('economicSettlements')
      .where('beneficiaryPrincipalId', '==', courierUserId)
      .limit(250)
      .get(),
  ]);

  const obligations = obligationsSnapshot.docs.map(
    document => document.data() as EconomicObligation
  );
  const settlements = settlementsSnapshot.docs.map(
    document => document.data() as EconomicSettlementRecord
  );
  const projections = derivePayableProjections({ obligations, settlements });

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
      .sort((left, right) => right.settledAt.localeCompare(left.settledAt))
      .slice(0, 50)
      .map(projection => ({
        obligationId: projection.obligationId,
        storeId: projection.storeId,
        orderId: projection.orderId,
        deliveryId: projection.fulfillmentId,
        amountMinor: projection.amountMinor,
        state: projection.state,
        settledAt: projection.settledAt,
      })),
  };
};
