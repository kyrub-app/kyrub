import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, LoaderCircle, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../../utils/firebase';

interface PaidOrderRefundBridgeProps {
  storeId: string;
  notify: (
    message: string,
    type?: 'success' | 'error' | 'info' | 'warning'
  ) => void;
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

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const number = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

export const PaidOrderRefundBridge = ({
  storeId,
  notify,
}: PaidOrderRefundBridgeProps) => {
  const [orders, setOrders] = useState<RefundCandidate[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<RefundCandidate | null>(null);
  const [reason, setReason] = useState('Pedido recusado pelo lojista');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
            return {
              id: clean(data.id) || document.id,
              buyerName: clean(data.buyerName) || 'Cliente',
              total: number(data.total),
              status: clean(data.status),
              paymentStatus: clean(data.paymentStatus),
              refundStatus: clean(data.refundStatus),
              refundAmount: number(data.refundAmount),
              refundReason: clean(data.refundReason),
              updatedAt: clean(data.updatedAt),
            };
          })
        );
      },
      error => {
        console.warn('Reembolsos pendentes indisponíveis.', error);
      }
    );
  }, [storeId]);

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
  if (!active && !selectedOrder) return null;

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
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Não foi possível concluir o reembolso.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {active && !selectedOrder && (
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
