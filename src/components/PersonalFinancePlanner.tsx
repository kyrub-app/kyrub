import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarDays, Check, Plus, Trash2 } from 'lucide-react';

type EntryKind = 'income' | 'fixed' | 'variable';
type PersonalEntry = {
  id: string;
  title: string;
  kind: EntryKind;
  amountCents: number;
  month: string;
  dueDay: number;
  settledMonths: string[];
};

const MAX_ITEMS = 200;
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const currentMonth = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
const isMonth = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const isEntry = (value: unknown): value is PersonalEntry => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && item.id.length <= 80
    && typeof item.title === 'string' && item.title.length > 0 && item.title.length <= 80
    && ['income', 'fixed', 'variable'].includes(String(item.kind))
    && Number.isSafeInteger(item.amountCents) && Number(item.amountCents) > 0 && Number(item.amountCents) <= 999999999
    && isMonth(item.month) && Number.isInteger(item.dueDay) && Number(item.dueDay) >= 1 && Number(item.dueDay) <= 31
    && Array.isArray(item.settledMonths) && item.settledMonths.length <= 120
    && item.settledMonths.every(isMonth);
};
const fromMoney = (input: string): number | null => {
  const trimmed = input.trim();
  if (!/^\d{1,7}([,.]\d{1,2})?$/.test(trimmed)) return null;
  const cents = Math.round(Number(trimmed.replace(',', '.')) * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
};

type PersonalFinancePlannerProps = { userId: string };

/**
 * A manual planning notebook, intentionally separate from the BaaS ledger.
 * No payment initiation and no automatic inference of a settled transaction.
 * Data is per-account and *device-local* until an authorized cloud contract exists.
 */
export function PersonalFinancePlanner({ userId }: PersonalFinancePlannerProps) {
  const [entries, setEntries] = useState<PersonalEntry[]>([]);
  const [loadedFor, setLoadedFor] = useState('');
  const [month, setMonth] = useState(currentMonth);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<EntryKind>('fixed');
  const [value, setValue] = useState('');
  const [dueDay, setDueDay] = useState(10);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setLoadedFor('');
    setEntries([]);
    if (!userId) return;
    try {
      const stored = JSON.parse(localStorage.getItem(`kyrub_personal_budget_v1_${userId}`) || '[]') as unknown;
      setEntries(Array.isArray(stored) ? stored.filter(isEntry).slice(0, MAX_ITEMS) : []);
      setMessage('');
    } catch {
      setEntries([]);
      setMessage('Não foi possível ler o orçamento deste aparelho.');
    }
    setLoadedFor(userId);
  }, [userId]);

  useEffect(() => {
    if (!userId || loadedFor !== userId) return;
    try {
      localStorage.setItem(`kyrub_personal_budget_v1_${userId}`, JSON.stringify(entries));
    } catch {
      setMessage('O armazenamento local está indisponível. Seus lançamentos podem não persistir.');
    }
  }, [entries, userId, loadedFor]);

  const visible = useMemo(
    () => entries.filter(entry => entry.kind === 'fixed'
      ? entry.month <= month
      : entry.month === month),
    [entries, month],
  );
  const totals = useMemo(() => ({
    income: visible.filter(entry => entry.kind === 'income').reduce((total, entry) => total + entry.amountCents, 0),
    expense: visible.filter(entry => entry.kind !== 'income').reduce((total, entry) => total + entry.amountCents, 0),
  }), [visible]);

  const register = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amountCents = fromMoney(value);
    const cleanTitle = title.trim();
    if (!cleanTitle || cleanTitle.length > 80 || amountCents === null) {
      setMessage('Informe uma descrição e um valor positivo, como 125,50.');
      return;
    }
    if (entries.length >= MAX_ITEMS) {
      setMessage('Limite de 200 lançamentos neste aparelho. Remova um registro antigo.');
      return;
    }
    const entry: PersonalEntry = {
      id: crypto.randomUUID(), title: cleanTitle, amountCents, kind,
      month, dueDay, settledMonths: [],
    };
    setEntries(current => [...current, entry]);
    setTitle('');
    setValue('');
    setMessage('Lançamento planejado registrado neste aparelho.');
  };

  const toggleSettled = (entry: PersonalEntry) => {
    setEntries(current => current.map(item => item.id === entry.id
      ? { ...item, settledMonths: item.settledMonths.includes(month)
          ? item.settledMonths.filter(m => m !== month)
          : [...item.settledMonths, month] }
      : item));
  };

  const deleteEntry = (entry: PersonalEntry) => {
    if (!window.confirm(`Excluir "${entry.title}" do seu planejamento?`)) return;
    setEntries(current => current.filter(item => item.id !== entry.id));
  };

  return (
    <section className="space-y-4" id="personal-finance-planner" aria-label="Controle financeiro pessoal">
      <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-sm text-amber-100">
        Planejamento manual, sem pagamentos reais. Estes registros ficam somente neste aparelho,
        sem sincronização entre dispositivos. Não representam saldo bancário.
      </div>
      <label className="block text-sm font-semibold text-slate-200">
        Mês de referência
        <input type="month" value={month} onChange={event => {
          if (isMonth(event.target.value)) setMonth(event.target.value);
        }} className="mt-2 block min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 p-2 text-white" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-slate-700 bg-slate-950 p-3">
          <p className="text-xs text-slate-400">Receitas planejadas</p>
          <strong className="mt-1 block text-sm text-teal-300">{money.format(totals.income / 100)}</strong>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-950 p-3">
          <p className="text-xs text-slate-400">Despesas planejadas</p>
          <strong className="mt-1 block text-sm text-orange-300">{money.format(totals.expense / 100)}</strong>
        </div>
      </div>
      <p className="text-sm text-slate-300">
        Diferença planejada: <strong className={totals.income - totals.expense < 0 ? 'text-orange-300' : 'text-teal-300'}>
          {money.format((totals.income - totals.expense) / 100)}
        </strong>
      </p>
      <form onSubmit={register} className="space-y-3 rounded-2xl border border-slate-700 bg-slate-950 p-3">
        <h4 className="text-base font-bold text-white">Novo lançamento</h4>
        <label className="block text-sm text-slate-300">
          Tipo
          <select value={kind} onChange={event => setKind(event.target.value as EntryKind)}
            className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-white">
            <option value="fixed">Despesa fixa mensal</option>
            <option value="variable">Despesa variável do mês</option>
            <option value="income">Receita do mês</option>
          </select>
        </label>
        <label className="block text-sm text-slate-300">
          Descrição
          <input value={title} maxLength={80} onChange={event => setTitle(event.target.value)}
            placeholder="Ex.: Aluguel" required
            className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-white" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm text-slate-300">
            Valor (R$)
            <input value={value} onChange={event => setValue(event.target.value)} inputMode="decimal"
              placeholder="125,50" required
              className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-white" />
          </label>
          <label className="block text-sm text-slate-300">
            Dia previsto
            <input type="number" min={1} max={31} value={dueDay}
              onChange={event => setDueDay(Math.max(1, Math.min(31, Number(event.target.value) || 1)))}
              className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-white" />
          </label>
        </div>
        <button type="submit" disabled={loadedFor !== userId || !userId}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-3 text-sm font-bold text-slate-950 disabled:opacity-40">
          <Plus className="h-4 w-4" aria-hidden="true" /> Registrar
        </button>
      </form>
      {message && <p role="status" className="text-sm text-slate-300">{message}</p>}
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-white">Lançamentos de {month}</h4>
        {visible.length === 0 && <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">Nenhum lançamento para este mês.</p>}
        {visible.map(entry => {
          const settled = entry.settledMonths.includes(month);
          return <div key={entry.id} className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 p-3">
            <button type="button" onClick={() => toggleSettled(entry)} aria-pressed={settled}
              aria-label={settled ? `Marcar ${entry.title} como pendente` : `Marcar ${entry.title} como concluído`}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${settled ? 'border-teal-500 bg-teal-500/20 text-teal-300' : 'border-slate-700 text-slate-500'}`}>
              {settled ? <Check className="h-4 w-4" /> : <CalendarDays className="h-4 w-4" />}
            </button>
            <div className="min-w-0 flex-1">
              <strong className="block truncate text-sm text-slate-100">{entry.title}</strong>
              <p className="text-xs text-slate-400">
                {entry.kind === 'fixed' ? 'Fixa mensal' : entry.kind === 'income' ? 'Receita' : 'Variável'} · dia {entry.dueDay} · {settled ? 'Concluído manualmente' : 'Previsto'}
              </p>
            </div>
            <strong className="shrink-0 text-xs text-white">{money.format(entry.amountCents / 100)}</strong>
            <button type="button" onClick={() => deleteEntry(entry)} aria-label={`Excluir ${entry.title}`}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:text-red-300">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>;
        })}
      </div>
    </section>
  );
}
