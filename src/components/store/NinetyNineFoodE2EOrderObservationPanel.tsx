import { useState } from 'react';
import type { User } from 'firebase/auth';
import { Eye, RefreshCw, ShieldAlert } from 'lucide-react';
import {
  loadNinetyNineFoodE2EObservedOrders,
  type NinetyNineFoodE2EObservedOrder,
} from '../../utils/ninetyNineFoodE2EOrderObservation';

const reservationLabel = (
  item: NinetyNineFoodE2EObservedOrder
): string => {
  switch (item.reservation.state) {
    case 'reserved': return 'ATP reservado';
    case 'released': return 'Reserva liberada';
    case 'consumed': return 'Reserva consumida';
    case 'waiting_physical_consumption': return 'Aguardando consumo físico';
    case 'not_applicable': return 'Reserva não aplicável';
    case 'blocked_product_binding_unresolved': return 'Bloqueado · binding';
    case 'blocked_insufficient_atp': return 'Bloqueado · ATP';
    case 'blocked_authority_unresolved': return 'Bloqueado · autoridade';
    default: return 'Reserva ainda não observada';
  }
};

export default function NinetyNineFoodE2EOrderObservationPanel({
  user,
}: {
  user: User;
}) {
  const [items, setItems] = useState<NinetyNineFoodE2EObservedOrder[]>([]);
  const [observedAt, setObservedAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasObserved, setHasObserved] = useState(false);

  const observe = async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const result = await loadNinetyNineFoodE2EObservedOrders(user, 20);
      setItems(result.items);
      setObservedAt(result.observedAt);
      setHasObserved(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível observar os pedidos reais da 99Food.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      id="kyrub-99food-e2e-order-observation"
      className="space-y-3 rounded-2xl border border-orange-500/20 bg-orange-500/[0.025] p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.14em] text-orange-300">
            <Eye className="h-3.5 w-3.5" />
            99Food · observação do pedido real
          </span>
          <p className="mt-2 max-w-3xl text-[8px] leading-relaxed text-slate-400">
            Reconsulta somente o pedido canônico e a evidência do ingress Open Delivery já armazenada. Não cria pedido, não executa polling, não refaz reserva ATP, não muda status e não envia ação à 99Food.
          </p>
        </div>
        <button
          id="kyrub-observe-real-99food-orders"
          type="button"
          onClick={() => void observe()}
          disabled={loading}
          className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-orange-500/25 bg-slate-950 px-3 text-[8px] font-black uppercase text-orange-200 disabled:opacity-40"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Reconsultar pedidos reais
        </button>
      </div>

      {error && (
        <p className="rounded-xl border border-rose-500/20 bg-rose-500/[0.05] p-3 text-[8px] leading-relaxed text-rose-200">
          {error}
        </p>
      )}

      {!error && !hasObserved && (
        <p className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-[8px] leading-relaxed text-slate-500">
          A observação ainda não foi executada nesta sessão. Crie/dispare o pedido pelo ambiente da 99Food e então use a reconsulta acima.
        </p>
      )}

      {hasObserved && !error && items.length === 0 && (
        <p className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-[8px] leading-relaxed text-slate-500">
          Nenhum pedido canônico com `integration.provider = 99food` foi encontrado nesta leitura. Isso não dispara polling nem tenta criar um pedido substituto.
        </p>
      )}

      {items.length > 0 && (
        <div className="space-y-2">
          {items.map(item => {
            const ingressClean = item.inboundEvent.status === 'processed' && Boolean(item.inboundEvent.eventId);
            return (
              <article
                key={item.orderId}
                className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <strong className="block text-[9px] text-slate-100">
                      Pedido {item.displayId}
                    </strong>
                    <span className="mt-1 block break-all font-mono text-[7px] text-slate-600">
                      Kyrub: {item.orderId} · 99Food: {item.externalOrderId}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="rounded-full border border-slate-700 px-2 py-1 text-[7px] font-black uppercase text-slate-300">
                      status {item.status}
                    </span>
                    <span className={`rounded-full border px-2 py-1 text-[7px] font-black uppercase ${
                      ingressClean
                        ? 'border-emerald-500/25 text-emerald-300'
                        : 'border-amber-500/25 text-amber-300'
                    }`}>
                      ingress {item.inboundEvent.status}
                    </span>
                    <span className="rounded-full border border-cyan-500/20 px-2 py-1 text-[7px] font-black uppercase text-cyan-300">
                      {reservationLabel(item)}
                    </span>
                  </div>
                </div>

                <div className="mt-2 grid gap-2 text-[8px] leading-relaxed text-slate-500 sm:grid-cols-2">
                  <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-2">
                    <span className="block text-[7px] font-black uppercase text-slate-600">Ingress Open Delivery</span>
                    <span className="mt-1 block break-all">eventId: {item.inboundEvent.eventId || 'não observado'}</span>
                    <span className="block">eventType: {item.inboundEvent.eventType || item.lastEvent || 'não observado'}</span>
                    <span className="block">processedAt: {item.inboundEvent.processedAt || 'não observado'}</span>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-2">
                    <span className="block text-[7px] font-black uppercase text-slate-600">Reserva canônica</span>
                    <span className="mt-1 block">state: {item.reservation.state}</span>
                    <span className="block">reconciledAt: {item.reservation.reconciledAt || 'não observado'}</span>
                    {item.reservation.detail && (
                      <span className="block break-words">detail: {item.reservation.detail}</span>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
          {observedAt && (
            <p className="text-right font-mono text-[7px] text-slate-700">
              readback Kyrub: {observedAt}
            </p>
          )}
        </div>
      )}

      <div className="flex items-start gap-2 rounded-xl border border-amber-500/15 bg-amber-500/[0.035] p-3 text-[8px] leading-relaxed text-amber-100/70">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Um pedido só constitui prova limpa de ingress quando há identidade externa e evidência de evento processado. Reserva `blocked_*` também é evidência válida do teste, mas exige resolver o bloqueio antes de avançar o status.
        </span>
      </div>
    </section>
  );
}
