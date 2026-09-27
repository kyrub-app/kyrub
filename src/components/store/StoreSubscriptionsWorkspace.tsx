import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react';
import type {
  StoreSubscriberRegistrySummary,
  StoreSubscriberSummary,
} from '../../../shared/storeSubscriberRegistry';
import type { StoreSubscriptionState } from '../../../shared/storeSubscriptionBilling';
import {
  loadStoreSubscriberRegistry,
  reconcileStoreSubscribersWithCrm,
} from '../../utils/storeSubscribers';

type SubscriberFilter = 'all' | StoreSubscriptionState;
type Notice = (message: string, type?: 'success' | 'error' | 'info') => void;

interface StoreSubscriptionsWorkspaceProps {
  user: User;
  storeId: string;
  notify?: Notice;
}

const filters: Array<{ id: SubscriberFilter; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'active', label: 'Ativos' },
  { id: 'payment_due', label: 'Pagamento pendente' },
  { id: 'pending', label: 'Em contratação' },
  { id: 'paused', label: 'Pausados' },
  { id: 'cancelled', label: 'Cancelados' },
];

const stateLabel: Record<StoreSubscriptionState, string> = {
  pending: 'Em contratação',
  active: 'Ativa',
  payment_due: 'Pagamento pendente',
  paused: 'Pausada',
  cancelled: 'Cancelada',
};

const stateClass: Record<StoreSubscriptionState, string> = {
  pending: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
  active: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
  payment_due: 'border-red-500/20 bg-red-500/10 text-red-200',
  paused: 'border-violet-500/20 bg-violet-500/10 text-violet-200',
  cancelled: 'border-slate-700 bg-slate-800/70 text-slate-400',
};

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});
const date = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const dateLabel = (value: string): string => {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Sem registro';
  return date.format(new Date(value));
};

const matchesSearch = (subscriber: StoreSubscriberSummary, query: string): boolean => {
  if (!query) return true;
  const haystack = [
    subscriber.displayName,
    subscriber.email,
    subscriber.customerId,
    ...subscriber.subscriptions.flatMap(subscription => [
      subscription.productName,
      subscription.productId,
    ]),
  ].join(' ').toLocaleLowerCase('pt-BR');
  return haystack.includes(query.toLocaleLowerCase('pt-BR'));
};

