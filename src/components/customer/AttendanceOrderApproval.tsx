import { useEffect, useMemo, useState } from 'react';
import {
  BellRing,
  CheckCircle2,
  Minus,
  Plus,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { auth } from '../../utils/firebase';
import type { CustomerOrder } from '../../utils/customerOrders';
import {
  getPendingAttendanceOrders,
  reviewAttendanceOrder,
  type AttendanceReviewItem,
} from '../../utils/orderWorkflow';

interface AttendanceOrderApprovalProps {
  storeId: string;
  tableCode: string;
  orders: CustomerOrder[];
  notify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

type EditableLine = AttendanceReviewItem & {
  name: string;
  price: number;
};

const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function AttendanceOrderApproval({
  storeId,
  tableCode,
  orders,
  notify,
}: AttendanceOrderApprovalProps) {
  const pendingOrders = useMemo(
    () => getPendingAttendanceOrders(orders, tableCode),
    [orders, tableCode]
  );
  const order = pendingOrders[0] ?? null;
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [customerNote, setCustomerNote] = useState('');
  const [reason, setReason] = useState('');
  const [alternative, setAlternative] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!order) {
      setLines([]);
      setCustomerNote('');
      setReason('');
      setAlternative('');
      setRejecting(false);
      return;
    }
    setLines(
      order.items.map(item => ({
        lineId: item.lineId,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        note: item.note,
      }))
    );
    setCustomerNote(order.customerNote);
    setReason('');
    setAlternative('');
    setRejecting(false);
  }, [order?.id]);

  if (!order) return null;

  const total = lines.reduce(
    (sum, line) => sum + line.price * line.quantity,
    0
  );

  const updateQuantity = (lineId: string, quantity: number): void => {
    setLines(previous =>
      previous.map(line =>
        line.lineId === lineId
          ? { ...line, quantity: Math.max(0, quantity) }
          : line
      )
    );
  };

  const updateNote = (lineId: string, note: string): void => {
    setLines(previous =>
      previous.map(line =>
        line.lineId === lineId ? { ...line, note } : line
      )
    );
  };

  const reset = (): void => {
    setLines(
      order.items.map(item => ({
        lineId: item.lineId,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        note: item.note,
      }))
    );
    setCustomerNote(order.customerNote);
  };

  const approve = async (): Promise<void> => {
    const user = auth.currentUser;
    if (!user) {
      notify('Faça login novamente para revisar o pedido.', 'error');
      return;
    }
    setBusy(true);
    try {
      await reviewAttendanceOrder(user, storeId, order.id, {
        action: 'approve',
        items: lines.map(({ lineId, quantity, note }) => ({
          lineId,
          quantity,
          note,
        })),
        customerNote,
      });
      notify(`Pedido da mesa ${tableCode} aprovado e enviado ao KDS.`, 'success');
    } catch (error) {
      notify(
        error instanceof Error ? error.message : 'Não foi possível aprovar o pedido.',
        'error'
      );
    } finally {
      setBusy(false);
    }
  };

  const reject = async (): Promise<void> => {
    const user = auth.currentUser;
    if (!user) {
      notify('Faça login novamente para revisar o pedido.', 'error');
      return;
    }
    if (!reason.trim()) {
      notify('Explique o motivo da recusa.', 'error');
      return;
    }
    setBusy(true);
    try {
      await reviewAttendanceOrder(user, storeId, order.id, {
        action: 'reject',
        items: [],
        customerNote,
        reason,
        alternative,
      });
      notify(`Pedido da mesa ${tableCode} recusado com justificativa.`, 'info');
    } catch (error) {
      notify(
        error instanceof Error ? error.message : 'Não foi possível recusar o pedido.',
        'error'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[132] flex items-end justify-center bg-slate-950/80 backdrop-blur-sm sm:items-center sm:p-5">
      <section className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-amber-500/30 bg-slate-900 p-4 shadow-2xl sm:rounded-3xl sm:p-6">
        <header className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500 text-slate-950">
              <BellRing className="h-5 w-5" />
            </span>
            <div>
              <span className="font-mono text-[9px] font-black uppercase tracking-[0.18em] text-amber-300">
                Aprovação do atendimento
              </span>
              <h3 className="mt-1 text-lg font-black text-white">
                Novo pedido · {tableCode}
              </h3>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                Revise, altere ou recuse antes de liberar a produção. Este pedido ainda não aparece no KDS.
              </p>
            </div>
          </div>
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[8px] font-black uppercase text-amber-200">
            {pendingOrders.length} pendente{pendingOrders.length === 1 ? '' : 's'}
          </span>
        </header>

        <div className="mt-5 space-y-3">
          {lines.map(line => (
            <article
              key={line.lineId}
              className="rounded-2xl border border-slate-800 bg-slate-950 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-xs text-white">
                    {line.name}
                  </strong>
                  <span className="mt-1 block font-mono text-[10px] text-slate-500">
                    {currency.format(line.price)} por unidade
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => updateQuantity(line.lineId, line.quantity - 1)}
                    disabled={busy}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-400 disabled:opacity-40"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="min-w-7 text-center font-mono text-sm font-black text-white">
                    {line.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => updateQuantity(line.lineId, line.quantity + 1)}
                    disabled={busy}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 text-slate-950 disabled:opacity-40"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <input
                type="text"
                value={line.note}
                onChange={event => updateNote(line.lineId, event.target.value)}
                disabled={busy}
                placeholder="Observação ou ajuste deste item"
                className="mt-3 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[10px] text-white outline-none focus:border-amber-500 disabled:opacity-40"
              />
            </article>
          ))}
        </div>

        <label className="mt-4 block text-[9px] font-black uppercase text-slate-500">
          Observação geral
          <textarea
            value={customerNote}
            onChange={event => setCustomerNote(event.target.value)}
            disabled={busy}
            rows={2}
            className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] normal-case text-white outline-none focus:border-amber-500 disabled:opacity-40"
          />
        </label>

        <div className="mt-4 flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3">
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className="flex items-center gap-1.5 text-[9px] font-black uppercase text-slate-500 disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Restaurar pedido
          </button>
          <strong className="font-mono text-base text-white">
            {currency.format(total)}
          </strong>
        </div>

        {rejecting && (
          <div className="mt-4 space-y-3 rounded-2xl border border-red-500/25 bg-red-500/5 p-4">
            <label className="block text-[9px] font-black uppercase text-red-200">
              Motivo obrigatório
              <textarea
                value={reason}
                onChange={event => setReason(event.target.value)}
                disabled={busy}
                rows={2}
                placeholder="Explique ao cliente por que este pedido não pode ser atendido"
                className="mt-1.5 w-full rounded-xl border border-red-500/20 bg-slate-950 px-3 py-2 text-[10px] normal-case text-white outline-none focus:border-red-400"
              />
            </label>
            <label className="block text-[9px] font-black uppercase text-slate-500">
              Alternativa sugerida
              <input
                type="text"
                value={alternative}
                onChange={event => setAlternative(event.target.value)}
                disabled={busy}
                placeholder="Ex.: substituir o item por outra opção disponível"
                className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[10px] normal-case text-white outline-none focus:border-amber-500"
              />
            </label>
          </div>
        )}

        <footer className="mt-5 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => {
              if (!rejecting) {
                setRejecting(true);
                return;
              }
              void reject();
            }}
            disabled={busy}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 text-[10px] font-black uppercase text-red-300 disabled:opacity-40"
          >
            <XCircle className="h-4 w-4" />
            {busy && rejecting ? 'Recusando...' : rejecting ? 'Confirmar recusa' : 'Recusar pedido'}
          </button>
          <button
            type="button"
            onClick={() => void approve()}
            disabled={busy}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-[10px] font-black uppercase text-white disabled:opacity-40"
          >
            <CheckCircle2 className="h-4 w-4" />
            {busy && !rejecting ? 'Aprovando...' : 'Aprovar e enviar ao KDS'}
          </button>
        </footer>
      </section>
    </div>
  );
}
