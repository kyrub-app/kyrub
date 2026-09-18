import type {
  CanonicalOrderFinancialProjection,
  CanonicalOrderFinancialState,
} from './canonicalOrderFinancialProjection';

export type LocalOrderFinancialState =
  | CanonicalOrderFinancialState
  | 'reconciliation_required';

export type LocalOrderLineSettlementStatus = 'unpaid' | 'partial' | 'paid';

export type LocalOrderLineSettlementConsistency =
  | 'aligned'
  | 'canonical_ahead'
  | 'line_settlement_ahead';

export interface LocalOrderFinancialContext {
  orderId: string;
  /** Legacy item/quantity settlement state. It is not payment-provider evidence. */
  lineSettlementStatus: LocalOrderLineSettlementStatus;
  lineSettlementConsistency: LocalOrderLineSettlementConsistency;
  /** Provider-backed financial truth, derived only from canonical payments. */
  canonicalProjection: CanonicalOrderFinancialProjection;
  ignoredLegacyMirrorCount: number;
  state: LocalOrderFinancialState;

  /** Transitional flat aliases kept for clients created before the split. */
  orderPaymentStatus: LocalOrderLineSettlementStatus;
  expectedAmount: number;
  authoritativelyPaidAmount: number;
  pendingPaymentCount: number;
  canonicalPaymentCount: number;
}
