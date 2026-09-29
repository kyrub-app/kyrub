import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  History,
  MinusCircle,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react';
import type {
  StoreSubscriberRegistrySummary,
  StoreSubscriberSubscriptionSummary,
  StoreSubscriberSummary,
} from '../../../shared/storeSubscriberRegistry';
import type { StoreSubscriptionState } from '../../../shared/storeSubscriptionBilling';
import type { StoreSubscriptionBenefitLedgerSnapshot } from '../../../shared/storeSubscriptionBenefits';
import {
  loadStoreSubscriberRegistry,
  reconcileStoreSubscribersWithCrm,
} from '../../utils/storeSubscribers';
import {
  consumeStoreSubscriptionBenefit,
  loadStoreSubscriptionBenefitLedger,
} from '../../utils/storeSubscriptionBenefits';

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
const dateTime = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const dateLabel = (value: string): string => {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Sem registro';
  return date.format(new Date(value));
};
const dateTimeLabel = (value: string): string => {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Sem registro';
  return dateTime.format(new Date(value));
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

const nextOperationId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `benefit-${crypto.randomUUID()}`;
  }
  return `benefit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const benefitKindLabel = (subscription: StoreSubscriberSubscriptionSummary): string => {
  switch (subscription.terms.benefit.kind) {
    case 'usage_credits':
      return 'Créditos de uso';
    case 'recurring_delivery':
      return 'Unidades do ciclo';
    case 'access':
      return 'Acesso do ciclo';
  }
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
  const [expandedSubscriptionId, setExpandedSubscriptionId] = useState<string | null>(null);
  const [benefitLedger, setBenefitLedger] = useState<StoreSubscriptionBenefitLedgerSnapshot | null>(null);
  const [benefitLoading, setBenefitLoading] = useState(false);
  const [benefitError, setBenefitError] = useState('');
  const [usageUnits, setUsageUnits] = useState('1');
  const [usageNote, setUsageNote] = useState('');
  const [pendingUsageOperationId, setPendingUsageOperationId] = useState('');
  const [consumingBenefit, setConsumingBenefit] = useState(false);

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

  const loadBenefits = async (subscriptionId: string): Promise<void> => {
    setBenefitLoading(true);
    setBenefitError('');
    try {
      const ledger = await loadStoreSubscriptionBenefitLedger(user, storeId, subscriptionId);
      setBenefitLedger(ledger);
    } catch (loadError) {
      setBenefitLedger(null);
      setBenefitError(
        loadError instanceof Error
          ? loadError.message
          : 'Não foi possível carregar os benefícios desta assinatura.'
      );
    } finally {
      setBenefitLoading(false);
    }
  };

  const toggleBenefits = (subscriptionId: string): void => {
    if (expandedSubscriptionId === subscriptionId) {
      setExpandedSubscriptionId(null);
      setBenefitLedger(null);
      setBenefitError('');
      setPendingUsageOperationId('');
      return;
    }
    setExpandedSubscriptionId(subscriptionId);
    setBenefitLedger(null);
    setBenefitError('');
    setUsageUnits('1');
    setUsageNote('');
    setPendingUsageOperationId('');
    void loadBenefits(subscriptionId);
  };

  const registerBenefitUsage = async (
    subscription: StoreSubscriberSubscriptionSummary
  ): Promise<void> => {
    const units = Number(usageUnits);
    if (!Number.isInteger(units) || units <= 0) {
      const message = 'Informe uma quantidade inteira positiva.';
      setBenefitError(message);
      notify?.(message, 'error');
      return;
    }

    const currentCycle = benefitLedger?.cycles.find(
      cycle => cycle.id === benefitLedger.currentCycleId
    );
    if (!currentCycle || currentCycle.remainingUnits === null) {
      const message = 'Não existe saldo consumível no ciclo atual.';
      setBenefitError(message);
      notify?.(message, 'error');
      return;
    }
    if (units > currentCycle.remainingUnits) {
      const message = `O ciclo possui somente ${currentCycle.remainingUnits} unidade(s) disponível(is).`;
      setBenefitError(message);
      notify?.(message, 'error');
      return;
    }

    const operationId = pendingUsageOperationId || nextOperationId();
    if (!pendingUsageOperationId) setPendingUsageOperationId(operationId);
    setConsumingBenefit(true);
    setBenefitError('');
    try {
      const result = await consumeStoreSubscriptionBenefit(user, {
        storeId,
        subscriptionId: subscription.id,
        units,
        operationId,
        note: usageNote,
      });
      setPendingUsageOperationId('');
      setUsageUnits('1');
      setUsageNote('');
      await loadBenefits(subscription.id);
      notify?.(
        result.duplicate
          ? 'Esta baixa já havia sido registrada; nenhum saldo foi descontado novamente.'
          : 'Uso do benefício registrado com sucesso.',
        'success'
      );
    } catch (consumeError) {
      const message = consumeError instanceof Error
        ? consumeError.message
        : 'Não foi possível registrar o uso do benefício.';
      setBenefitError(message);
      notify?.(message, 'error');
    } finally {
      setConsumingBenefit(false);
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
                {subscriber.subscriptions.map(subscription => {
                  const expanded = expandedSubscriptionId === subscription.id;
                  const currentCycle = expanded && benefitLedger?.subscriptionId === subscription.id
                    ? benefitLedger.cycles.find(cycle => cycle.id === benefitLedger.currentCycleId) ?? null
                    : null;
                  const benefitKind = subscription.terms.benefit.kind;
                  const consumable = benefitKind !== 'access';

                  return (
                    <div key={subscription.id} className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <strong className="block truncate text-[10px] text-slate-200">{subscription.productName}</strong>
                          <span className="mt-0.5 block text-[9px] text-slate-600">
                            {money.format(subscription.amountMinor / 100)} · a cada {subscription.terms.billingInterval.count} {subscription.terms.billingInterval.unit} · {benefitKindLabel(subscription)}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`w-fit rounded-full border px-2 py-1 font-mono text-[8px] font-black uppercase ${stateClass[subscription.state]}`}>
                            {stateLabel[subscription.state]}
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleBenefits(subscription.id)}
                            className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-slate-700 px-2 text-[8px] font-black uppercase text-cyan-200"
                          >
                            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            Benefícios
                          </button>
                        </div>
                      </div>

                      {expanded && (
                        <div className="mt-3 border-t border-slate-800 pt-3" data-kyrub-subscription-benefit-panel={subscription.id}>
                          {benefitLoading ? (
                            <p className="text-[9px] text-slate-500">Carregando ciclo e histórico…</p>
                          ) : benefitError ? (
                            <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.07] p-3 text-[9px] text-red-100" role="alert">
                              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              <span>{benefitError}</span>
                            </div>
                          ) : !benefitLedger || benefitLedger.subscriptionId !== subscription.id ? (
                            <p className="text-[9px] text-slate-500">Nenhum ledger carregado.</p>
                          ) : (
                            <div className="space-y-3">
                              {currentCycle ? (
                                <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                                  <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div>
                                      <span className="text-[8px] font-black uppercase text-cyan-300">Ciclo pago atual</span>
                                      <p className="mt-1 text-[9px] text-slate-500">
                                        {dateLabel(currentCycle.billingPeriodStartsAt)} → {dateLabel(currentCycle.billingPeriodEndsAt)}
                                      </p>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => void loadBenefits(subscription.id)}
                                      className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-slate-700 px-2 text-[8px] font-black uppercase text-slate-400"
                                    >
                                      <RefreshCw className="h-3 w-3" /> Atualizar
                                    </button>
                                  </div>

                                  {currentCycle.remainingUnits === null ? (
                                    <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] p-3">
                                      <strong className="text-[10px] text-emerald-200">Acesso válido neste ciclo</strong>
                                      <p className="mt-1 text-[9px] text-slate-500">Válido até {dateLabel(currentCycle.billingPeriodEndsAt)}. Assinaturas de acesso não geram unidades artificiais.</p>
                                    </div>
                                  ) : (
                                    <>
                                      <div className="mt-3 grid grid-cols-3 gap-2">
                                        <div className="rounded-xl border border-slate-800 bg-slate-950 p-2">
                                          <span className="text-[7px] font-black uppercase text-slate-600">Concedido</span>
                                          <strong className="mt-1 block text-sm text-white">{currentCycle.grantedUnits}</strong>
                                        </div>
                                        <div className="rounded-xl border border-slate-800 bg-slate-950 p-2">
                                          <span className="text-[7px] font-black uppercase text-slate-600">Usado</span>
                                          <strong className="mt-1 block text-sm text-amber-200">{currentCycle.consumedUnits}</strong>
                                        </div>
                                        <div className="rounded-xl border border-slate-800 bg-slate-950 p-2">
                                          <span className="text-[7px] font-black uppercase text-slate-600">Restante</span>
                                          <strong className="mt-1 block text-sm text-emerald-300">{currentCycle.remainingUnits}</strong>
                                        </div>
                                      </div>

                                      {consumable && subscription.state === 'active' && currentCycle.remainingUnits > 0 && (
                                        <div className="mt-3 grid gap-2 sm:grid-cols-[7rem_1fr_auto] sm:items-end">
                                          <label className="block">
                                            <span className="text-[8px] font-black uppercase text-slate-600">Quantidade</span>
                                            <input
                                              type="number"
                                              min={1}
                                              max={currentCycle.remainingUnits}
                                              step={1}
                                              value={usageUnits}
                                              onChange={event => {
                                                setUsageUnits(event.target.value);
                                                setPendingUsageOperationId('');
                                              }}
                                              className="mt-1 h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-[10px] text-white outline-none"
                                            />
                                          </label>
                                          <label className="block">
                                            <span className="text-[8px] font-black uppercase text-slate-600">Observação opcional</span>
                                            <input
                                              value={usageNote}
                                              maxLength={240}
                                              onChange={event => {
                                                setUsageNote(event.target.value);
                                                setPendingUsageOperationId('');
                                              }}
                                              placeholder={benefitKind === 'recurring_delivery' ? 'Ex.: almoço entregue em 27/09' : 'Ex.: corte realizado'}
                                              className="mt-1 h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-[10px] text-white outline-none placeholder:text-slate-700"
                                            />
                                          </label>
                                          <button
                                            type="button"
                                            disabled={consumingBenefit}
                                            onClick={() => void registerBenefitUsage(subscription)}
                                            className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg bg-cyan-500 px-3 text-[8px] font-black uppercase text-slate-950 disabled:opacity-50"
                                          >
                                            <MinusCircle className="h-3.5 w-3.5" />
                                            {consumingBenefit ? 'Registrando' : 'Registrar uso'}
                                          </button>
                                        </div>
                                      )}
                                    </>
                                  )}
                                </div>
                              ) : (
                                <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/50 p-3 text-[9px] text-slate-500">
                                  Ainda não existe ciclo pago de benefício para esta assinatura.
                                </div>
                              )}

                              <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                                <div className="flex items-center gap-2">
                                  <History className="h-3.5 w-3.5 text-slate-500" />
                                  <strong className="text-[9px] uppercase text-slate-300">Histórico de baixas</strong>
                                </div>
                                {benefitLedger.usages.length === 0 ? (
                                  <p className="mt-2 text-[9px] text-slate-600">Nenhum consumo registrado neste contrato.</p>
                                ) : (
                                  <div className="mt-2 space-y-2">
                                    {benefitLedger.usages.map(usage => (
                                      <div key={usage.id} className="flex flex-col gap-1 rounded-lg border border-slate-800 bg-slate-950 p-2 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="min-w-0">
                                          <span className="block text-[9px] font-black text-slate-300">{usage.units} unidade(s)</span>
                                          {usage.note && <span className="block truncate text-[8px] text-slate-600">{usage.note}</span>}
                                        </div>
                                        <span className="font-mono text-[8px] uppercase text-slate-600">{dateTimeLabel(usage.createdAt)}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {benefitLedger.cycles.length > 1 && (
                                <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                                  <strong className="text-[9px] uppercase text-slate-300">Ciclos anteriores</strong>
                                  <div className="mt-2 space-y-1">
                                    {benefitLedger.cycles.slice(1).map(cycle => (
                                      <div key={cycle.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-950 px-2 py-2 text-[8px] text-slate-600">
                                        <span>{dateLabel(cycle.billingPeriodStartsAt)} → {dateLabel(cycle.billingPeriodEndsAt)}</span>
                                        <span>
                                          {cycle.remainingUnits === null
                                            ? 'Acesso'
                                            : `${cycle.consumedUnits}/${cycle.grantedUnits} usado(s)`}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
