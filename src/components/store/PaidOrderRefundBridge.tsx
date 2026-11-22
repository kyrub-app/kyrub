import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  LoaderCircle,
  Minus,
  Plus,
  RotateCcw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../../utils/firebase';
import { updateOrderStatusWithDecision } from '../../utils/orderWorkflow';
import { PostRejectionCreditInterest } from './PostRejectionCreditInterest';

interface PaidOrderRefundBridgeProps {
  storeId: string;
  notify: (
    message: string,
    type?: 'success' | 'error' | 'info' | 'warning'
  ) => void;
}

interface RejectionLine {
  lineId: string;
  productId: string;
  name: string;
  price: number;
  quantity: number;
  paidQuantity: number;
  transferredQuantity: number;
  settledAmount: number;
  discountAmount: number;
}

interface RefundCandidate {
  id: string;
  buyerName: string;
  total: number;
  status: string;
  paymentStatus: string;
  refundStatus: string;
  refundAmount: number;
  refundReason: string;
  updatedAt: string;
  items: RejectionLine[];
}

interface RefundResponse {
  orderId?: string;
  paymentId?: string;
  amount?: number;
  status?: 'processing' | 'refunded';
  duplicate?: boolean;
  error?: string;
  code?: string;
}

interface ProviderRefundReadOnlyDiagnosis {
  source: 'mercado_pago_read_only';
  paymentStatus: string;
  paymentAmountMinor: number;
  storedPaymentAmountMinor: number;
  amountMatches: boolean;
  refundedAmountReportedMinor: number | null;
  refunds: {
    refundCount: number;
    approvedRefundCount: number;
    approvedAmountMinor: number;
    uncertainRefundCount: number;
    statuses: Record<string, number>;
  };
  partialAttempt: { count: number; statusCounts: Record<string, number> };
  blockers: string[];
  assessment: {
    state: 'verified_zero_refund_observation' | 'provider_no_refund_listed_but_incomplete' | 'requires_manual_reconciliation';
    eligibleToRecordEvidence: boolean;
    remainingFinancialObligationMinor: number | null;
    message: string;
  };
  notice: string;
}

interface RefundReadOnlyDiagnosis {
  source: 'firestore_read_only';
  order: {
    status: string;
    paymentStatus: string;
    refundStatus: string;
    operationalTotalMinor: number | null;
  };
  payments: {
    count: number;
    truncated: boolean;
    records: Array<{ scope: 'erp' | 'canonical'; status: string; provider: string; amountMinor: number | null }>;
  };
  partialRefunds: {
    count: number;
    truncated: boolean;
    confirmedCount: number;
    confirmedAmountMinor: number;
    unresolvedCount: number;
    statusCounts: Record<string, number>;
  };
  blockers: string[];
  notice: string;
}

interface PartialCancellationResponse {
  orderId?: string;
  operationId?: string;
  cancelledAmount?: number;
  remainingTotal?: number;
  refundRequired?: boolean;
  refundStatus?: 'not_required' | 'required' | 'processing' | 'refunded' | 'failed';
  providerRefundId?: string;
  duplicate?: boolean;
  error?: string;
  code?: string;
}

type RejectionScope = '' | 'whole' | 'items';

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const REFUND_BLOCKER_LABELS: Record<string, string> = {
  pedido_nao_terminal: 'pedido ainda não encerrado',
  pedido_sem_pagamento_confirmado: 'pagamento não confirmado no pedido',
  valor_operacional_ausente: 'valor do pedido zerado ou ausente',
  pagamento_canonico_ambiguo_ou_ausente: 'pagamento original ausente ou com registros divergentes',
  pagamento_canonico_invalido: 'pagamento original sem valor ou provedor válido',
  historico_parcial_acima_do_limite: 'histórico parcial acima do limite de conferência',
  historico_parcial_incerto: 'tentativa de reembolso parcial ainda não conciliada',
  reembolso_parcial_confirmado_exige_residual: 'já houve reembolso parcial; o restante requer conciliação',
  historico_parcial_em_escopo_canonico: 'histórico parcial encontrado na loja canônica',
  pagamento_em_escopo_canonico_verificar_vinculo: 'pagamento registrado na loja canônica; conferir vínculo',
};

const REFUND_PAYMENT_STATUS_LABELS: Record<string, string> = {
  paid: 'pago',
  refund_requested: 'reembolso solicitado',
  refund_processing: 'reembolso em processamento',
  refund_failed: 'tentativa de reembolso falhou',
  refunded: 'reembolso confirmado no registro',
  pending: 'aguardando pagamento',
};

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const number = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const integer = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : 0;

const roundMoney = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

// This is only the operational order snapshot, never payment-provider authority.
// A zero/absent order total must NOT be presented as a verified R$ 0 refund.
const operationalRefundDisplayAmount = (
  order: Pick<RefundCandidate, 'refundAmount' | 'total'>
): number | null => order.refundAmount > 0
  ? order.refundAmount
  : order.total > 0
    ? order.total
    : null;

const orderElementIdPrefix = 'kyrub-customer-order-';

