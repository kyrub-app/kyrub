import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, Check, LoaderCircle } from 'lucide-react';
import type { LocalServiceRequest } from '../../../shared/localServiceRequest';
import {
  serviceLocationIdentityKey,
  type ResolvedOrderServiceLocation,
} from '../../../shared/serviceLocation';
import {
  acknowledgeLocalServiceRequest,
  loadActiveLocalServiceRequests,
  resolveLocalServiceRequest,
} from '../../utils/localServiceRequests';

interface ServiceLocationRequestPanelProps {
  storeId: string;
  location: ResolvedOrderServiceLocation;
}

const requestLabel = (request: LocalServiceRequest): string =>
  request.kind === 'close_account' ? 'Fechar conta' : 'Chamar atendimento';

export function ServiceLocationRequestPanel({
  storeId,
  location,
}: ServiceLocationRequestPanelProps) {
  const [requests, setRequests] = useState<LocalServiceRequest[]>([]);
  const [actingId, setActingId] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const refresh = useCallback(async (quiet = false): Promise<void> => {
    try {
      const next = await loadActiveLocalServiceRequests(storeId);
      setRequests(next);
      if (!quiet) setErrorMessage('');
    } catch (error) {
      if (!quiet) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Não foi possível atualizar os chamados deste local.'
        );
      }
    }
  }, [storeId]);

  useEffect(() => {
    setRequests([]);
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const locationRequests = useMemo(() => {
    const expected = serviceLocationIdentityKey(location);
    return requests.filter(request =>
      (request.status === 'open' || request.status === 'acknowledged') &&
      serviceLocationIdentityKey(request.serviceLocation) === expected
    );
  }, [location, requests]);

  const act = async (
    request: LocalServiceRequest,
    action: 'acknowledge' | 'resolve'
  ): Promise<void> => {
    if (actingId) return;
    setActingId(request.id);
    setErrorMessage('');
    try {
      if (action === 'acknowledge') {
        await acknowledgeLocalServiceRequest({ storeId, requestId: request.id });
      } else {
        await resolveLocalServiceRequest({ storeId, requestId: request.id });
      }
      await refresh(true);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Não foi possível atualizar o chamado.'
      );
    } finally {
      setActingId('');
    }
  };

  if (locationRequests.length === 0 && !errorMessage) return null;

  return (
    <section
      id="kyrub-service-location-request-panel"
      className="mt-5 rounded-2xl border border-rose-500/20 bg-rose-500/[0.04] p-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-[9px] font-black uppercase tracking-wide text-rose-100">
            <BellRing className="h-4 w-4 text-rose-300" />
            Chamados deste local
          </h3>
          <p className="mt-1 text-[8px] leading-relaxed text-slate-500">
            Os mesmos chamados exibidos no card da Service Location. Assumir ou resolver não registra pagamento.
          </p>
        </div>
        {locationRequests.length > 0 && (
          <span className="rounded-full border border-rose-400/20 bg-rose-500/10 px-2 py-1 font-mono text-[8px] font-black text-rose-100">
            {locationRequests.length}
          </span>
        )}
      </div>

      {errorMessage && (
        <p className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[9px] text-amber-100" role="status">
          {errorMessage}
        </p>
      )}

      {locationRequests.length > 0 && (
        <div className="mt-3 space-y-2">
          {locationRequests.map(request => (
            <article
              key={request.id}
              className={`rounded-xl border px-3 py-2 ${
                request.kind === 'close_account'
                  ? 'border-rose-400/25 bg-rose-500/10'
                  : 'border-cyan-400/20 bg-cyan-500/[0.06]'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <strong className="text-[9px] font-black uppercase text-white">
                    {requestLabel(request)}
                  </strong>
                  <span className="ml-2 text-[8px] uppercase text-slate-500">
                    {request.status === 'acknowledged' ? 'Em atendimento' : 'Novo'}
                  </span>
                </div>
                <span className="font-mono text-[8px] text-slate-600">
                  #{request.occurrence}
                </span>
              </div>

              <div className="mt-2 flex gap-2">
                {request.status === 'open' && (
                  <button
                    type="button"
                    onClick={() => void act(request, 'acknowledge')}
                    disabled={Boolean(actingId)}
                    className="flex-1 rounded-lg border border-white/10 bg-slate-950/60 px-2 py-2 text-[8px] font-black uppercase text-slate-200 disabled:opacity-40"
                  >
                    {actingId === request.id ? 'Atualizando…' : 'Assumir'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void act(request, 'resolve')}
                  disabled={Boolean(actingId)}
                  className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2 py-2 text-[8px] font-black uppercase text-emerald-100 disabled:opacity-40"
                >
                  {actingId === request.id
                    ? <LoaderCircle className="h-3 w-3 animate-spin" />
                    : <Check className="h-3 w-3" />}
                  Resolvido
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