export default function StoreSubscriptionsWorkspace({
  user,
  storeId,
  notify,
}: StoreSubscriptionsWorkspaceProps) {
  const [summary, setSummary] = useState<StoreSubscriberRegistrySummary | null>(null);
  const [filter, setFilter] = useState<SubscriberFilter>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  const load = async (): Promise<void> => {
    setError('');
    const next = await loadStoreSubscriberRegistry(user, storeId);
    setSummary(next);
  };

  const reconcileAndLoad = async (announce = false): Promise<void> => {
    setSyncing(true);
    try {
      await reconcileStoreSubscribersWithCrm(user, storeId);
      await load();
      if (announce) notify?.('Assinantes e CRM foram reconciliados.', 'success');
    } catch (reconciliationError) {
      console.warn('Falha ao reconciliar assinantes com CRM:', reconciliationError);
      try {
        await load();
        if (announce) notify?.('A lista foi atualizada, mas o CRM não pôde ser reconciliado agora.', 'info');
      } catch (loadError) {
        const message = loadError instanceof Error
          ? loadError.message
          : 'Não foi possível carregar os assinantes.';
        setError(message);
        if (announce) notify?.(message, 'error');
      }
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    void (async () => {
      try {
        await reconcileStoreSubscribersWithCrm(user, storeId);
      } catch (reconciliationError) {
        console.warn('Reconciliação inicial de assinantes adiada:', reconciliationError);
      }
      try {
        const next = await loadStoreSubscriberRegistry(user, storeId);
        if (mounted) {
          setSummary(next);
          setError('');
        }
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os assinantes.');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [user, storeId]);

  const subscribers = useMemo(() => {
    const source = summary?.subscribers ?? [];
    return source.filter(subscriber => {
      const statusMatches = filter === 'all' ||
        subscriber.subscriptions.some(subscription => subscription.state === filter);
      return statusMatches && matchesSearch(subscriber, query.trim());
    });
  }, [summary, filter, query]);

  const relationshipCount = useMemo(
    () => summary?.subscribers.reduce((total, subscriber) => total + subscriber.subscriptionCount, 0) ?? 0,
    [summary]
  );

  if (loading) {
    return (
      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6 text-[10px] text-slate-400">
        Carregando assinaturas reais da loja…
      </section>
    );
  }

  return (
    <div className="space-y-5" data-kyrub-store-subscriptions="canonical-registry">
      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span className="font-mono text-[9px] font-black uppercase tracking-[0.16em] text-cyan-300">
              Assinaturas
            </span>
            <h3 className="mt-1 text-base font-black text-white">Assinantes da loja</h3>
            <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-slate-500">
              Relações derivadas das assinaturas canônicas. O CRM é apenas sincronizado com clientes que já tiveram pagamento confirmado; nenhuma contratação concede consentimento de marketing.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void reconcileAndLoad(true)}
            disabled={syncing}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 text-[9px] font-black uppercase text-slate-300 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Sincronizando' : 'Sincronizar CRM'}
          </button>
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-2xl border border-red-500/20 bg-red-500/[0.07] p-3 text-[10px] text-red-100" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
            <span className="text-[8px] font-black uppercase text-slate-500">Assinantes</span>
            <strong className="mt-1 block text-lg text-white">{summary?.subscriberCount ?? 0}</strong>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
            <span className="text-[8px] font-black uppercase text-slate-500">Com assinatura ativa</span>
            <strong className="mt-1 block text-lg text-emerald-300">{summary?.activeSubscriberCount ?? 0}</strong>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
            <span className="text-[8px] font-black uppercase text-slate-500">Pagamento pendente</span>
            <strong className="mt-1 block text-lg text-red-300">{summary?.paymentDueSubscriberCount ?? 0}</strong>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
            <span className="text-[8px] font-black uppercase text-slate-500">Contratos registrados</span>
            <strong className="mt-1 block text-lg text-cyan-300">{relationshipCount}</strong>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {filters.map(option => (
              <button
                key={option.id}
                type="button"
                onClick={() => setFilter(option.id)}
                className={`min-h-9 shrink-0 rounded-xl border px-3 text-[9px] font-black uppercase transition-colors ${
                  filter === option.id
                    ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200'
                    : 'border-slate-800 bg-slate-950 text-slate-500 hover:text-slate-300'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 lg:w-72">
            <Search className="h-4 w-4 text-slate-600" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Cliente, e-mail ou produto"
              className="min-w-0 flex-1 bg-transparent text-[10px] text-white outline-none placeholder:text-slate-600"
            />
          </label>
        </div>
      </section>

      {subscribers.length === 0 ? (
        <section className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/60 px-5 py-10 text-center">
          <Users className="mx-auto h-7 w-7 text-slate-700" />
          <h4 className="mt-3 text-xs font-black text-slate-300">
            {summary?.subscriberCount ? 'Nenhum assinante neste filtro' : 'Nenhuma assinatura registrada'}
          </h4>
          <p className="mx-auto mt-1 max-w-md text-[10px] leading-relaxed text-slate-600">
            A tela não cria dados de demonstração. Novos assinantes aparecem aqui somente a partir do runtime canônico de assinatura da loja.
          </p>
        </section>
      ) : (
        <div className="space-y-3">
          {subscribers.map(subscriber => (
            <section key={subscriber.customerId} className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  {subscriber.photoUrl ? (
                    <img src={subscriber.photoUrl} alt="" className="h-11 w-11 shrink-0 rounded-2xl object-cover" />
                  ) : (
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950 text-xs font-black text-cyan-300">
                      {(subscriber.displayName || subscriber.email || 'A').slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0">
                    <strong className="block truncate text-xs text-white">{subscriber.displayName || 'Assinante Kyrub'}</strong>
                    <span className="mt-0.5 block truncate text-[9px] text-slate-500">{subscriber.email || subscriber.customerId}</span>
                    <span className="mt-1 block font-mono text-[8px] uppercase text-slate-600">
                      Desde {dateLabel(subscriber.firstSubscribedAt)} · última atividade {dateLabel(subscriber.lastActivityAt)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[9px]">
                  {subscriber.activeSubscriptions > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 font-black text-emerald-200">
                      <CheckCircle2 className="h-3 w-3" /> {subscriber.activeSubscriptions} ativa(s)
                    </span>
                  )}
                  {subscriber.paymentDueSubscriptions > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/10 px-2 py-1 font-black text-red-200">
                      <Clock3 className="h-3 w-3" /> {subscriber.paymentDueSubscriptions} pendente(s)
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {subscriber.subscriptions.map(subscription => (
                  <div key={subscription.id} className="flex flex-col gap-2 rounded-2xl border border-slate-800 bg-slate-950 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <strong className="block truncate text-[10px] text-slate-200">{subscription.productName}</strong>
                      <span className="mt-0.5 block text-[9px] text-slate-600">
                        {money.format(subscription.amountMinor / 100)} · a cada {subscription.terms.billingInterval.count} {subscription.terms.billingInterval.unit}
                      </span>
                    </div>
                    <span className={`w-fit rounded-full border px-2 py-1 font-mono text-[8px] font-black uppercase ${stateClass[subscription.state]}`}>
                      {stateLabel[subscription.state]}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
