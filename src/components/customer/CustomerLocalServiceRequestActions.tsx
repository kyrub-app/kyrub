import { useCallback, useEffect, useState } from 'react';
import { BellRing, LoaderCircle, ReceiptText, X } from 'lucide-react';
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

const copyFor = (kind: LocalServiceRequestKind) => kind === 'close_account'
  ? {
      title: 'Fechar conta',
      description: 'Avise a equipe que deseja fechar esta conta. O pedido apenas sinaliza o atendimento; o pagamento continua sendo confirmado pela loja.',
      waiting: 'Fechamento solicitado. Aguardando a equipe.',
      acknowledged: 'A equipe já viu seu pedido de fechamento.',
      success: 'A loja recebeu seu pedido para fechar a conta.',
    }
  : {
      title: 'Chamar atendimento',
      description: 'Avise a equipe que você precisa de atendimento neste local.',
      waiting: 'Chamado enviado. Aguardando a equipe.',
      acknowledged: 'A equipe já viu seu chamado.',
      success: 'A loja recebeu seu chamado de atendimento.',
    };

export const CustomerLocalServiceRequestActions = ({
  storeId,
  order,
  kind,
}: {
  storeId: string;
  order: CustomerOrder;
  kind: LocalServiceRequestKind;
}) => {
  const [current, setCurrent] = useState<LocalServiceRequest | null>(null);
  const [pending, setPending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [message, setMessage] = useState('');
  const copy = copyFor(kind);

  const refresh = useCallback(async (quiet = false): Promise<void> => {
    if (!storeId || !order.id || order.fulfillmentType !== 'dine_in') {
      setCurrent(null);
      return;
    }
    try {
      const requests = await loadOwnActiveLocalServiceRequests({
        storeId,
        orderId: order.id,
      });
      setCurrent(requests.find(request => request.kind === kind) ?? null);
      if (!quiet) setMessage('');
    } catch (error) {
      if (!quiet) {
        setMessage(error instanceof Error ? error.message : 'Não foi possível atualizar o chamado.');
      }
    }
  }, [kind, order.fulfillmentType, order.id, storeId]);

  useEffect(() => {
    if (terminalStatuses.has(order.status) || order.fulfillmentType !== 'dine_in') {
      setCurrent(null);
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
  const unavailable = kind === 'close_account' && outstanding <= 0;

  const request = async (): Promise<void> => {
    if (pending || current || unavailable) return;
    setPending(true);
    setMessage('');
    try {
      const next = await createLocalServiceRequest({
        storeId,
        orderId: order.id,
        kind,
      });
      setCurrent(next);
      setMessage(copy.success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível chamar o atendimento.');
    } finally {
      setPending(false);
    }
  };

  const cancel = async (): Promise<void> => {
    if (!current || cancelling) return;
    setCancelling(true);
    setMessage('');
    try {
      await cancelLocalServiceRequest({
        storeId,
        requestId: current.id,
      });
      setCurrent(null);
      setMessage('Solicitação cancelada.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível cancelar a solicitação.');
    } finally {
      setCancelling(false);
    }
  };

  const Icon = kind === 'close_account' ? ReceiptText : BellRing;

  return (
    <section
      id={`customer-local-service-request-${kind}`}
      className={`rounded-3xl border p-4 ${
        kind === 'close_account'
          ? 'border-rose-500/20 bg-rose-500/[0.04]'
          : 'border-cyan-500/20 bg-cyan-500/[0.04]'
      }`}
    >
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${kind === 'close_account' ? 'text-rose-300' : 'text-cyan-300'}`} />
        <div>
          <h5 className="text-xs font-black uppercase text-white">{copy.title}</h5>
          <p className="mt-1 text-[9px] leading-relaxed text-slate-500">{copy.description}</p>
        </div>
      </div>

      {current ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5">
          <div className="min-w-0">
            <strong className="block text-[9px] text-slate-200">
              {current.status === 'acknowledged' ? copy.acknowledged : copy.waiting}
            </strong>
            <span className="mt-0.5 block text-[8px] text-slate-600">
              A notificação aparece no card deste local no painel da equipe.
            </span>
          </div>
          <button
            type="button"
            onClick={() => void cancel()}
            disabled={cancelling}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-700 px-2 py-1.5 text-[8px] font-black uppercase text-slate-400 disabled:opacity-40"
          >
            {cancelling ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
            Cancelar
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void request()}
          disabled={pending || unavailable}
          className={`mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border px-3 text-[9px] font-black uppercase disabled:cursor-not-allowed disabled:opacity-40 ${
            kind === 'close_account'
              ? 'border-rose-500/25 bg-rose-500/10 text-rose-100'
              : 'border-cyan-500/25 bg-cyan-500/10 text-cyan-100'
          }`}
        >
          {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
          {unavailable ? 'Conta já fechada' : copy.title}
        </button>
      )}

      {message && (
        <p className="mt-3 text-[9px] leading-relaxed text-slate-400" role="status">
          {message}
        </p>
      )}
    </section>
  );
};
