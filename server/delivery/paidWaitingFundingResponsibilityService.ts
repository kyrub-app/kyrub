import { adminDb } from '../firebaseAdmin.js';
import {
  deriveEconomicFundingResponsibilityProjections,
  deriveEconomicFundingResponsibilityTotals,
  type EconomicFundingResponsibilityProjection,
  type EconomicFundingResponsibilityTotals,
} from '../../shared/economicFundingResponsibilityProjections.js';
import type { EconomicObligation } from '../../shared/economicObligations.js';

export interface PaidWaitingFundingResponsibilitySnapshot {
  generatedAt: string;
  payerPrincipalId: string;
  totals: EconomicFundingResponsibilityTotals;
  entries: EconomicFundingResponsibilityProjection[];
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const validIdentity = (value: string): boolean =>
  Boolean(value) && value.length <= 180 && !value.includes('/');

const buildSnapshot = (input: {
  payerPrincipalId: string;
  obligations: EconomicObligation[];
}): PaidWaitingFundingResponsibilitySnapshot => {
  const projections = deriveEconomicFundingResponsibilityProjections(input.obligations);
  for (const projection of projections) {
    if (projection.payerPrincipalId !== input.payerPrincipalId) {
      throw new Error('PAID_WAITING_FUNDING_RESPONSIBILITY_PAYER_MISMATCH');
    }
  }
  const entries = projections
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return {
    generatedAt: new Date().toISOString(),
    payerPrincipalId: input.payerPrincipalId,
    totals: deriveEconomicFundingResponsibilityTotals(entries),
    entries,
  };
};

export const loadStorePaidWaitingFundingResponsibility = async (
  canonicalStoreIdInput: string
): Promise<PaidWaitingFundingResponsibilitySnapshot> => {
  const canonicalStoreId = clean(canonicalStoreIdInput);
  if (!validIdentity(canonicalStoreId)) {
    throw new Error('PAID_WAITING_FUNDING_RESPONSIBILITY_STORE_INVALID');
  }
  const payerPrincipalId = `store:${canonicalStoreId}`;
  const snapshot = await adminDb
    .collection(`stores/${canonicalStoreId}/economicObligations`)
    .where('sourceAuthority', '==', 'delivery_paid_waiting')
    .where('payerPrincipalId', '==', payerPrincipalId)
    .limit(250)
    .get();
  const obligations = snapshot.docs.map(document => document.data() as EconomicObligation);
  return buildSnapshot({ payerPrincipalId, obligations });
};

export const loadKyrubPaidWaitingFundingResponsibility = async (): Promise<
  PaidWaitingFundingResponsibilitySnapshot
> => {
  const payerPrincipalId = 'kyrub:platform';
  const snapshot = await adminDb
    .collectionGroup('economicObligations')
    .where('sourceAuthority', '==', 'delivery_paid_waiting')
    .where('payerPrincipalId', '==', payerPrincipalId)
    .limit(500)
    .get();
  const obligations = snapshot.docs.map(document => document.data() as EconomicObligation);
  return buildSnapshot({ payerPrincipalId, obligations });
};
