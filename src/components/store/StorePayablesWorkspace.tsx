import { useMemo, useState } from 'react';
import { auth } from '../../utils/firebase';

export type StorePayableStatus = 'open' | 'paid' | 'cancelled';
export type StorePayableCategory =
  | 'supplier'
  | 'inventory'
  | 'rent'
  | 'utilities'
  | 'tax'
  | 'service'
  | 'other';
export type StorePayableRecurrence = 'none' | 'monthly';

export type StorePayable = {
  id: string;
  status: StorePayableStatus;
  currency: 'BRL';
  amountMinor: number;
  description: string;
  category: StorePayableCategory;
  counterparty: string;
  dueDate: string;
  recurrence: StorePayableRecurrence;
  sourceAuthority: 'store_owner_manual';
  createdAt: string;
  updatedAt: string;
  paidAt: string;
  cancelledAt: string;
};

export type StorePayableSummary = {
  currency: 'BRL';
  openMinor: number;
  overdueMinor: number;
  dueSoonMinor: number;
  paidMinor: number;
  count: number;
  openCount: number;
};

type MutationPayload = {
  payable?: StorePayable;
  error?: string;
};

type Props = {
  storeId: string;
  payables: StorePayable[];
  summary?: StorePayableSummary;
  onReload: () => Promise<void> | void;
};

const money = (minor: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(minor / 100);

const dateOnlyLabel = (value: string): string => {
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(date)
    : value;
};

const categoryLabel = (category: StorePayableCategory): string => ({
  supplier: 'Fornecedor',
  inventory: 'Estoque / insumos',
  rent: 'Aluguel',
  utilities: 'Água, luz e serviços básicos',
  tax: 'Impostos e taxas',
  service: 'Serviços contratados',
  other: 'Outros',
}[category]);

const amountToMinor = (value: string): number | null => {
  const normalized = value.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  const minor = Math.round(amount * 100);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
};

const payableState = (payable: StorePayable, today: string): {
  label: string;
  className: string;
} => {
  if (payable.status === 'paid') {
    return {
      label: 'Paga',
      className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
    };
  }
  if (payable.status === 'cancelled') {
    return {
      label: 'Cancelada',
      className: 'border-slate-700 bg-slate-900 text-slate-500',
    };
  }
  if (payable.dueDate < today) {
    return {
      label: 'Vencida',
      className: 'border-rose-500/20 bg-rose-500/10 text-rose-200',
    };
  }
  if (payable.dueDate === today) {
    return {
      label: 'Vence hoje',
      className: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
    };
  }
  return {
    label: 'Em aberto',
    className: 'border-cyan-500/20 bg-cyan-500/10 text-cyan-200',
  };
};

async function mutateStoreFinance(
  storeId: string,
  body: Record<string, unknown>
): Promise<MutationPayload> {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente.');
  const token = await user.getIdToken();
  const response = await fetch('/api/store-finance', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ storeId, ...body }),
  });
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error('O Financeiro respondeu em um formato inesperado.');
  }
  const payload = await response.json() as MutationPayload;
  if (!response.ok) throw new Error(payload.error || 'Não foi possível atualizar a conta.');
  return payload;
}

