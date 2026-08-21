import type { CanonicalPayment, PaymentStatus } from './canonicalPayment';
import type { CanonicalPaymentIntent } from './canonicalPaymentIntent';
import type { CanonicalRefundRequest } from './canonicalRefund';
import type { SettlementPlan } from './canonicalSettlement';

export type PaymentHealthIssueCode =
  | 'payment_pending_too_long'
  | 'paid_intent_without_order'
  | 'refund_stuck'
  | 'refund_failed'
  | 'courier_still_blocked_after_delivery';

export interface PaymentHealthIssue {
  code: PaymentHealthIssueCode;
  severity: 'warning' | 'critical';
  message: string;
  entityId: string;
}

const ageMs = (iso: string, now: number): number => {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
  return Math.max(0, now - parsed);
};

export const inspectPaymentHealth = (input: {
  payment: CanonicalPayment;
  intent?: CanonicalPaymentIntent | null;
  orderExists?: boolean;
  refund?: CanonicalRefundRequest | null;
  settlement?: SettlementPlan | null;
  deliveryCompleted?: boolean;
  now?: number;
  pendingThresholdMs?: number;
  refundThresholdMs?: number;
}): PaymentHealthIssue[] => {
  const now = input.now ?? Date.now();
  const pendingThresholdMs = input.pendingThresholdMs ?? 30 * 60 * 1000;
  const refundThresholdMs = input.refundThresholdMs ?? 24 * 60 * 60 * 1000;
  const issues: PaymentHealthIssue[] = [];

  if (
    input.payment.status === 'pending' &&
    ageMs(input.payment.createdAt, now) > pendingThresholdMs
  ) {
    issues.push({
      code: 'payment_pending_too_long',
      severity: 'warning',
      message: 'Pagamento permanece pendente além do limite esperado.',
      entityId: input.payment.id,
    });
  }

  if (input.intent?.status === 'paid' && input.orderExists === false) {
    issues.push({
      code: 'paid_intent_without_order',
      severity: 'critical',
      message: 'Payment Intent pago ainda não materializou pedido operacional.',
      entityId: input.intent.id,
    });
  }

  if (input.refund) {
    if (input.refund.status === 'failed') {
      issues.push({
        code: 'refund_failed',
        severity: 'critical',
        message: 'Solicitação de estorno falhou e requer reconciliação.',
        entityId: input.refund.id,
      });
    } else if (
      input.refund.status === 'requested' &&
      ageMs(input.refund.createdAt, now) > refundThresholdMs
    ) {
      issues.push({
        code: 'refund_stuck',
        severity: 'warning',
        message: 'Solicitação de estorno permanece sem conclusão além do limite esperado.',
        entityId: input.refund.id,
      });
    }
  }

  if (input.deliveryCompleted && input.settlement) {
    const courier = input.settlement.allocations.find(
      allocation => allocation.recipientType === 'courier'
    );
    if (courier && courier.status === 'blocked') {
      issues.push({
        code: 'courier_still_blocked_after_delivery',
        severity: 'critical',
        message: 'Parcela do entregador segue bloqueada após entrega concluída.',
        entityId: input.settlement.id,
      });
    }
  }

  return issues;
};

export const needsFinancialReconciliation = (
  issues: readonly PaymentHealthIssue[]
): boolean => issues.length > 0;

export const isPaymentStatusOperationallyTerminal = (
  status: PaymentStatus
): boolean => ['failed', 'expired', 'refunded'].includes(status);
