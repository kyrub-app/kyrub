import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { LoaderCircle, Minus, Plus, X } from 'lucide-react';
import { auth, db } from '../../utils/firebase';
import {
  getCustomerOrderDocumentPath,
  type CustomerOrder,
  type CustomerOrderItem,
} from '../../utils/customerOrders';
import { updateOrderStatusWithDecision } from '../../utils/orderWorkflow';

interface KdsScopedRejectionControllerProps {
  storeId: string;
  notify: (
    message: string,
    type?: 'success' | 'error' | 'info' | 'warning'
  ) => void;
}

type Scope = '' | 'whole' | 'items';

type PartialCancellationResponse = {
  cancelledAmount?: number;
  remainingTotal?: number;
  refundRequired?: boolean;
  refundStatus?: 'not_required' | 'required' | 'processing' | 'refunded' | 'failed';
  error?: string;
};

const ORDER_PREFIX = 'kyrub-customer-order-';
const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});
const roundMoney = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const createOperationId = (): string => {
  const nativeId = globalThis.crypto?.randomUUID?.();
  return nativeId
    ? `cancel_${nativeId.replace(/-/g, '')}`
    : `cancel_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
};

const asString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';
const asNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;
const asInteger = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;

const parseItem = (
  value: unknown,
  index: number,
  orderId: string
): CustomerOrderItem | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const quantity = asInteger(raw.quantity);
  const name = asString(raw.name);
  if (!quantity || !name) return null;
  return {
    lineId: asString(raw.lineId) || `${orderId}-line-${index + 1}`,
    productId: asString(raw.productId),
    name,
    price: asNumber(raw.price),
    quantity,
    paidQuantity: asInteger(raw.paidQuantity),
    transferredQuantity: asInteger(raw.transferredQuantity),
    voidedQuantity: asInteger(raw.voidedQuantity),
    settledAmount: asNumber(raw.settledAmount),
    discountAmount: asNumber(raw.discountAmount),
    note: asString(raw.note),
    image: asString(raw.image),
    isService: raw.isService === true,
  };
};

const parseOrder = (
  storeId: string,
  orderId: string,
  value: unknown
): CustomerOrder | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const items = rawItems
    .map((item, index) => parseItem(item, index, orderId))
    .filter((item): item is CustomerOrderItem => Boolean(item));
  if (!items.length || asString(raw.status) !== 'pending') return null;
  return {
    id: asString(raw.id) || orderId,
    storeId: asString(raw.storeId) || storeId,
    buyerId: asString(raw.buyerId),
    buyerName: asString(raw.buyerName) || 'Cliente',
    buyerEmail: asString(raw.buyerEmail),
    fulfillmentType:
      raw.fulfillmentType === 'pickup' || raw.fulfillmentType === 'dine_in'
        ? raw.fulfillmentType
        : 'delivery',
    deliveryAddress: asString(raw.deliveryAddress),
    tableCode: asString(raw.tableCode),
    customerNote: asString(raw.customerNote),
    items,
    subtotal: asNumber(raw.subtotal),
    total: asNumber(raw.total),
    status: 'pending',
    paymentStatus:
      raw.paymentStatus === 'paid' || raw.paymentStatus === 'partial'
        ? raw.paymentStatus
        : 'unpaid',
    source:
      raw.source === 'staff' || raw.source === 'transfer'
        ? raw.source
        : 'customer',
    sourceChannel: null,
    operatorId: asString(raw.operatorId),
    operatorName: asString(raw.operatorName),
    createdAt: asString(raw.createdAt),
    updatedAt: asString(raw.updatedAt),
  };
};

const cancellableQuantity = (item: CustomerOrderItem): number =>
  Math.max(
    0,
    item.quantity - item.transferredQuantity - (item.voidedQuantity ?? 0)
  );

const estimateCancelledAmount = (
  item: CustomerOrderItem,
  quantity: number
): number => {
  const cancellable = Math.min(
    cancellableQuantity(item),
    Math.max(0, Math.trunc(quantity))
  );
  if (!cancellable || item.quantity <= 0) return 0;
  const remainingQuantity = item.quantity - cancellable;
  const settled = Math.max(0, item.settledAmount ?? 0);
  const discount = Math.max(0, item.discountAmount ?? 0);
  const currentNet = settled > 0
    ? settled
    : roundMoney(Math.max(0, item.quantity * item.price - discount));
  const remainingSettled = roundMoney(
    settled * remainingQuantity / item.quantity
  );
  const remainingDiscount = roundMoney(
    discount * remainingQuantity / item.quantity
  );
  const remainingNet = settled > 0
    ? remainingSettled
    : roundMoney(
        Math.max(0, remainingQuantity * item.price - remainingDiscount)
      );
  return roundMoney(Math.max(0, currentNet - remainingNet));
};

export const KdsScopedRejectionController = ({
  storeId,
  notify,
}: KdsScopedRejectionControllerProps) => {
  const [order, setOrder] = useState<CustomerOrder | null>(null);
  const [loadingOrder, setLoadingOrder] = useState(false);
  const [reason, setReason] = useState('');
  const [alternative, setAlternative] = useState('');
  const [scope, setScope] = useState<Scope>('');
  const [selections, setSelections] = useState<Record<string, number>>({});
  const [operationId, setOperationId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reset = (): void => {
    setOrder(null);
    setLoadingOrder(false);
    setReason('');
    setAlternative('');
    setScope('');
    setSelections({});
    setOperationId('');
    setError('');
  };

  useEffect(() => {
    const interceptNativeReject = (event: MouseEvent): void => {
      if (order || loadingOrder || busy) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest('button');
      if (!(button instanceof HTMLButtonElement)) return;
      if (button.textContent?.trim() !== 'Recusar') return;
      const card = button.closest(`[id^="${ORDER_PREFIX}"]`);
      if (!(card instanceof HTMLElement)) return;

      // O listener fica no window em capture, um nível acima do document usado pelos
      // bridges antigos. Bloqueamos o modal legado ANTES de qualquer leitura assíncrona.
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const encodedId = card.id.slice(ORDER_PREFIX.length);
      let orderId = encodedId;
      try {
        orderId = decodeURIComponent(encodedId);
      } catch {
        setError('Não foi possível identificar este pedido.');
        return;
      }

      setLoadingOrder(true);
      setError('');
      void getDoc(doc(db, getCustomerOrderDocumentPath(storeId, orderId)))
        .then(snapshot => {
          const parsed = snapshot.exists()
            ? parseOrder(storeId, orderId, snapshot.data())
            : null;
          if (!parsed) {
            setError(
              'Este pedido não está mais disponível para recusa. Atualize o painel.'
            );
            return;
          }
          setOrder(parsed);
          setOperationId(createOperationId());
        })
        .catch(loadError => {
          console.error('Falha ao abrir recusa com escopo:', loadError);
          setError('Não foi possível carregar os itens deste pedido.');
        })
        .finally(() => setLoadingOrder(false));
    };

    window.addEventListener('click', interceptNativeReject, true);
    return () => window.removeEventListener('click', interceptNativeReject, true);
  }, [busy, loadingOrder, order, storeId]);

  const selectedQuantity = useMemo(
    () => Object.values(selections).reduce((sum, value) => sum + value, 0),
    [selections]
  );
  const totalCancellableQuantity = useMemo(
    () =>
      order?.items.reduce(
        (sum, item) => sum + cancellableQuantity(item),
        0
      ) ?? 0,
    [order]
  );
  const cancelsEverything =
    selectedQuantity > 0 && selectedQuantity >= totalCancellableQuantity;
  const selectedAmount = useMemo(
    () =>
      roundMoney(
        order?.items.reduce(
          (sum, item) =>
            sum +
            estimateCancelledAmount(item, selections[item.lineId] ?? 0),
          0
        ) ?? 0
      ),
    [order, selections]
  );

  const setItemQuantity = (
    item: CustomerOrderItem,
    quantity: number
  ): void => {
    const nextQuantity = Math.max(
      0,
      Math.min(cancellableQuantity(item), Math.trunc(quantity))
    );
    setSelections(current => {
      const next = { ...current };
      if (nextQuantity > 0) next[item.lineId] = nextQuantity;
      else delete next[item.lineId];
      return next;
    });
  };

  const confirm = async (): Promise<void> => {
    if (!order || !reason.trim() || !scope) return;
    const user = auth.currentUser;
    if (!user) {
      setError(
        'Sua sessão ainda não está disponível. Aguarde um instante e tente novamente.'
      );
      return;
    }

    setBusy(true);
    setError('');
    try {
      if (scope === 'whole') {
        await updateOrderStatusWithDecision(
          storeId,
          order.id,
          'rejected',
          {
            reason: reason.trim(),
            alternative: alternative.trim(),
          }
        );
        notify(
          'Pedido recusado. Se houver pagamento confirmado, o Kyrub sinalizará o reembolso necessário.',
          'success'
        );
        reset();
        return;
      }

      if (!selectedQuantity || cancelsEverything) {
        setError(
          cancelsEverything
            ? 'Você selecionou todos os itens. Use “Pedido inteiro” para uma recusa total.'
            : 'Selecione ao menos um item e a quantidade que será cancelada.'
        );
        return;
      }

      const token = await user.getIdToken();
      const response = await fetch(
        '/api/health?transport=store-promotions&surface=refunds',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            operation: 'cancel-items',
            operationId,
            storeId,
            orderId: order.id,
            reason: reason.trim(),
            alternative: alternative.trim(),
            selections: Object.entries(selections)
              .filter(([, quantity]) => quantity > 0)
              .map(([lineId, quantity]) => ({ lineId, quantity })),
          }),
        }
      );
      const payload = await response.json().catch(() => ({})) as PartialCancellationResponse;
      if (!response.ok) {
        throw new Error(
          payload.error || 'Não foi possível cancelar os itens selecionados.'
        );
      }

      const amount = payload.cancelledAmount ?? selectedAmount;
      if (payload.refundRequired && payload.refundStatus === 'processing') {
        setError(
          `Os itens foram cancelados. O reembolso parcial de ${money.format(amount)} está sendo confirmado pelo Mercado Pago. Toque novamente em confirmar para verificar a mesma operação, sem duplicar o cancelamento.`
        );
        return;
      }
      if (payload.refundRequired && payload.refundStatus === 'failed') {
        setError(
          `Os itens foram cancelados, mas o reembolso parcial de ${money.format(amount)} ainda não foi confirmado. Tente novamente para reaproveitar a mesma operação idempotente.`
        );
        return;
      }

      notify(
        payload.refundRequired
          ? `Itens cancelados e reembolso parcial de ${money.format(amount)} confirmado.`
          : `Itens cancelados. O pedido continua em ${money.format(
              payload.remainingTotal ?? Math.max(0, order.total - amount)
            )}.`,
        'success'
      );
      reset();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Não foi possível concluir o cancelamento.'
      );
    } finally {
      setBusy(false);
    }
  };

  if (!order && !loadingOrder && !error) return null;

  return (
    <div className="fixed inset-0 z-[190] flex items-end justify-center bg-slate-950/90 backdrop-blur-md sm:items-center sm:p-5">
      <section className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-red-500/30 bg-slate-900 p-5 shadow-2xl sm:rounded-3xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="font-mono text-[9px] font-black uppercase tracking-[0.14em] text-red-300">
              Recusa do pedido
            </span>
            <h3 className="mt-1 text-lg font-black text-white">
              {order
                ? `${order.buyerName} · ${money.format(order.total)}`
                : 'Carregando pedido…'}
            </h3>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={reset}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-slate-400 disabled:opacity-40"
            aria-label="Fechar recusa"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {loadingOrder && (
          <div className="mt-6 flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-950 p-4 text-xs text-slate-300">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Carregando itens do pedido…
          </div>
        )}

        {order && (
          <>
            <label className="mt-5 block text-[9px] font-black uppercase text-slate-400">
              Motivo da recusa
              <textarea
                value={reason}
                onChange={event => setReason(event.target.value)}
                rows={3}
                maxLength={500}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-3 text-[11px] normal-case text-white outline-none focus:border-red-400"
                placeholder="Ex.: item indisponível, erro no pedido…"
              />
            </label>
            <label className="mt-3 block text-[9px] font-black uppercase text-slate-400">
              Alternativa ao cliente (opcional)
              <input
                value={alternative}
                onChange={event => setAlternative(event.target.value)}
                maxLength={300}
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-[11px] normal-case text-white outline-none focus:border-red-400"
              />
            </label>

            {reason.trim() && (
              <div className="mt-5">
                <p className="text-[10px] font-black uppercase text-white">
                  O que será cancelado?
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setScope('whole');
                      setSelections({});
                    }}
                    className={`min-h-12 rounded-xl border px-3 text-[10px] font-black uppercase ${
                      scope === 'whole'
                        ? 'border-red-400 bg-red-500/20 text-red-100'
                        : 'border-slate-700 bg-slate-950 text-slate-300'
                    }`}
                  >
                    Pedido inteiro
                  </button>
                  <button
                    type="button"
                    onClick={() => setScope('items')}
                    className={`min-h-12 rounded-xl border px-3 text-[10px] font-black uppercase ${
                      scope === 'items'
                        ? 'border-amber-400 bg-amber-500/15 text-amber-100'
                        : 'border-slate-700 bg-slate-950 text-slate-300'
                    }`}
                  >
                    Alguns itens
                  </button>
                </div>
              </div>
            )}

            {scope === 'items' && (
              <div className="mt-4 space-y-2">
                {order.items.map(item => {
                  const maximum = cancellableQuantity(item);
                  const selected = selections[item.lineId] ?? 0;
                  return (
                    <div
                      key={item.lineId}
                      className="rounded-2xl border border-slate-700 bg-slate-950 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-black text-white">
                            {item.name}
                          </p>
                          <p className="mt-1 text-[9px] text-slate-500">
                            Disponível para cancelar: {maximum} · {money.format(item.price)} cada
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={!selected}
                            onClick={() => setItemQuantity(item, selected - 1)}
                            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 text-slate-300 disabled:opacity-30"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="min-w-5 text-center text-sm font-black text-white">
                            {selected}
                          </span>
                          <button
                            type="button"
                            disabled={selected >= maximum}
                            onClick={() => setItemQuantity(item, selected + 1)}
                            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 text-slate-300 disabled:opacity-30"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {selectedQuantity > 0 && (
                  <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3 text-[10px] text-amber-100">
                    Valor estimado a cancelar:{' '}
                    <strong>{money.format(selectedAmount)}</strong>. O restante do pedido continua ativo.
                  </div>
                )}
              </div>
            )}

            {error && (
              <p className="mt-4 rounded-2xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-[10px] leading-relaxed text-red-200">
                {error}
              </p>
            )}

            {scope && (
              <button
                type="button"
                disabled={
                  busy ||
                  !reason.trim() ||
                  (scope === 'items' && (!selectedQuantity || cancelsEverything))
                }
                onClick={() => void confirm()}
                className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 text-[10px] font-black uppercase text-white disabled:opacity-40"
              >
                {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
                {busy
                  ? 'Processando…'
                  : scope === 'whole'
                    ? 'Confirmar recusa do pedido inteiro'
                    : 'Cancelar itens selecionados'}
              </button>
            )}
          </>
        )}

        {!order && error && (
          <p className="mt-5 rounded-2xl border border-red-500/25 bg-red-500/10 px-3 py-3 text-xs text-red-200">
            {error}
          </p>
        )}
      </section>
    </div>
  );
};
