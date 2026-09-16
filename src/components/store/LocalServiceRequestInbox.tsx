import { useCallback, useEffect, useState } from 'react';
import {
  BellRing,
  Check,
  CreditCard,
  LoaderCircle,
  MapPin,
} from 'lucide-react';
import type { LocalServiceRequest } from '../../../shared/localServiceRequest';
import {
  acknowledgeLocalServiceRequest,
  loadActiveLocalServiceRequests,
  resolveLocalServiceRequest,
} from '../../utils/localServiceRequests';

const time = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
};

const kindLabel = (request: LocalServiceRequest): string =>
  request.kind === 'payment_terminal'
    ? 'Solicitou maquininha'
    : 'Chamou atendimento';

export const LocalServiceRequestInbox = ({ storeId }: { storeId: string }) => {
  const [requests, setRequests] = useState<LocalServiceRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [actingId, setActingId] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async (quiet = false): Promise<void> => {
    if (!storeId) return;
    if (!quiet) setLoading(true);
    try {
      setRequests(await loadActiveLocalServiceRequests(storeId));
      if (!quiet) setMessage('');
    } catch (error) {
      if (!quiet) {
        setMessage(error instanceof Error ? error.message : 'Não foi possível carregar os chamados.');
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const act = async (
    request: LocalServiceRequest,
    action: 'acknowledge' | 'resolve'
  ): Promise<void> => {
    if (actingId) return;
    setActingId(request.id);
    setMessage('');
    try {
      if (action === 'acknowledge') {
        await acknowledgeLocalServiceRequest({ storeId, requestId: request.id });
      } else {
        await resolveLocalServiceRequest({ storeId, requestId: request.id });
      }
      await refresh(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível atualizar o chamado.');
    } finally {
      setActingId('');
    }
  };

  if (!loading && requests.length === 0 && !message) return null;

  return (
    <section
      id="kyrub-local-service-request-inbox"
      className="mt-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.04] p-3 sm:p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
          <div>
            <h3 className="text-[10px] font-black uppercase text-white">Chamados do atendimento</h3>
            <p className="mt-1 text-[8px] leading-relaxed text-slate-500">
              Chamados operacionais do local. Eles não confirmam nem registram pagamento.
            </p>
          </div>
        </div>
        <span className="rounded-full border border-cyan-500/20 px-2.5 py-1 font-mono text-[8px] font-black text-cyan-200">
          {requests.length}
        </span>
      </div>

      {loading ? (
        <div className="mt-3 flex items-center gap-2 text-[9px] text-slate-500">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Carregando chamados…
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {requests.map(request => (
            <article
              key={request.id}
              className="rounded-xl border border-slate-800 bg-slate-950/80 p-3"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {request.kind === 'payment_terminal'
                      ? <CreditCard className="h-4 w-4 shrink-0 text-amber-300" />
                      : <BellRing className="h-4 w-4 shrink-0 text-cyan-300" />}
                    <strong className="truncate text-[10px] text-white">
                      {kindLabel(request)}
                    </strong>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[8px] text-slate-500">
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {request.serviceLocation.label}
                    </span>
                    <span>Pedido {request.orderId.slice(-8)}</span>
                    <span>{time(request.requestedAt)}</span>
                    {request.occurrence > 1 && <span>chamada #{request.occurrence}</span>}
                  </div>
                  {request.status === 'acknowledged' && (
                    <span className="mt-1 block text-[8px] font-bold text-emerald-300">
                      Atendimento reconhecido pela equipe
                    </span>
                  )}
                </div>

                <div className="flex shrink-0 gap-2">
                  {request.status === 'open' && (
                    <button
                      type="button"
                      onClick={() => void act(request, 'acknowledge')}
                      disabled={Boolean(actingId)}
                      className="rounded-lg border border-cyan-500/25 bg-cyan-500/10 px-3 py-2 text-[8px] font-black uppercase text-cyan-100 disabled:opacity-40"
                    >
                      {actingId === request.id ? 'Atualizando…' : 'Assumir'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void act(request, 'resolve')}
                    disabled={Boolean(actingId)}
                    className="flex items-center gap-1 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-[8px] font-black uppercase text-emerald-100 disabled:opacity-40"
                  >
                    <Check className="h-3 w-3" /> Resolvido
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {message && (
        <p className="mt-3 text-[9px] text-amber-200" role="status">{message}</p>
      )}
    </section>
  );
};
