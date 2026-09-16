import { useCallback, useEffect, useState } from 'react';
import { BellRing, CreditCard, LoaderCircle, X } from 'lucide-react';
import type { CustomerOrder } from '../../utils/customerOrders';
import { getCustomerOrderOutstandingTotal } from '../../utils/customerOrders';
import {
  cancelLocalServiceRequest,
  createLocalServiceRequest,
  loadOwnActiveLocalServiceRequests,
} from '../../utils/localServiceRequests';
import type {
  LocalServiceRequest,
  LocalServiceRequestKind,
} from '../../../shared/localServiceRequest';

const terminalStatuses = new Set(['completed', 'rejected', 'cancelled']);

const requestLabel = (kind: LocalServiceRequestKind): string =>
  kind === 'payment_terminal' ? 'Maquininha solicitada' : 'Atendimento solicitado';

export const CustomerLocalServiceRequestActions = ({
  storeId,
  order,
}: {
  storeId: string;
  order: CustomerOrder;
}) => {
  const [requests, setRequests] = useState<LocalServiceRequest[]>([]);
  const [pendingKind, setPendingKind] = useState<LocalServiceRequestKind | ''>('');
  const [cancellingId, setCancellingId] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async (quiet = false): Promise<void> => {
    if (!storeId || !order.id || order.fulfillmentType !== 'dine_in') {
      setRequests([]);
      return;
    }
    try {
      setRequests(await loadOwnActiveLocalServiceRequests({
        storeId,
        orderId: order.id,
      }));
      if (!quiet) setMessage('');
    } catch (error) {
      if (!quiet) {
        setMessage(error instanceof Error ? error.message : 'Não foi possível atualizar seus chamados.');
      }
    }
  }, [order.fulfillmentType, order.id, storeId]);

  useEffect(() => {
    if (terminalStatuses.has(order.status) || order.fulfillmentType !== 'dine_in') {
      setRequests([]);
      return;
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 5000);
    return () => window.clearInterval(timer);
  }, [order.fulfillmentType, order.status, refresh]);

  if (
    order.fulfillmentType !== 'dine_in' ||
    terminalStatuses.has(order.status)
  ) return null;

  const outstanding = getCustomerOrderOutstandingTotal(order);
  const activeFor = (kind: LocalServiceRequestKind): LocalServiceRequest | undefined =>
    requests.find(request => request.kind === kind);

  const request = async (kind: LocalServiceRequestKind): Promise<void> => {
    if (pendingKind || activeFor(kind)) return;
    setPendingKind(kind);
    setMessage('');
    try {
      const next = await createLocalServiceRequest({
        storeId,
        orderId: order.id,
        kind,
      });
      setRequests(current => [
        ...current.filter(request => request.kind !== kind),
        next,
      ]);
      setMessage(
        kind === 'payment_terminal'
          ? 'A loja recebeu sua solicitação de maquininha.'
          : 'A loja recebeu seu chamado de atendimento.'
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível chamar o atendimento.');
    } finally {
      setPendingKind('');
    }
  };

  const cancel = async (current: LocalServiceRequest): Promise<void> => {
    if (cancellingId) return;
    setCancellingId(current.id);
    setMessage('');
    try {
      await cancelLocalServiceRequest({
        storeId,
        requestId: current.id,
      });
      setRequests(items => items.filter(item => item.id !== current.id));
      setMessage('Solicitação cancelada.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível cancelar a solicitação.');
    } finally {
      setCancellingId('');
    }
  };

  const assistance = activeFor('assistance');
  const paymentTerminal = activeFor('payment_terminal');

  return (
    <section
      id="customer-local-service-request-actions"
      className="rounded-3xl border border-slate-800 bg-slate-950 p-4"
    >
      <div>
        <h5 className="text-xs font-black uppercase text-white">Precisa de atendimento?</h5>
        <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
          O chamado avisa a equipe sobre este pedido e este local. Ele não confirma pagamento e não cria cobrança.
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void request('assistance')}
          disabled={Boolean(pendingKind) || Boolean(assistance)}
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 text-[9px] font-black uppercase text-cyan-100 disabled:opacity-40"
        >
          {pendingKind === 'assistance'
            ? <LoaderCircle className="h-4 w-4 animate-spin" />
            : <BellRing className="h-4 w-4" />}
          Chamar staff
        </button>
        <button
          type="button"
          onClick={() => void request('payment_terminal')}
          disabled={Boolean(pendingKind) || Boolean(paymentTerminal) || outstanding <= 0}
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 text-[9px] font-black uppercase text-amber-100 disabled:opacity-40"
        >
          {pendingKind === 'payment_terminal'
            ? <LoaderCircle className="h-4 w-4 animate-spin" />
            : <CreditCard className="h-4 w-4" />}
          Solicitar maquininha
        </button>
      </div>

      {requests.length > 0 && (
        <div className="mt-3 space-y-2">
          {requests.map(current => (
            <div
              key={current.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2"
            >
              <div className="min-w-0">
                <strong className="block text-[9px] text-slate-200">{requestLabel(current.kind)}</strong>
                <span className="text-[8px] text-slate-600">
                  {current.status === 'acknowledged' ? 'A equipe já viu o chamado.' : 'Aguardando a equipe.'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void cancel(current)}
                disabled={Boolean(cancellingId)}
                className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-700 px-2 py-1.5 text-[8px] font-black uppercase text-slate-400 disabled:opacity-40"
              >
                {cancellingId === current.id
                  ? <LoaderCircle className="h-3 w-3 animate-spin" />
                  : <X className="h-3 w-3" />}
                Cancelar
              </button>
            </div>
          ))}
        </div>
      )}

      {message && (
        <p className="mt-3 text-[9px] leading-relaxed text-slate-400" role="status">
          {message}
        </p>
      )}
    </section>
  );
};
