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
import { collection, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../../utils/firebase';
import { updateOrderStatusWithDecision } from '../../utils/orderWorkflow';

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
    const user = auth.currentUser;
    if (!storeId || !user || user.uid !== storeId) {
      setOrders([]);
      return;
    }
    return onSnapshot(
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
      }
    );
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
    if (rejectionBusy) return;
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
    if (!user || user.uid !== storeId) {
      setRejectionError('Faça login novamente para alterar este pedido.');
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
  };

  const confirmRefund = async (): Promise<void> => {
    if (!selectedOrder || !reason.trim()) return;
    const user = auth.currentUser;
    if (!user || user.uid !== storeId) {
      setError('Faça login novamente para reembolsar este pagamento.');
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
      {active && !selectedOrder && !rejectionOrder && (
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
                {active.buyerName} · {money.format(active.refundAmount || active.total)}
              </h3>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                O pedido foi recusado/cancelado, mas o pagamento continua confirmado. O valor deve voltar pelo pagamento original, não como saída manual de caixa.
              </p>
              <button
                type="button"
                onClick={() => openRefund(active)}
                className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 text-[10px] font-black uppercase text-slate-950"
              >
                <RotateCcw className="h-4 w-4" />
                {active.refundStatus === 'processing'
                  ? 'Verificar reembolso'
                  : active.refundStatus === 'failed'
                    ? 'Tentar reembolso novamente'
                    : 'Reembolsar pagamento'}
              </button>
            </div>
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
          <section className="w-full max-w-md rounded-t-3xl border border-amber-500/30 bg-slate-900 p-5 shadow-2xl sm:rounded-3xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="font-mono text-[9px] font-black uppercase tracking-[0.14em] text-amber-300">
                  Reembolso integral
                </span>
                <h3 className="mt-1 text-lg font-black text-white">
                  Devolver {money.format(selectedOrder.refundAmount || selectedOrder.total)}?
                </h3>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                  O Kyrub usará a cobrança original do Mercado Pago. A operação é idempotente e não será registrada como uma despesa manual do caixa.
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

            {error && (
              <p className="mt-3 rounded-2xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[10px] leading-relaxed text-red-200">
                {error}
              </p>
            )}

            <button
              type="button"
              disabled={busy || !reason.trim()}
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