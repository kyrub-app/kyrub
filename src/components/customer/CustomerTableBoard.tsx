import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BellRing,
  Check,
  CheckCircle2,
  ChefHat,
  Clock3,
  LoaderCircle,
  MapPin,
  ReceiptText,
  Utensils,
  Users,
} from 'lucide-react';
import type { LocalServiceRequest } from '../../../shared/localServiceRequest';
import type { ResolvedOrderServiceLocation } from '../../../shared/serviceLocation';
import type { CustomerOrder } from '../../utils/customerOrders';
import {
  acknowledgeLocalServiceRequest,
  loadActiveLocalServiceRequests,
  resolveLocalServiceRequest,
} from '../../utils/localServiceRequests';
import {
  buildCustomerTableCards,
  getCustomerTableStateLabel,
  type CustomerTableCard,
} from '../../utils/customerTables';

interface CustomerTableBoardProps {
  storeId?: string;
  orders: CustomerOrder[];
  onOpenTable?: (tableCode: string) => void;
  onOpenLocation?: (location: ResolvedOrderServiceLocation) => void;
}

const formatElapsedTime = (value: string, now: number): string => {
  const startedAt = new Date(value).getTime();
  if (!Number.isFinite(startedAt)) return '--:--';
  const elapsedMinutes = Math.max(0, Math.floor((now - startedAt) / 60000));
  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min`;
};

const locationKindLabel = (location: ResolvedOrderServiceLocation): string => {
  switch (location.kind) {
    case 'table': return 'Mesa';
    case 'counter': return 'Balcão';
    case 'parking_spot': return 'Vaga';
    case 'room': return 'Quarto';
    case 'chair': return 'Cadeira';
    case 'box': return 'Box';
    case 'service_window': return 'Guichê';
    default: return 'Local';
  }
};

const cardPresentation = (card: CustomerTableCard) => {
  if (card.unacknowledgedRequestCount > 0) {
    return {
      card: 'border-rose-400/80 bg-rose-500/10 shadow-rose-950/40',
      badge: 'border-rose-400/30 bg-rose-500/15 text-rose-100',
      button: 'border-rose-400/40 bg-rose-500 text-white',
      icon: <BellRing className="h-3.5 w-3.5" />,
    };
  }
  switch (card.state) {
    case 'pending':
      return {
        card: 'border-amber-400/80 bg-amber-500/10 shadow-amber-950/40',
        badge: 'border-amber-400/30 bg-amber-500/15 text-amber-200',
        button: 'border-amber-400/50 bg-amber-500 text-slate-950 animate-pulse',
        icon: <BellRing className="h-3.5 w-3.5" />,
      };
    case 'ready':
      return {
        card: 'border-emerald-400/70 bg-emerald-500/10 shadow-emerald-950/30',
        badge: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200',
        button: 'border-emerald-400/50 bg-emerald-600 text-white',
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      };
    case 'preparing':
      return {
        card: 'border-blue-400/60 bg-blue-500/10 shadow-blue-950/30',
        badge: 'border-blue-400/30 bg-blue-500/15 text-blue-200',
        button: 'border-blue-400/40 bg-blue-600 text-white',
        icon: <ChefHat className="h-3.5 w-3.5" />,
      };
    default:
      return {
        card: 'border-slate-700 bg-slate-950 shadow-slate-950/30',
        badge: 'border-slate-700 bg-slate-900 text-slate-300',
        button: 'border-slate-700 bg-slate-800 text-slate-200',
        icon: <ReceiptText className="h-3.5 w-3.5" />,
      };
  }
};

const requestText = (request: LocalServiceRequest): string =>
  request.kind === 'close_account' ? 'Fechar conta' : 'Chamar atendimento';

export const CustomerTableBoard = ({
  storeId,
  orders,
  onOpenTable,
  onOpenLocation,
}: CustomerTableBoardProps) => {
  const [now, setNow] = useState(() => Date.now());
  const [requests, setRequests] = useState<LocalServiceRequest[]>([]);
  const [actingId, setActingId] = useState('');
  const [requestError, setRequestError] = useState('');
  const effectiveStoreId = storeId?.trim() || orders[0]?.storeId?.trim() || '';

  const refreshRequests = useCallback(async (quiet = false): Promise<void> => {
    if (!effectiveStoreId) {
      setRequests([]);
      return;
    }
    try {
      setRequests(await loadActiveLocalServiceRequests(effectiveStoreId));
      if (!quiet) setRequestError('');
    } catch (error) {
      if (!quiet) {
        setRequestError(
          error instanceof Error ? error.message : 'Não foi possível atualizar os chamados.'
        );
      }
    }
  }, [effectiveStoreId]);

  const locations = useMemo(
    () => buildCustomerTableCards(orders, requests),
    [orders, requests]
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void refreshRequests();
    const timer = window.setInterval(() => void refreshRequests(true), 5000);
    return () => window.clearInterval(timer);
  }, [refreshRequests]);

  const actOnRequest = async (
    request: LocalServiceRequest,
    action: 'acknowledge' | 'resolve'
  ): Promise<void> => {
    if (actingId || !effectiveStoreId) return;
    setActingId(request.id);
    setRequestError('');
    try {
      if (action === 'acknowledge') {
        await acknowledgeLocalServiceRequest({ storeId: effectiveStoreId, requestId: request.id });
      } else {
        await resolveLocalServiceRequest({ storeId: effectiveStoreId, requestId: request.id });
      }
      await refreshRequests(true);
    } catch (error) {
      setRequestError(
        error instanceof Error ? error.message : 'Não foi possível atualizar o chamado.'
      );
    } finally {
      setActingId('');
    }
  };

  const openLocation = (location: ResolvedOrderServiceLocation): void => {
    if (onOpenLocation) {
      onOpenLocation(location);
      return;
    }
    onOpenTable?.(location.label);
  };

  if (locations.length === 0) return null;

  return (
    <section className="space-y-3" id="customer-service-location-board">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-slate-300">
            <MapPin className="h-4 w-4 text-orange-400" />
            Locais em atendimento
          </h3>
          <p className="mt-1 text-[9px] text-slate-600">
            Pedido novo, chamado e fechamento de conta aparecem no card do próprio local.
          </p>
        </div>
        <span className="rounded-full border border-slate-800 bg-slate-950 px-2.5 py-1 font-mono text-[9px] font-bold text-slate-500">
          {locations.length} ativo{locations.length === 1 ? '' : 's'}
        </span>
      </div>

      {requestError && (
        <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[9px] text-amber-200" role="status">
          {requestError}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {locations.map(card => {
          const presentation = cardPresentation(card);
          const additionalClients = Math.max(0, card.buyerNames.length - 1);
          const openRequests = card.requests.filter(request => request.status === 'open');
          const acknowledgedRequests = card.requests.filter(request => request.status === 'acknowledged');

          return (
            <article
              key={`${card.serviceLocation.source}:${card.serviceLocation.kind}:${card.serviceLocation.id || card.tableCode}`}
              className={`relative flex min-h-44 w-full min-w-0 flex-col overflow-hidden rounded-2xl border-2 p-3 text-left shadow-xl transition-all sm:min-h-48 sm:p-4 ${presentation.card} ${openRequests.length > 0 ? 'ring-2 ring-rose-400/30' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-mono text-[7px] font-bold uppercase tracking-[0.14em] text-slate-500 sm:text-[8px]">
                    {locationKindLabel(card.serviceLocation)}
                  </span>
                  <h4 className="mt-0.5 truncate text-xl font-black text-white sm:text-2xl">
                    {card.tableCode}
                  </h4>
                </div>
                <span className={`flex max-w-[58%] items-center gap-1 rounded-full border px-1.5 py-1 text-[7px] font-black uppercase sm:px-2 sm:text-[8px] ${presentation.badge}`}>
                  {presentation.icon}
                  <span className="truncate">
                    {openRequests.length > 0
                      ? `${openRequests.length} alerta${openRequests.length === 1 ? '' : 's'}`
                      : getCustomerTableStateLabel(card.state, card.pendingCount)}
                  </span>
                </span>
              </div>

              {(openRequests.length > 0 || acknowledgedRequests.length > 0) && (
                <div className="mt-2 space-y-1.5" aria-live="polite">
                  {[...openRequests, ...acknowledgedRequests].map(request => (
                    <div
                      key={request.id}
                      className={`rounded-xl border px-2 py-2 ${
                        request.kind === 'close_account'
                          ? 'border-rose-400/30 bg-rose-500/10'
                          : 'border-cyan-400/25 bg-cyan-500/10'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <strong className={`text-[8px] font-black uppercase ${request.kind === 'close_account' ? 'text-rose-100' : 'text-cyan-100'}`}>
                          {requestText(request)}
                        </strong>
                        <span className="text-[7px] uppercase text-slate-500">
                          {request.status === 'acknowledged' ? 'Em atendimento' : 'Novo'}
                        </span>
                      </div>
                      <div className="mt-1.5 flex gap-1.5">
                        {request.status === 'open' && (
                          <button
                            type="button"
                            onClick={() => void actOnRequest(request, 'acknowledge')}
                            disabled={Boolean(actingId)}
                            className="flex-1 rounded-lg border border-white/10 bg-slate-950/50 px-2 py-1.5 text-[7px] font-black uppercase text-slate-200 disabled:opacity-40"
                          >
                            {actingId === request.id ? 'Atualizando…' : 'Assumir'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void actOnRequest(request, 'resolve')}
                          disabled={Boolean(actingId)}
                          className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2 py-1.5 text-[7px] font-black uppercase text-emerald-100 disabled:opacity-40"
                        >
                          {actingId === request.id
                            ? <LoaderCircle className="h-3 w-3 animate-spin" />
                            : <Check className="h-3 w-3" />}
                          Resolvido
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-1 flex-col items-center justify-center py-2 text-center sm:py-3">
                <strong className="font-mono text-base text-white sm:text-lg">
                  R$ {card.total.toFixed(2)}
                </strong>
                <span className="mt-1 text-[7px] font-bold uppercase leading-tight text-slate-500 sm:text-[8px]">
                  {card.orderCount} {card.orderCount === 1 ? 'pedido' : 'pedidos'} · {card.itemCount} {card.itemCount === 1 ? 'item' : 'itens'}
                </span>
              </div>

              <button
                type="button"
                onClick={() => openLocation(card.serviceLocation)}
                className={`flex min-h-9 items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-[8px] font-black uppercase tracking-wide sm:text-[9px] ${presentation.button}`}
                aria-label={`Abrir atendimento de ${card.tableCode}`}
              >
                <Utensils className="h-3.5 w-3.5" />
                Abrir atendimento
              </button>

              <div className="mt-2 flex items-end justify-between gap-2 border-t border-white/5 pt-2 text-[8px] text-slate-500 sm:text-[9px]">
                <span className="flex items-center gap-1 font-mono">
                  <Clock3 className="h-3 w-3" />
                  {formatElapsedTime(card.openedAt, now)}
                </span>
                <span className="flex min-w-0 items-center justify-end gap-1">
                  <Users className="h-3 w-3 shrink-0" />
                  <span className="truncate font-bold text-slate-300">
                    {card.primaryBuyerName}
                    {additionalClients > 0 ? ` +${additionalClients}` : ''}
                  </span>
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};