const createOperationId = (): string => {
  const nativeId = globalThis.crypto?.randomUUID?.();
  return nativeId
    ? `cancel_${nativeId.replace(/-/g, '')}`
    : `cancel_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
};

const lineCancellableQuantity = (line: RejectionLine): number =>
  Math.max(0, line.quantity - line.transferredQuantity);

const estimateLineCancellationAmount = (
  line: RejectionLine,
  cancellationQuantity: number
): number => {
  const cancellable = Math.min(
    lineCancellableQuantity(line),
    Math.max(0, Math.trunc(cancellationQuantity))
  );
  if (cancellable <= 0 || line.quantity <= 0) return 0;
  const remainingQuantity = line.quantity - cancellable;
  const ratio = remainingQuantity / line.quantity;
  const remainingSettled = roundMoney(line.settledAmount * ratio);
  const remainingDiscount = roundMoney(line.discountAmount * ratio);
  const currentNet = line.settledAmount > 0
    ? line.settledAmount
    : roundMoney(Math.max(0, line.quantity * line.price - line.discountAmount));
  const remainingNet = line.settledAmount > 0
    ? remainingSettled
    : roundMoney(Math.max(0, remainingQuantity * line.price - remainingDiscount));
  return roundMoney(Math.max(0, currentNet - remainingNet));
};

export const PaidOrderRefundBridge = ({
  storeId,
  notify,
}: PaidOrderRefundBridgeProps) => {
  const [orders, setOrders] = useState<RefundCandidate[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<RefundCandidate | null>(null);
  const [reason, setReason] = useState('Pedido recusado pelo lojista');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [diagnostic, setDiagnostic] = useState<RefundReadOnlyDiagnosis | null>(null);
  const [providerDiagnostic, setProviderDiagnostic] = useState<ProviderRefundReadOnlyDiagnosis | null>(null);
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerError, setProviderError] = useState('');
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [evidenceError, setEvidenceError] = useState('');
  const [evidenceRecorded, setEvidenceRecorded] = useState(false);
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  const [diagnosticError, setDiagnosticError] = useState('');
  const [minimizedRefundOrderId, setMinimizedRefundOrderId] = useState<string | null>(null);

  const [rejectionOrder, setRejectionOrder] = useState<RefundCandidate | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectionAlternative, setRejectionAlternative] = useState('');
  const [rejectionScope, setRejectionScope] = useState<RejectionScope>('');
  const [rejectionSelections, setRejectionSelections] = useState<Record<string, number>>({});
  const [rejectionOperationId, setRejectionOperationId] = useState('');
  const [rejectionBusy, setRejectionBusy] = useState(false);
  const [rejectionError, setRejectionError] = useState('');
  const [partialResult, setPartialResult] = useState<PartialCancellationResponse | null>(null);

  useEffect(() => {
    setMinimizedRefundOrderId(null);
    if (!storeId) {
      setOrders([]);
      return;
    }
    let unsubscribeOrders: () => void = () => undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeOrders();
      unsubscribeOrders = () => undefined;
      if (!user) {
        setOrders([]);
        return;
      }
      // Firestore rules authorize reads; ownership for mutations is checked
      // by the refund backend against the canonical store representation.
      unsubscribeOrders = onSnapshot(
        collection(db, `artifacts/${storeId}/public/data/customerOrders`),
      snapshot => {
        setOrders(
          snapshot.docs.map(document => {
            const data = document.data() as Record<string, unknown>;
            const id = clean(data.id) || document.id;
            const rawItems = Array.isArray(data.items) ? data.items : [];
            return {
              id,
              buyerName: clean(data.buyerName) || 'Cliente',
              total: number(data.total),
              status: clean(data.status),
              paymentStatus: clean(data.paymentStatus),
              refundStatus: clean(data.refundStatus),
              refundAmount: number(data.refundAmount),
              refundReason: clean(data.refundReason),
              updatedAt: clean(data.updatedAt),
              items: rawItems.flatMap((candidate, index) => {
                if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
                  return [];
                }
                const item = candidate as Record<string, unknown>;
                const lineId = clean(item.lineId) || `${id}-line-${index + 1}`;
                const name = clean(item.name);
                const quantity = integer(item.quantity);
                if (!lineId || !name || quantity <= 0) return [];
                return [{
                  lineId,
                  productId: clean(item.productId),
                  name,
                  price: number(item.price),
                  quantity,
                  paidQuantity: integer(item.paidQuantity),
                  transferredQuantity: integer(item.transferredQuantity),
                  settledAmount: number(item.settledAmount),
                  discountAmount: number(item.discountAmount),
                } satisfies RejectionLine];
              }),
            };
          })
        );
      },
        snapshotError => {
          console.warn('Pedidos/reembolsos indisponíveis.', snapshotError);
          setOrders([]);
        }
      );
    });
    return () => {
      unsubscribeAuth();
      unsubscribeOrders();
    };
  }, [storeId]);

  const openScopedRejection = (order: RefundCandidate): void => {
    setRejectionOrder(order);
    setRejectionReason('');
    setRejectionAlternative('');
    setRejectionScope('');
    setRejectionSelections({});
    setRejectionOperationId(createOperationId());
    setRejectionError('');
    setPartialResult(null);
  };

  useEffect(() => {
    const interceptReject = (event: MouseEvent): void => {
      if (rejectionOrder || selectedOrder || rejectionBusy) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest('button');
      if (!(button instanceof HTMLButtonElement)) return;
      if (button.textContent?.trim() !== 'Recusar') return;
      const card = button.closest(`[id^="${orderElementIdPrefix}"]`);
      if (!(card instanceof HTMLElement)) return;
      const encodedOrderId = card.id.slice(orderElementIdPrefix.length);
      let orderId = encodedOrderId;
      try {
        orderId = decodeURIComponent(encodedOrderId);
      } catch {
        return;
      }
      const order = orders.find(candidate => candidate.id === orderId && candidate.status === 'pending');
      if (!order) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      openScopedRejection(order);
    };

    document.addEventListener('click', interceptReject, true);
    return () => document.removeEventListener('click', interceptReject, true);
  }, [orders, rejectionBusy, rejectionOrder, selectedOrder]);

  const pending = useMemo(
    () =>
      orders
        .filter(order =>
          (order.status === 'rejected' || order.status === 'cancelled') &&
          order.paymentStatus === 'paid' &&
          order.refundStatus !== 'refunded'
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [orders]
  );

  const active = pending[0] ?? null;
  const activeDisplayAmount = active ? operationalRefundDisplayAmount(active) : null;
  const selectedDisplayAmount = selectedOrder ? operationalRefundDisplayAmount(selectedOrder) : null;

  const selectedCancellationAmount = useMemo(() => {
    if (!rejectionOrder) return 0;
    return roundMoney(
      rejectionOrder.items.reduce(
        (sum, line) => sum + estimateLineCancellationAmount(
          line,
          rejectionSelections[line.lineId] ?? 0
        ),
        0
      )
    );
  }, [rejectionOrder, rejectionSelections]);

  const selectedQuantity = useMemo(
    () => Object.values(rejectionSelections).reduce((sum, quantity) => sum + quantity, 0),
    [rejectionSelections]
  );

  const orderCancellableQuantity = useMemo(
    () => rejectionOrder?.items.reduce(
      (sum, line) => sum + lineCancellableQuantity(line),
      0
    ) ?? 0,
    [rejectionOrder]
  );

  const selectionCancelsEverything =
    selectedQuantity > 0 && selectedQuantity >= orderCancellableQuantity;

  const setLineQuantity = (line: RejectionLine, quantity: number): void => {
    if (partialResult) return;
    const normalized = Math.max(
      0,
      Math.min(lineCancellableQuantity(line), Math.trunc(quantity))
    );
    setRejectionSelections(current => {
      const next = { ...current };
      if (normalized <= 0) delete next[line.lineId];
      else next[line.lineId] = normalized;
      return next;
    });
  };

  const closeScopedRejection = (): void => {
    setRejectionOrder(null);
    setRejectionReason('');
    setRejectionAlternative('');
    setRejectionScope('');
    setRejectionSelections({});
    setRejectionOperationId('');
    setRejectionError('');
    setPartialResult(null);
  };

  const confirmScopedRejection = async (): Promise<void> => {
    if (!rejectionOrder || !rejectionReason.trim() || !rejectionScope) return;
    const user = auth.currentUser;
    if (!user) {
      setRejectionError('Entre na sua conta para alterar este pedido.');
      return;
    }

    setRejectionBusy(true);
    setRejectionError('');
    try {
      if (rejectionScope === 'whole') {
        await updateOrderStatusWithDecision(
          storeId,
          rejectionOrder.id,
          'rejected',
          {
            reason: rejectionReason.trim(),
            alternative: rejectionAlternative.trim(),
          }
        );
        notify('Pedido recusado com sucesso.', 'success');
        closeScopedRejection();
        return;
      }

      const selections = Object.entries(rejectionSelections)
        .filter(([, quantity]) => quantity > 0)
        .map(([lineId, quantity]) => ({ lineId, quantity }));
      if (!selections.length || selectionCancelsEverything) return;
      const token = await user.getIdToken();
      const response = await fetch('/api/health?transport=store-promotions&surface=refunds', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          operation: 'cancel-items',
          operationId: rejectionOperationId,
          storeId,
          orderId: rejectionOrder.id,
          reason: rejectionReason.trim(),
          alternative: rejectionAlternative.trim(),
          selections,
        }),
      });
      const payload = await response.json().catch(() => ({})) as PartialCancellationResponse;
      if (!response.ok) {
        throw new Error(payload.error || 'Não foi possível cancelar os itens selecionados.');
      }
      setPartialResult(payload);
      const amount = payload.cancelledAmount ?? selectedCancellationAmount;
      if (!payload.refundRequired || payload.refundStatus === 'not_required') {
        notify(
          `Itens cancelados. O pedido continua com ${money.format(payload.remainingTotal ?? Math.max(0, rejectionOrder.total - amount))}.`,
          'success'
        );
        closeScopedRejection();
        return;
      }
      if (payload.refundStatus === 'refunded') {
        notify(
          `Itens cancelados e reembolso parcial de ${money.format(amount)} confirmado.`,
          'success'
        );
        closeScopedRejection();
        return;
      }
      if (payload.refundStatus === 'processing') {
        setRejectionError(
          `Os itens já foram cancelados. O reembolso de ${money.format(amount)} foi enviado ao Mercado Pago e ainda está sendo confirmado. Você pode tocar novamente em confirmar para verificar pela mesma operação idempotente.`
        );
        return;
      }
      setRejectionError(
        `Os itens já foram cancelados, mas o reembolso de ${money.format(amount)} ainda não foi confirmado. Toque novamente em confirmar para tentar o mesmo reembolso sem cancelar os itens uma segunda vez.`
      );
    } catch (requestError) {
      setRejectionError(
        requestError instanceof Error
          ? requestError.message
          : 'Não foi possível concluir o cancelamento.'
      );
    } finally {
      setRejectionBusy(false);
    }
  };

  const openRefund = (order: RefundCandidate): void => {
    setSelectedOrder(order);
    setReason(order.refundReason || 'Pedido recusado pelo lojista');
    setError('');
    setDiagnostic(null);
    setDiagnosticError('');
    setProviderDiagnostic(null);
    setProviderError('');
    setEvidenceError('');
    setEvidenceRecorded(false);
  };

  const inspectRefund = async (): Promise<void> => {
    if (!selectedOrder || diagnosticBusy) return;
    const user = auth.currentUser;
    if (!user) {
      setDiagnosticError('Entre na sua conta para conferir o pedido.');
      return;
    }
    setDiagnosticBusy(true);
    setDiagnosticError('');
    setDiagnostic(null);
    try {
      const token = await user.getIdToken();
      const query = new URLSearchParams({
        transport: 'store-promotions',
        surface: 'refunds',
        path: 'diagnostic',
        storeId,
        orderId: selectedOrder.id,
      });
      const response = await fetch('/api/health?' + query.toString(), {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const result = await response.json().catch(() => ({})) as RefundReadOnlyDiagnosis & { error?: string };
      if (!response.ok || result.source !== 'firestore_read_only') {
        throw new Error(result.error || 'Não foi possível consultar os registros financeiros.');
      }
      setDiagnostic(result);
    } catch (diagnosticFailure) {
      setDiagnosticError(
        diagnosticFailure instanceof Error
          ? diagnosticFailure.message
          : 'Não foi possível consultar os registros financeiros.'
      );
    } finally {
      setDiagnosticBusy(false);
    }
  };

  const inspectProviderRefund = async (): Promise<void> => {
    if (!selectedOrder || providerBusy) return;
    const user = auth.currentUser;
    if (!user) {
      setProviderError('Entre na sua conta para conferir o Mercado Pago.');
      return;
    }
    setProviderBusy(true);
    setProviderError('');
    setProviderDiagnostic(null);
    try {
      const query = new URLSearchParams({
        transport: 'store-promotions',
        surface: 'refunds',
        path: 'provider-diagnostic',
        storeId,
        orderId: selectedOrder.id,
      });
      const response = await fetch('/api/health?' + query.toString(), {
        headers: { authorization: `Bearer ${await user.getIdToken()}` },
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({})) as ProviderRefundReadOnlyDiagnosis & {error?: string};
      if (!response.ok || data.source !== 'mercado_pago_read_only') {
        throw new Error(data.error || 'Não foi possível confirmar o estado do Mercado Pago.');
      }
      setProviderDiagnostic(data);
    } catch (caught) {
      setProviderError(caught instanceof Error ? caught.message : 'Consulta ao Mercado Pago indisponível.');
    } finally {
      setProviderBusy(false);
    }
  };

  const registerRefundEvidence = async (): Promise<void> => {
    if (!selectedOrder || evidenceBusy ||
        !providerDiagnostic?.assessment.eligibleToRecordEvidence) return;
    const user = auth.currentUser;
    if (!user) {
      setEvidenceError('Entre na sua conta para registrar a conferência.');
      return;
    }
    setEvidenceBusy(true);
    setEvidenceError('');
    try {
      const response = await fetch(
        '/api/health?transport=store-promotions&surface=refunds&path=provider-evidence',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${await user.getIdToken()}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({storeId, orderId: selectedOrder.id}),
          cache: 'no-store',
        }
      );
      const data = await response.json().catch(() => ({})) as {
        receipt?: {state: string; orderId: string; providerAmountMinor: number};
        error?: string;
      };
      if (!response.ok || data.receipt?.state !== 'observed_no_refund_not_settled' ||
          data.receipt.orderId !== selectedOrder.id) {
        throw new Error(data.error || 'A conferência não foi registrada.');
      }
      setEvidenceRecorded(true);
    } catch (caught) {
      setEvidenceError(caught instanceof Error ? caught.message : 'A conferência não foi registrada.');
    } finally {
      setEvidenceBusy(false);
    }
  };

  const confirmRefund = async (): Promise<void> => {
    if (!selectedOrder || !reason.trim()) return;
    if (operationalRefundDisplayAmount(selectedOrder) === null) {
      setError('O valor operacional deste pedido está zerado ou indisponível. Confira a cobrança original e concilie o histórico financeiro antes de solicitar um reembolso.');
      return;
    }
    const user = auth.currentUser;
    if (!user) {
      setError('Entre na sua conta para solicitar o reembolso.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/health?transport=store-promotions&surface=refunds', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          storeId,
          orderId: selectedOrder.id,
          reason: reason.trim(),
        }),
      });
      const payload = await response.json().catch(() => ({})) as RefundResponse;
      if (!response.ok) {
        throw new Error(payload.error || 'Não foi possível concluir o reembolso.');
      }
      if (payload.status === 'refunded') {
        notify(
          `Reembolso de ${money.format(payload.amount ?? selectedOrder.total)} confirmado pelo Mercado Pago.`,
          'success'
        );
      } else {
        notify(
          'O reembolso foi solicitado ao Mercado Pago e está sendo confirmado.',
          'info'
        );
      }
      setSelectedOrder(null);
    } catch (refundError) {
      setError(
        refundError instanceof Error
          ? refundError.message
          : 'Não foi possível concluir o reembolso.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {active && !selectedOrder && !rejectionOrder &&
        minimizedRefundOrderId === active.id && (
          <button
            type="button"
            onClick={() => setMinimizedRefundOrderId(null)}
            aria-label="Reabrir pendência financeira do pedido"
            className="fixed bottom-20 right-3 z-[165] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-amber-500/40 bg-slate-950 px-4 py-3 text-left text-[11px] font-bold text-amber-200 shadow-lg sm:bottom-6"
          >
            <AlertTriangle className="mr-2 inline h-4 w-4" />
            Pendência financeira · ver detalhes
          </button>
        )}
      {active && !selectedOrder && !rejectionOrder &&
        minimizedRefundOrderId !== active.id && (
        <aside className="fixed inset-x-3 bottom-20 z-[165] mx-auto max-w-lg rounded-3xl border border-amber-500/35 bg-slate-950/95 p-4 shadow-2xl backdrop-blur-md sm:bottom-6">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-300">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <span className="font-mono text-[9px] font-black uppercase tracking-[0.14em] text-amber-300">
                Reembolso necessário
              </span>
              <h3 className="mt-1 truncate text-sm font-black text-white">
                {active.buyerName} · {activeDisplayAmount === null ? 'Valor a conferir' : money.format(activeDisplayAmount)}
              </h3>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                O pedido foi recusado/cancelado, mas o pagamento continua confirmado. A pendência financeira precisa ser conciliada pelo pagamento original, não como saída manual de caixa. Não registre um estorno que não aconteceu.
              </p>
              {activeDisplayAmount === null && (
                <p className="mt-2 text-[10px] leading-relaxed text-amber-200">
                  O pedido operacional não informa um valor válido. Isso não significa que o pagamento original foi de R$ 0,00.
                </p>
              )}
              <button
                type="button"
                onClick={() => openRefund(active)}
                className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 text-[10px] font-black uppercase text-slate-950"
              >
                <RotateCcw className="h-4 w-4" />
                {active.refundStatus === 'processing'
                  ? 'Verificar reembolso'
                  : activeDisplayAmount === null
                    ? 'Conferir pendência'
                    : active.refundStatus === 'failed'
                      ? 'Tentar reembolso novamente'
                      : 'Reembolsar pagamento'}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setMinimizedRefundOrderId(active.id)}
              aria-label="Minimizar aviso de reembolso"
              title="Minimizar aviso, sem quitar a pendência financeira"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-700 text-slate-300 hover:border-amber-500/40 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </aside>
      )}

      {rejectionOrder && (
        <div className="fixed inset-0 z-[215] flex items-end justify-center bg-slate-950/90 backdrop-blur-md sm:items-center sm:p-5">
          <section className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-red-500/30 bg-slate-900 p-5 shadow-2xl sm:rounded-3xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="font-mono text-[9px] font-black uppercase tracking-[0.14em] text-red-300">
                  Recusar / cancelar
                </span>
                <h3 className="mt-1 text-lg font-black text-white">
                  {rejectionOrder.buyerName}
                </h3>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                  Informe o motivo e escolha se a recusa vale para o pedido inteiro ou somente para alguns itens.
                </p>
              </div>
              <button
                type="button"
                disabled={rejectionBusy}
                onClick={closeScopedRejection}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-500 disabled:opacity-40"
                aria-label="Fechar recusa"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="mt-5 block text-[9px] font-black uppercase text-slate-400">
              Motivo
              <textarea
                value={rejectionReason}
                disabled={Boolean(partialResult)}
                onChange={event => setRejectionReason(event.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Ex.: produto sem estoque, item indisponível, falha operacional..."
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-3 text-[11px] normal-case text-white outline-none focus:border-red-400 disabled:opacity-60"
              />
            </label>

            <label className="mt-3 block text-[9px] font-black uppercase text-slate-400">
              Alternativa sugerida ao cliente <span className="normal-case text-slate-600">(opcional)</span>
              <input
                type="text"
                value={rejectionAlternative}
                disabled={Boolean(partialResult)}
                onChange={event => setRejectionAlternative(event.target.value)}
                maxLength={500}
                placeholder="Ex.: substituir por outro tamanho"
                className="mt-2 h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-[11px] normal-case text-white outline-none focus:border-red-400 disabled:opacity-60"
              />
            </label>

            {rejectionReason.trim() && (
              <div className="mt-5">
                <p className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">
                  O que será cancelado?
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={Boolean(partialResult)}
                    onClick={() => {
                      setRejectionScope('whole');
                      setRejectionSelections({});
                      setRejectionError('');
                    }}
                    className={`min-h-14 rounded-2xl border px-3 py-2 text-left text-[10px] font-black uppercase transition ${
                      rejectionScope === 'whole'
                        ? 'border-red-400 bg-red-500/15 text-red-200'
                        : 'border-slate-700 bg-slate-950 text-slate-400'
                    } disabled:opacity-60`}
                  >
                    Pedido inteiro
                    <span className="mt-1 block text-[9px] font-medium normal-case text-slate-500">
                      Recusa toda a lista
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(partialResult)}
                    onClick={() => {
                      setRejectionScope('items');
                      setRejectionError('');
                    }}
                    className={`min-h-14 rounded-2xl border px-3 py-2 text-left text-[10px] font-black uppercase transition ${
                      rejectionScope === 'items'
                        ? 'border-amber-400 bg-amber-500/15 text-amber-200'
                        : 'border-slate-700 bg-slate-950 text-slate-400'
                    } disabled:opacity-60`}
                  >
                    Alguns itens
                    <span className="mt-1 block text-[9px] font-medium normal-case text-slate-500">
                      Mantém o restante ativo
                    </span>
                  </button>
                </div>
              </div>
            )}

            {rejectionScope === 'items' && (
              <div className="mt-4 space-y-2">
                {rejectionOrder.items.map(line => {
                  const max = lineCancellableQuantity(line);
                  const selected = rejectionSelections[line.lineId] ?? 0;
                  return (
                    <div
                      key={line.lineId}
                      className={`rounded-2xl border p-3 ${
                        selected > 0
                          ? 'border-amber-400/35 bg-amber-500/10'
                          : 'border-slate-800 bg-slate-950/70'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          disabled={Boolean(partialResult) || max <= 0}
                          onClick={() => setLineQuantity(line, selected > 0 ? 0 : 1)}
                          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border ${
                            selected > 0
                              ? 'border-amber-400 bg-amber-400 text-slate-950'
                              : 'border-slate-600 bg-slate-900 text-transparent'
                          } disabled:opacity-40`}
                          aria-label={selected > 0 ? `Desmarcar ${line.name}` : `Selecionar ${line.name}`}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[11px] font-black text-white">{line.name}</p>
                          <p className="mt-0.5 text-[9px] text-slate-500">
                            {line.quantity} no pedido · {money.format(line.price)} cada
                          </p>
                        </div>
                        {selected > 0 && (
                          <div className="flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-900 p-1">
                            <button
                              type="button"
                              disabled={Boolean(partialResult)}
                              onClick={() => setLineQuantity(line, selected - 1)}
                              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 disabled:opacity-40"
                              aria-label={`Diminuir quantidade de ${line.name}`}
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <span className="min-w-6 text-center text-[11px] font-black text-white">{selected}</span>
                            <button
                              type="button"
                              disabled={Boolean(partialResult) || selected >= max}
                              onClick={() => setLineQuantity(line, selected + 1)}
                              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 disabled:opacity-40"
                              aria-label={`Aumentar quantidade de ${line.name}`}
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                      {selected > 0 && (
                        <p className="mt-2 text-right text-[9px] font-bold text-amber-200">
                          Cancelar {money.format(estimateLineCancellationAmount(line, selected))}
                        </p>
                      )}
                    </div>
                  );
                })}

                {selectedQuantity > 0 && (
                  <div className="rounded-2xl border border-slate-700 bg-slate-950 p-3">
                    <div className="flex items-center justify-between gap-3 text-[10px]">
                      <span className="font-bold text-slate-400">Valor estimado do cancelamento</span>
                      <strong className="text-amber-200">{money.format(selectedCancellationAmount)}</strong>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-3 text-[10px]">
                      <span className="font-bold text-slate-400">Pedido restante</span>
                      <strong className="text-white">
                        {money.format(Math.max(0, rejectionOrder.total - selectedCancellationAmount))}
                      </strong>
                    </div>
                    {rejectionOrder.paymentStatus === 'paid' && (
                      <p className="mt-2 text-[9px] leading-relaxed text-slate-500">
                        Como o pedido já está pago, o Kyrub solicitará ao pagamento original somente o valor dos itens cancelados.
                      </p>
                    )}
                  </div>
                )}

                {selectionCancelsEverything && (
                  <p className="rounded-2xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[10px] text-red-200">
                    Todos os itens foram selecionados. Para cancelar a lista inteira, escolha “Pedido inteiro”.
                  </p>
                )}
              </div>
            )}

            {rejectionError && (
              <p className="mt-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[10px] leading-relaxed text-amber-100">
                {rejectionError}
              </p>
            )}

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                disabled={rejectionBusy}
                onClick={closeScopedRejection}
                className="min-h-12 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-4 text-[10px] font-black uppercase text-slate-300 disabled:opacity-40"
              >
                {partialResult ? 'Fechar' : 'Voltar'}
              </button>
              <button
                type="button"
                disabled={
                  rejectionBusy ||
                  !rejectionReason.trim() ||
                  !rejectionScope ||
                  (rejectionScope === 'items' && (selectedQuantity <= 0 || selectionCancelsEverything))
                }
                onClick={() => void confirmScopedRejection()}
                className="min-h-12 flex-[1.4] rounded-xl bg-red-600 px-4 text-[10px] font-black uppercase text-white disabled:opacity-40"
              >
                {rejectionBusy
                  ? 'Processando...'
                  : partialResult && partialResult.refundRequired && partialResult.refundStatus !== 'refunded'
                    ? 'Verificar reembolso'
                    : rejectionScope === 'items'
                      ? 'Cancelar itens selecionados'
                      : 'Confirmar recusa'}
              </button>
            </div>
          </section>
        </div>
      )}

      {selectedOrder && (
        <div className="fixed inset-0 z-[175] flex items-end justify-center bg-slate-950/90 backdrop-blur-md sm:items-center sm:p-5">
          <section className="max-h-[92dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-3xl border border-amber-500/30 bg-slate-900 p-5 shadow-2xl sm:rounded-3xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="font-mono text-[9px] font-black uppercase tracking-[0.14em] text-amber-300">
                  Reembolso integral
                </span>
                <h3 className="mt-1 text-lg font-black text-white">
                  {selectedDisplayAmount === null ? 'Valor do reembolso a conferir' : `Devolver ${money.format(selectedDisplayAmount)}?`}
                </h3>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                  O Kyrub usará a cobrança original do Mercado Pago. A operação é idempotente e não será registrada como uma despesa manual do caixa.
                  O valor mostrado pelo pedido é apenas informativo; o servidor usa a cobrança canônica.
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => setSelectedOrder(null)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-500 disabled:opacity-40"
                aria-label="Fechar reembolso"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="mt-5 block text-[9px] font-black uppercase text-slate-400">
              Motivo do reembolso
              <textarea
                value={reason}
                onChange={event => setReason(event.target.value)}
                rows={3}
                maxLength={500}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-3 text-[11px] normal-case text-white outline-none focus:border-amber-400"
              />
            </label>

            <button
              type="button"
              onClick={() => void inspectRefund()}
              disabled={diagnosticBusy || busy}
              className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-amber-500/40 bg-slate-950 px-4 text-[11px] font-bold text-amber-200 disabled:opacity-40"
            >
              {diagnosticBusy && <LoaderCircle className="h-4 w-4 animate-spin" />}
              Conferir cobrança e histórico (somente leitura)
            </button>
            {diagnosticError && (
              <p role="alert" className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[11px] text-red-200">
                {diagnosticError}
              </p>
            )}
            {diagnostic && (
              <div className="mt-3 space-y-2 rounded-2xl border border-amber-500/25 bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-200">
                <p className="font-bold text-amber-200">Conferência dos registros</p>
                <p>Valor no pedido: {diagnostic.order.operationalTotalMinor === null
                  ? 'indisponível'
                  : money.format(diagnostic.order.operationalTotalMinor / 100)}</p>
                <p>Pagamento(s) encontrado(s): {diagnostic.payments.count}
                  {diagnostic.payments.truncated ? ' (consulta limitada)' : ''}</p>
                {diagnostic.payments.records.map((payment, index) => (
                  <p key={index} className="pl-2 text-slate-300">
                    {payment.scope === 'canonical' ? 'Loja canônica' : 'ERP'} · {REFUND_PAYMENT_STATUS_LABELS[payment.status] ?? payment.status} ·
                    {' '}{payment.amountMinor === null ? 'valor não confirmado' : money.format(payment.amountMinor / 100)}
                  </p>
                ))}
                <p>Histórico parcial: {diagnostic.partialRefunds.count} registro(s);
                  {' '}{diagnostic.partialRefunds.unresolvedCount} incerto(s);
                  {' '}{diagnostic.partialRefunds.confirmedCount} confirmado(s)
                  {diagnostic.partialRefunds.truncated ? ' (acima do limite)' : ''}.</p>
                {diagnostic.partialRefunds.count > 0 && (
                  <p className="text-slate-400">Estados encontrados: {Object.entries(diagnostic.partialRefunds.statusCounts)
                    .map(([status, count]) => `${status}: ${count}`).join(' · ')}</p>
                )}
                {diagnostic.blockers.length > 0 && (
                  <p className="text-amber-200">
                    Pendências de conciliação: {diagnostic.blockers.map(code => REFUND_BLOCKER_LABELS[code] ?? code).join('; ')}.
                  </p>
                )}
                <p className="text-slate-400">{diagnostic.notice}</p>
              </div>
            )}

            <button
              type="button"
              onClick={() => void inspectProviderRefund()}
              disabled={busy || providerBusy}
              className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-cyan-500/35 bg-slate-950 px-4 text-[11px] font-bold text-cyan-200 disabled:opacity-40"
            >
              {providerBusy && <LoaderCircle className="h-4 w-4 animate-spin" />}
              Conferir diretamente no Mercado Pago (somente leitura)
            </button>
            {providerError && (
              <p role="alert" className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
                {providerError}
              </p>
            )}
            {providerDiagnostic && (
              <div className="mt-3 space-y-2 rounded-2xl border border-cyan-500/30 bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-200">
                <strong className="block text-cyan-200">Consulta direta ao Mercado Pago</strong>
                <p>Estado do pagamento no provedor: {providerDiagnostic.paymentStatus}</p>
                <p>Valor do pagamento: {money.format(providerDiagnostic.paymentAmountMinor / 100)}
                  {providerDiagnostic.amountMatches ? ' (confere com o Firebase)' : ' (diverge do Firebase)'}
                </p>
                <p>Valor total estornado informado pelo Mercado Pago: {
                  providerDiagnostic.refundedAmountReportedMinor === null
                    ? 'não informado'
                    : money.format(providerDiagnostic.refundedAmountReportedMinor / 100)
                }</p>
                <p>Reembolsos listados no Mercado Pago: {providerDiagnostic.refunds.refundCount}</p>
                <p>Devoluções aprovadas na consulta: {providerDiagnostic.refunds.approvedRefundCount}
                  {' '}· total {money.format(providerDiagnostic.refunds.approvedAmountMinor / 100)}
                </p>
                <p>Devoluções com resultado incerto: {providerDiagnostic.refunds.uncertainRefundCount}</p>
                {providerDiagnostic.refunds.refundCount > 0 && (
                  <p>Estados informados: {Object.entries(providerDiagnostic.refunds.statuses)
                    .map(([state, count]) => `${state}: ${count}`).join(' · ')}</p>
                )}
                <p className="text-amber-200">{providerDiagnostic.assessment.message}</p>
                <p className="text-amber-200">
                  O registro parcial anterior continua pendente de conciliação; esta conferência não realiza nem confirma reembolso.
                </p>
                {providerDiagnostic.assessment.eligibleToRecordEvidence && !evidenceRecorded && (
                  <button
                    type="button"
                    onClick={() => void registerRefundEvidence()}
                    disabled={evidenceBusy}
                    className="min-h-11 w-full rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-[11px] font-bold text-cyan-100 disabled:opacity-40"
                  >
                    {evidenceBusy ? 'Conferindo novamente...' : 'Registrar evidência da tentativa falha (não é estorno)'}
                  </button>
                )}
                {evidenceRecorded && (
                  <p role="status" className="text-cyan-200">
                    Evidência registrada. O histórico da tentativa permanece preservado e o pagamento continua pendente de solução.
                  </p>
                )}
                {evidenceError && (
                  <p role="alert" className="text-rose-200">{evidenceError}</p>
                )}
                <p className="text-slate-400">{providerDiagnostic.notice}</p>
              </div>
            )}

            {(selectedOrder.status === 'rejected' || selectedOrder.status === 'cancelled') &&
              selectedOrder.paymentStatus === 'paid' &&
              selectedOrder.refundStatus !== 'refunded' && (
                <PostRejectionCreditInterest storeId={storeId} orderId={selectedOrder.id} />
              )}

            {selectedDisplayAmount === null && (
              <p role="alert" className="mt-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[10px] leading-relaxed text-amber-100">
                O valor operacional do pedido está zerado ou ausente.
                {providerDiagnostic?.amountMatches
                  ? ` A cobrança confirmada no Mercado Pago é de ${money.format(providerDiagnostic.paymentAmountMinor / 100)}.`
                  : ' Confira o pagamento original.'}
                {' '}Esse valor de referência não altera o pedido nem autoriza reembolso integral.
              </p>
            )}

            {error && (
              <p className="mt-3 rounded-2xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[10px] leading-relaxed text-red-200">
                {error}
              </p>
            )}

            <button
              type="button"
              disabled={busy || !reason.trim() || selectedDisplayAmount === null}
              onClick={() => void confirmRefund()}
              className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-[10px] font-black uppercase text-white disabled:opacity-40"
            >
              {busy ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="h-4 w-4" />
              )}
              {busy ? 'Processando...' : 'Confirmar reembolso'}
            </button>
          </section>
        </div>
      )}
    </>
  );
};