import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Coins,
  Crown,
  Gift,
  RefreshCw,
  Search,
  ShoppingBag,
  TicketCheck,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type {
  StoreCrmCustomer,
  StoreCrmSummary,
} from '../../../shared/storeCrm';
import { loadStoreCrmForCurrentOwner } from '../../utils/storeCrm';

type CrmFilter = 'all' | 'recurring' | 'points' | 'challenges' | 'rewards';

interface StoreCrmPanelProps {
  storeId: string;
}

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const dateTime = (value: string): string => {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Sem compra confirmada';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
};

const matchesFilter = (customer: StoreCrmCustomer, filter: CrmFilter): boolean => {
  if (filter === 'recurring') return customer.confirmedPurchases >= 3;
  if (filter === 'points') return customer.pointsBalance > 0;
  if (filter === 'challenges') return customer.challengeProgressCount > 0;
  if (filter === 'rewards') {
    return customer.availableRewardCount > 0 || customer.rewardRedemptionCount > 0;
  }
  return true;
};

export function StoreCrmPanel({ storeId }: StoreCrmPanelProps) {
  const [summary, setSummary] = useState<StoreCrmSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<CrmFilter>('all');

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    setErrorMessage('');
    try {
      setSummary(await loadStoreCrmForCurrentOwner(storeId));
    } catch (error) {
      console.error('Falha ao carregar CRM canônico:', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'Não foi possível carregar o CRM.'
      );
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleCustomers = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase('pt-BR');
    return (summary?.customers ?? []).filter(customer => {
      if (!matchesFilter(customer, filter)) return false;
      if (!normalized) return true;
      return (
        customer.name.toLocaleLowerCase('pt-BR').includes(normalized) ||
        customer.email.toLocaleLowerCase('pt-BR').includes(normalized) ||
        customer.customerId.toLocaleLowerCase('pt-BR').includes(normalized)
      );
    });
  }, [filter, search, summary?.customers]);

  return (
    <section
      id="store-crm-canonical-panel"
      className="rounded-3xl border border-slate-800 bg-slate-950/70 p-4 shadow-xl"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-orange-300">
            <Users className="h-5 w-5" />
            <h3 className="text-sm font-black uppercase tracking-wide text-white">
              CRM · Clientes
            </h3>
          </div>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-500">
            Espelho canônico do relacionamento. Compras, nível, pontos, desafios e
            recompensas são derivados dos registros reais e não são editáveis aqui.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex min-h-9 items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 text-[10px] font-black uppercase text-slate-300 hover:border-orange-500/40 hover:text-orange-300 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-[10px] font-bold text-red-300"
        >
          {errorMessage}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
        <MetricCard
          icon={Users}
          label="Clientes"
          value={String(summary?.totals.customers ?? 0)}
        />
        <MetricCard
          icon={ShoppingBag}
          label="Recorrentes"
          value={String(summary?.totals.recurringCustomers ?? 0)}
        />
        <MetricCard
          icon={Crown}
          label="Fiéis"
          value={String(summary?.totals.loyalCustomers ?? 0)}
        />
        <MetricCard
          icon={Coins}
          label="Pontos em aberto"
          value={String(summary?.totals.outstandingStorePoints ?? 0)}
        />
        <MetricCard
          icon={Gift}
          label="Receita confirmada"
          value={money.format(summary?.totals.confirmedRevenue ?? 0)}
        />
      </div>

      <div className="mt-4 flex flex-col gap-2 lg:flex-row lg:items-center">
        <label className="flex min-h-10 flex-1 items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3">
          <Search className="h-4 w-4 text-slate-500" />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Buscar cliente, e-mail ou ID"
            className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-slate-600"
          />
        </label>
        <div className="flex gap-1 overflow-x-auto pb-1 lg:pb-0">
          {([
            ['all', 'Todos'],
            ['recurring', 'Recorrentes'],
            ['points', 'Com pontos'],
            ['challenges', 'Desafios'],
            ['rewards', 'Recompensas'],
          ] as const).map(([id, label]) => (
            <button
              type="button"
              key={id}
              onClick={() => setFilter(id)}
              className={`shrink-0 rounded-xl border px-3 py-2 text-[9px] font-black uppercase ${
                filter === id
                  ? 'border-orange-500/50 bg-orange-500/10 text-orange-300'
                  : 'border-slate-800 bg-slate-900 text-slate-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {loading && !summary ? (
          <div className="rounded-2xl border border-dashed border-slate-800 px-4 py-8 text-center text-xs text-slate-500">
            Carregando relacionamento dos clientes…
          </div>
        ) : visibleCustomers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-800 px-4 py-8 text-center text-xs text-slate-500">
            Nenhum cliente com relacionamento canônico neste filtro.
          </div>
        ) : (
          visibleCustomers.map(customer => (
            <CustomerCard key={customer.customerId} customer={customer} />
          ))
        )}
      </div>
    </section>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
      <Icon className="h-4 w-4 text-orange-400" />
      <span className="mt-2 block text-[8px] font-black uppercase tracking-wider text-slate-500">
        {label}
      </span>
      <strong className="mt-1 block text-sm font-black text-white">{value}</strong>
    </div>
  );
}

function CustomerCard({ customer }: { customer: StoreCrmCustomer }) {
  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-900/75 p-3">
      <div className="flex items-start gap-3">
        {customer.avatarUrl ? (
          <img
            src={customer.avatarUrl}
            alt=""
            className="h-10 w-10 shrink-0 rounded-xl object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-xs font-black text-orange-300">
            {customer.name.slice(0, 1).toLocaleUpperCase('pt-BR')}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="truncate text-xs text-white">{customer.name}</strong>
            <span className="rounded-full border border-orange-500/20 bg-orange-500/10 px-2 py-0.5 text-[8px] font-black uppercase text-orange-300">
              {customer.relationshipLevel.label}
            </span>
          </div>
          <span className="mt-0.5 block truncate text-[9px] text-slate-500">
            {customer.email || customer.customerId}
          </span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <SmallStat
          icon={ShoppingBag}
          label="Compras"
          value={String(customer.confirmedPurchases)}
        />
        <SmallStat
          icon={Gift}
          label="Total confirmado"
          value={money.format(customer.totalPaid)}
        />
        <SmallStat
          icon={Coins}
          label="Pontos"
          value={String(customer.pointsBalance)}
        />
        <SmallStat
          icon={Trophy}
          label="Desafios"
          value={`${customer.completedChallengeCount}/${customer.challengeProgressCount}`}
        />
      </div>

      <div className="mt-2 flex flex-wrap gap-2 text-[9px] text-slate-500">
        <span>Ticket médio: {money.format(customer.averageTicket)}</span>
        <span>•</span>
        <span>Última compra: {dateTime(customer.lastPurchaseAt)}</span>
        <span>•</span>
        <span>{customer.availableRewardCount} recompensa(s) disponível(is)</span>
        <span>•</span>
        <span>{customer.rewardRedemptionCount} resgate(s)</span>
        {customer.availableVoucherCount > 0 && (
          <>
            <span>•</span>
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <TicketCheck className="h-3 w-3" />
              {customer.availableVoucherCount} voucher(s) disponível(is)
            </span>
          </>
        )}
      </div>
    </article>
  );
}

function SmallStat({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-slate-950/70 p-2">
      <div className="flex items-center gap-1 text-slate-500">
        <Icon className="h-3 w-3" />
        <span className="text-[8px] font-black uppercase">{label}</span>
      </div>
      <strong className="mt-1 block text-[11px] text-slate-200">{value}</strong>
    </div>
  );
}