export default function StorePayablesWorkspace({
  storeId,
  payables,
  summary,
  onReload,
}: Props) {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [category, setCategory] = useState<StorePayableCategory>('supplier');
  const [counterparty, setCounterparty] = useState('');
  const [recurrence, setRecurrence] = useState<StorePayableRecurrence>('none');
  const [saving, setSaving] = useState(false);
  const [changingId, setChangingId] = useState('');
  const [feedback, setFeedback] = useState('');
  const [feedbackError, setFeedbackError] = useState(false);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const createPayable = async () => {
    const amountMinor = amountToMinor(amount);
    if (!description.trim() || !dueDate || amountMinor === null) {
      setFeedbackError(true);
      setFeedback('Informe descrição, valor válido e vencimento.');
      return;
    }

    setSaving(true);
    setFeedback('');
    setFeedbackError(false);
    try {
      await mutateStoreFinance(storeId, {
        action: 'create_payable',
        description: description.trim(),
        amountMinor,
        dueDate,
        category,
        counterparty: counterparty.trim(),
        recurrence,
      });
      setDescription('');
      setAmount('');
      setDueDate('');
      setCounterparty('');
      setRecurrence('none');
      setFeedback('Conta registrada no financeiro da loja.');
      await onReload();
    } catch (caught) {
      setFeedbackError(true);
      setFeedback(caught instanceof Error ? caught.message : 'Não foi possível registrar a conta.');
    } finally {
      setSaving(false);
    }
  };

  const changePayable = async (
    payableId: string,
    action: 'mark_payable_paid' | 'cancel_payable'
  ) => {
    setChangingId(payableId);
    setFeedback('');
    setFeedbackError(false);
    try {
      await mutateStoreFinance(storeId, { action, payableId });
      setFeedback(action === 'mark_payable_paid'
        ? 'Pagamento da conta registrado.'
        : 'Conta cancelada.');
      await onReload();
    } catch (caught) {
      setFeedbackError(true);
      setFeedback(caught instanceof Error ? caught.message : 'Não foi possível atualizar a conta.');
    } finally {
      setChangingId('');
    }
  };

  return (
    <div
      className="min-w-0 max-w-full overflow-hidden rounded-3xl border border-amber-500/20 bg-slate-900 p-5"
      data-kyrub-store-payables="canonical"
    >
      <div className="min-w-0">
        <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-amber-300">
          Contas a pagar
        </span>
        <h4 className="mt-1 text-xs font-black uppercase">Despesas e compromissos da loja</h4>
        <p className="mt-2 text-[9px] leading-relaxed text-slate-400">
          Estes registros pertencem ao financeiro canônico da loja e só são criados pelo proprietário. Uma conta marcada como mensal registra a recorrência, mas não cria parcelas futuras escondidas automaticamente.
        </p>
      </div>

      <div className="mt-4 grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <article className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <span className="text-[8px] font-black uppercase text-slate-600">Em aberto</span>
          <strong className="mt-1 block text-sm text-amber-100">{money(summary?.openMinor ?? 0)}</strong>
          <span className="mt-1 block text-[8px] text-slate-600">{summary?.openCount ?? 0} conta(s)</span>
        </article>
        <article className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <span className="text-[8px] font-black uppercase text-slate-600">Vencidas</span>
          <strong className="mt-1 block text-sm text-rose-200">{money(summary?.overdueMinor ?? 0)}</strong>
        </article>
        <article className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <span className="text-[8px] font-black uppercase text-slate-600">Próximos 7 dias</span>
          <strong className="mt-1 block text-sm text-cyan-200">{money(summary?.dueSoonMinor ?? 0)}</strong>
        </article>
        <article className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <span className="text-[8px] font-black uppercase text-slate-600">Pagas registradas</span>
          <strong className="mt-1 block text-sm text-emerald-200">{money(summary?.paidMinor ?? 0)}</strong>
        </article>
      </div>

      <form
        className="mt-4 min-w-0 rounded-2xl border border-slate-800 bg-slate-950 p-4"
        onSubmit={event => {
          event.preventDefault();
          void createPayable();
        }}
      >
        <div className="mb-3">
          <h5 className="text-[10px] font-black uppercase text-slate-200">Registrar nova conta</h5>
          <p className="mt-1 text-[8px] leading-relaxed text-slate-600">
            Salários não entram por este formulário: a folha será vinculada aos membros reais do RH em uma etapa própria.
          </p>
        </div>

        <div className="grid min-w-0 gap-3 md:grid-cols-2">
          <label className="min-w-0 text-[8px] font-black uppercase text-slate-500 md:col-span-2">
            Descrição
            <input
              value={description}
              onChange={event => setDescription(event.target.value)}
              maxLength={160}
              className="mt-1 min-h-10 w-full min-w-0 rounded-xl border border-slate-700 bg-slate-900 px-3 text-[10px] font-medium normal-case text-white outline-none focus:border-amber-400"
              placeholder="Ex.: energia elétrica"
            />
          </label>

          <label className="min-w-0 text-[8px] font-black uppercase text-slate-500">
            Valor
            <input
              value={amount}
              onChange={event => setAmount(event.target.value)}
              inputMode="decimal"
              className="mt-1 min-h-10 w-full min-w-0 rounded-xl border border-slate-700 bg-slate-900 px-3 text-[10px] font-medium normal-case text-white outline-none focus:border-amber-400"
              placeholder="0,00"
            />
          </label>

          <label className="min-w-0 text-[8px] font-black uppercase text-slate-500">
            Vencimento
            <input
              type="date"
              value={dueDate}
              onChange={event => setDueDate(event.target.value)}
              className="mt-1 min-h-10 w-full min-w-0 rounded-xl border border-slate-700 bg-slate-900 px-3 text-[10px] font-medium normal-case text-white outline-none focus:border-amber-400"
            />
          </label>

          <label className="min-w-0 text-[8px] font-black uppercase text-slate-500">
            Categoria
            <select
              value={category}
              onChange={event => setCategory(event.target.value as StorePayableCategory)}
              className="mt-1 min-h-10 w-full min-w-0 rounded-xl border border-slate-700 bg-slate-900 px-3 text-[10px] font-medium normal-case text-white outline-none focus:border-amber-400"
            >
              <option value="supplier">Fornecedor</option>
              <option value="inventory">Estoque / insumos</option>
              <option value="rent">Aluguel</option>
              <option value="utilities">Água, luz e serviços básicos</option>
              <option value="tax">Impostos e taxas</option>
              <option value="service">Serviços contratados</option>
              <option value="other">Outros</option>
            </select>
          </label>

          <label className="min-w-0 text-[8px] font-black uppercase text-slate-500">
            Recorrência
            <select
              value={recurrence}
              onChange={event => setRecurrence(event.target.value as StorePayableRecurrence)}
              className="mt-1 min-h-10 w-full min-w-0 rounded-xl border border-slate-700 bg-slate-900 px-3 text-[10px] font-medium normal-case text-white outline-none focus:border-amber-400"
            >
              <option value="none">Não recorrente</option>
              <option value="monthly">Mensal</option>
            </select>
          </label>

          <label className="min-w-0 text-[8px] font-black uppercase text-slate-500 md:col-span-2">
            Favorecido / fornecedor (opcional)
            <input
              value={counterparty}
              onChange={event => setCounterparty(event.target.value)}
              maxLength={120}
              className="mt-1 min-h-10 w-full min-w-0 rounded-xl border border-slate-700 bg-slate-900 px-3 text-[10px] font-medium normal-case text-white outline-none focus:border-amber-400"
            />
          </label>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="mt-4 min-h-10 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 text-[9px] font-black uppercase text-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Registrando…' : 'Registrar conta'}
        </button>
      </form>

      {feedback && (
        <p className={`mt-3 rounded-xl border p-3 text-[9px] ${feedbackError
          ? 'border-rose-500/20 bg-rose-500/10 text-rose-200'
          : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'}`}>
          {feedback}
        </p>
      )}

      <div className="mt-4 min-w-0">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h5 className="text-[10px] font-black uppercase text-slate-300">Contas registradas</h5>
          <span className="text-[8px] text-slate-600">{summary?.count ?? payables.length} registro(s)</span>
        </div>

        {payables.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-700 p-4 text-center text-[9px] leading-relaxed text-slate-500">
            Nenhuma conta a pagar foi registrada. O Kyrub não cria despesas fictícias para preencher esta área.
          </p>
        ) : (
          <div className="min-w-0 space-y-2">
            {payables.map(payable => {
              const state = payableState(payable, today);
              const changing = changingId === payable.id;
              return (
                <article
                  key={payable.id}
                  className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 p-3"
                >
                  <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <strong className="max-w-full break-words text-[10px] [overflow-wrap:anywhere]">
                          {payable.description}
                        </strong>
                        <span className={`rounded-full border px-2 py-1 text-[7px] font-black uppercase ${state.className}`}>
                          {state.label}
                        </span>
                        {payable.recurrence === 'monthly' && (
                          <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-1 text-[7px] font-black uppercase text-violet-200">
                            Mensal
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-[8px] text-slate-500">
                        {categoryLabel(payable.category)} · vence em {dateOnlyLabel(payable.dueDate)}
                      </p>
                      {payable.counterparty && (
                        <p className="mt-1 max-w-full break-words text-[8px] text-slate-600 [overflow-wrap:anywhere]">
                          Favorecido: {payable.counterparty}
                        </p>
                      )}
                      {payable.status === 'paid' && payable.paidAt && (
                        <p className="mt-1 text-[8px] text-emerald-300/70">
                          Pagamento registrado em {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(payable.paidAt))}
                        </p>
                      )}
                    </div>
                    <strong className="shrink-0 text-left text-sm text-amber-100 sm:text-right">
                      {money(payable.amountMinor)}
                    </strong>
                  </div>

                  {payable.status === 'open' && (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-800 pt-3">
                      <button
                        type="button"
                        disabled={changing}
                        onClick={() => void changePayable(payable.id, 'mark_payable_paid')}
                        className="min-h-9 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 text-[8px] font-black uppercase text-emerald-100 disabled:opacity-50"
                      >
                        {changing ? 'Atualizando…' : 'Marcar paga'}
                      </button>
                      <button
                        type="button"
                        disabled={changing}
                        onClick={() => void changePayable(payable.id, 'cancel_payable')}
                        className="min-h-9 rounded-lg border border-slate-700 px-3 text-[8px] font-black uppercase text-slate-400 disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
