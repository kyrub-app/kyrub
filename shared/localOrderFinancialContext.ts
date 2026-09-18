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
  | 'line_settlement_ahead'
  | 'mixed_authority_requires_reconciliation';

export interface LocalOrderLineSettlementProjection {
  status: LocalOrderLineSettlementStatus;
  openAmount: number;
  operationalPaidAmount: number;
  transferredAmount: number;
  hasAllocatedPaidQuantity: boolean;
}

export interface LocalOrderFinancialContext {
  orderId: string;
  /** Provider-backed financial truth. Never inferred from paidQuantity. */
  canonicalProjection: CanonicalOrderFinancialProjection;
  /** Legacy item/quantity allocation, kept independent from payment evidence. */
  lineSettlement: LocalOrderLineSettlementProjection;
  lineSettlementConsistency: LocalOrderLineSettlementConsistency;
  ignoredLegacyMirrorCount: number;
  state: LocalOrderFinancialState;

  /** Transitional flat aliases kept while older clients are retired. */
  orderPaymentStatus: LocalOrderLineSettlementStatus;
  expectedAmount: number;
  authoritativelyPaidAmount: number;
  pendingPaymentCount: number;
  canonicalPaymentCount: number;
}
