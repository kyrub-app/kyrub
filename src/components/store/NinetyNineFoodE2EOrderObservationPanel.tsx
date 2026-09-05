import { useState } from 'react';
import type { User } from 'firebase/auth';
import { Eye, RefreshCw, ShieldAlert } from 'lucide-react';
import { requestCanonicalOrderNavigation } from '../../utils/canonicalOrderNavigation';
import {
  loadNinetyNineFoodE2EObservedOrders,
  type NinetyNineFoodE2EObservedOrder,
} from '../../utils/ninetyNineFoodE2EOrderObservation';
import {
  clearNinetyNineFoodE2ETestSubject,
  clearNinetyNineFoodE2ETestWindow,
  isNinetyNineFoodE2EOrderFreshForWindow,
  readNinetyNineFoodE2ETestSubject,
  readNinetyNineFoodE2ETestWindow,
  selectNinetyNineFoodE2ETestSubject,
  startNinetyNineFoodE2ETestWindow,
  type NinetyNineFoodE2ETestSubject,
  type NinetyNineFoodE2ETestWindow,
} from '../../utils/ninetyNineFoodE2ETestSubject';

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
  const storeId = user.uid;
  const [items, setItems] = useState<NinetyNineFoodE2EObservedOrder[]>([]);
  const [observedAt, setObservedAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasObserved, setHasObserved] = useState(false);
  const [testWindow, setTestWindow] = useState<NinetyNineFoodE2ETestWindow | null>(
    () => readNinetyNineFoodE2ETestWindow(storeId)
  );
  const [subject, setSubject] = useState<NinetyNineFoodE2ETestSubject | null>(
    () => readNinetyNineFoodE2ETestSubject(storeId)
  );

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

  const startWindow = (): void => {
    const nextWindow = startNinetyNineFoodE2ETestWindow(storeId);
    setTestWindow(nextWindow);
    setSubject(null);
    setError('');
  };

  const endWindow = (): void => {
    clearNinetyNineFoodE2ETestWindow(storeId);
    setTestWindow(null);
    setSubject(null);
  };

  const chooseSubject = (item: NinetyNineFoodE2EObservedOrder): void => {
    const selected = selectNinetyNineFoodE2ETestSubject(storeId, item);
    if (!selected) {
      setError('Este pedido não pertence à janela atual ou não possui ingress processado suficiente para ser a cobaia do teste.');
      return;
    }
    setSubject(selected);
    setError('');
  };

  const releaseSubject = (): void => {
    clearNinetyNineFoodE2ETestSubject(storeId);
    setSubject(null);
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

      <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/[0.035] p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <strong className="block text-[8px] font-black uppercase text-cyan-200">
              Cobaia desta sessão
            </strong>
            <p className="mt-1 max-w-3xl text-[8px] leading-relaxed text-slate-500">
              Inicie a janela antes de criar o pedido na 99Food. Só ingress recebido depois desse instante pode ser escolhido. O Kyrub nunca seleciona automaticamente o “último pedido”.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              id="kyrub-start-99food-e2e-test-window"
              type="button"
              onClick={startWindow}
              className="min-h-9 rounded-lg border border-cyan-500/25 px-3 text-[8px] font-black uppercase text-cyan-200"
            >
              {testWindow ? 'Reiniciar janela' : 'Iniciar janela'}
            </button>
            {testWindow && (
              <button
                id="kyrub-end-99food-e2e-test-window"
                type="button"
                onClick={endWindow}
                className="min-h-9 rounded-lg border border-slate-700 px-3 text-[8px] font-black uppercase text-slate-400"
              >
                Encerrar janela
              </button>
            )}
          </div>
        </div>

        {testWindow && (
          <p className="mt-2 font-mono text-[7px] text-cyan-300/70">
            Aceitar candidatos com ingress recebido a partir de {testWindow.startedAt}
          </p>
        )}

        {subject && (
          <div
            id="kyrub-99food-e2e-selected-subject"
            className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] p-3"
          >
            <strong className="text-[9px] text-emerald-200">
              Cobaia selecionada: pedido {subject.displayId}
            </strong>
            <p className="mt-1 break-all font-mono text-[7px] text-slate-500">
              Kyrub {subject.orderId} · 99Food {subject.externalOrderId} · evento {subject.inboundEventId}
            </p>
            <p className="mt-1 text-[8px] text-slate-500">
              Reserva observada na seleção: {subject.reservationState}. Esta seleção é contexto local; não autoriza mudança de status nem provider write.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                id="kyrub-open-99food-e2e-test-subject"
                type="button"
                onClick={() => {
                  requestCanonicalOrderNavigation({
                    storeId,
                    orderId: subject.orderId,
                  });
                }}
                className="min-h-9 rounded-lg bg-emerald-500 px-3 text-[8px] font-black uppercase text-slate-950"
              >
                Abrir pedido no KDS
              </button>
              <button
                id="kyrub-clear-99food-e2e-test-subject"
                type="button"
                onClick={releaseSubject}
                className="min-h-9 rounded-lg border border-slate-700 px-3 text-[8px] font-black uppercase text-slate-400"
              >
                Desvincular cobaia
              </button>
            </div>
          </div>
        )}
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
            const freshCandidate = isNinetyNineFoodE2EOrderFreshForWindow(item, testWindow);
            const selected = subject?.orderId === item.orderId && subject.externalOrderId === item.externalOrderId;
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
                    {testWindow && (
                      <span className={`rounded-full border px-2 py-1 text-[7px] font-black uppercase ${
                        freshCandidate
                          ? 'border-cyan-500/25 text-cyan-300'
                          : 'border-slate-700 text-slate-600'
                      }`}>
                        {freshCandidate ? 'novo nesta janela' : 'fora da janela'}
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-2 grid gap-2 text-[8px] leading-relaxed text-slate-500 sm:grid-cols-2">
                  <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-2">
                    <span className="block text-[7px] font-black uppercase text-slate-600">Ingress Open Delivery</span>
                    <span className="mt-1 block break-all">eventId: {item.inboundEvent.eventId || 'não observado'}</span>
                    <span className="block">eventType: {item.inboundEvent.eventType || item.lastEvent || 'não observado'}</span>
                    <span className="block">receivedAt: {item.inboundEvent.receivedAt || 'não observado'}</span>
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

                {testWindow && freshCandidate && !selected && (
                  <button
                    id={`kyrub-select-99food-e2e-subject-${item.orderId}`}
                    type="button"
                    onClick={() => chooseSubject(item)}
                    className="mt-3 min-h-9 rounded-lg border border-cyan-500/25 bg-cyan-500/[0.06] px-3 text-[8px] font-black uppercase text-cyan-200"
                  >
                    Usar este pedido como cobaia
                  </button>
                )}
                {selected && (
                  <p className="mt-3 text-[8px] font-black uppercase text-emerald-300">
                    Cobaia ativa desta sessão
                  </p>
                )}
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
          Um pedido só constitui prova limpa de ingress quando há identidade externa e evidência de evento processado. Reserva `blocked_*` também é evidência válida do teste, mas exige resolver o bloqueio antes de avançar o status. Selecionar ou abrir a cobaia nunca concede autoridade de status.
        </span>
      </div>
    </section>
  );
}
