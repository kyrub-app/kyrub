export type LocalOrderFinancialState =
  | 'not_started'
  | 'pending'
  | 'partial'
  | 'paid'
  | 'refunded'
  | 'attention'
  | 'reconciliation_required';

export interface LocalOrderFinancialContext {
  orderId: string;
  orderPaymentStatus: 'unpaid' | 'partial' | 'paid';
  expectedAmount: number;
  authoritativelyPaidAmount: number;
  pendingPaymentCount: number;
  canonicalPaymentCount: number;
  ignoredLegacyMirrorCount: number;
  state: LocalOrderFinancialState;
}
