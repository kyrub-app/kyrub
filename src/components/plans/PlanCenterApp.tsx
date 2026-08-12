import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  BadgeCheck,
  Check,
  ExternalLink,
  LoaderCircle,
  LogIn,
  LogOut,
  PackageCheck,
  Sparkles,
  Store,
  TicketPercent,
  Zap,
} from 'lucide-react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  KYRUB_COMMERCIAL_PLAN_BILLING_AVAILABLE,
  KYRUB_COMMERCIAL_PLANS_V1,
  formatKyrubPlanMonthlyPrice,
  type KyrubCommercialPlanId,
} from '../../../shared/kyrubCommercialPlans';
import type { KyrubActivePlanPublicEntry } from '../../../shared/kyrubActivePlanCatalog';
import { hydrateActivePlanCatalog } from '../../utils/activePlanCatalog';
import {
  reconcileOwnStoreEntitlement,
  redeemKyrubCoupon,
} from '../../utils/couponRedemption';
import { auth, db } from '../../utils/firebase';
import { getPrimaryUserStoreDocumentPath } from '../../utils/storePaths';

type PlanView = {
  id: KyrubCommercialPlanId;
  name: string;
  price: number;
  catalogLimit: number | null;
  credits: number;
  commission: number;
  positioning: string;
  features: KyrubActivePlanPublicEntry['features'] | null;
};

const planOrder: readonly KyrubCommercialPlanId[] = ['free', 'pro', 'business'];

const labels: Record<KyrubCommercialPlanId, string> = {
  free: 'Free',
  pro: 'Pro',
  business: 'Business',
};

const normalizePlan = (value: unknown): KyrubCommercialPlanId =>
  value === 'pro' || value === 'business' ? value : 'free';

const planFromPublicEntry = (entry: KyrubActivePlanPublicEntry): PlanView => ({
  id: entry.planId,
  name: labels[entry.planId],
  price: entry.monthlyPriceBRL,
  catalogLimit: entry.activeCatalogLimit,
  credits: entry.kyrubiaIntelligenceCredits,
  commission: entry.marketplaceOriginatedSaleCommissionPercent,
  positioning: KYRUB_COMMERCIAL_PLANS_V1[entry.planId].positioning,
  features: entry.features,
});

const compiledPlan = (id: KyrubCommercialPlanId): PlanView => {
  const plan = KYRUB_COMMERCIAL_PLANS_V1[id];
  return {
    id,
    name: plan.name,
    price: plan.monthlyPriceBRL,
    catalogLimit: plan.activeCatalogLimit,
    credits: plan.kyrubiaIntelligenceCredits,
    commission: plan.marketplaceOriginatedSaleCommissionPercent,
    positioning: plan.positioning,
    features: null,
  };
};

const catalogLabel = (limit: number | null): string =>
  limit === null
    ? 'Catálogo comercialmente ilimitado*'
    : `Até ${limit.toLocaleString('pt-BR')} produtos ou serviços ativos`;

const planRank = (plan: KyrubCommercialPlanId): number => planOrder.indexOf(plan);

export function PlanCenterApp() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [currentPlan, setCurrentPlan] = useState<KyrubCommercialPlanId | null>(null);
  const [plans, setPlans] = useState<PlanView[]>(() => planOrder.map(compiledPlan));
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [couponBusy, setCouponBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    const controller = new AbortController();
    void hydrateActivePlanCatalog(controller.signal, true)
      .then(snapshot => {
        if (!snapshot) return;
        const byId = new Map(snapshot.plans.map(plan => [plan.planId, plan]));
        setPlans(
          planOrder.map(planId => {
            const entry = byId.get(planId);
            return entry ? planFromPublicEntry(entry) : compiledPlan(planId);
          })
        );
      })
      .finally(() => setCatalogLoading(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setCurrentPlan(null);
    if (!user) return;

    void reconcileOwnStoreEntitlement(user).catch(() => undefined);
    return onSnapshot(
      doc(db, getPrimaryUserStoreDocumentPath(user.uid)),
      snapshot => {
        if (!snapshot.exists()) {
          setCurrentPlan('free');
          return;
        }
        setCurrentPlan(normalizePlan(snapshot.data().plan));
      },
      () => setCurrentPlan(null)
    );
  }, [user]);

  const activePlan = useMemo(
    () => plans.find(plan => plan.id === currentPlan) ?? null,
    [currentPlan, plans]
  );

  const login = async () => {
    if (authBusy) return;
    setAuthBusy(true);
    setError('');
    setMessage('');
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (caught) {
      const code =
        caught && typeof caught === 'object' && 'code' in caught
          ? String((caught as { code?: unknown }).code ?? '')
          : '';
      setError(
        code.includes('unauthorized-domain')
          ? 'Este domínio ainda precisa ser autorizado no Firebase Authentication antes do primeiro login da Central de Planos.'
          : caught instanceof Error
            ? caught.message
            : 'Não foi possível entrar com Google agora.'
      );
    } finally {
      setAuthBusy(false);
    }
  };

  const logout = async () => {
    await signOut(auth);
    setMessage('');
    setError('');
  };

  const redeem = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedCode = couponCode.trim().toUpperCase();
    if (!user) {
      setError('Entre com sua conta Kyrub antes de resgatar um cupom.');
      return;
    }
    if (!normalizedCode || couponBusy) return;
    if (!window.confirm(`Aplicar o cupom ${normalizedCode} à sua Loja Kyrub?`)) return;

    setCouponBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await redeemKyrubCoupon(user, normalizedCode);
      setCurrentPlan(result.plan);
      setCouponCode('');
      setMessage(
        `${result.code} aplicado com sucesso. Sua Loja Kyrub agora está no plano ${labels[result.plan]}${
          result.benefitEndsAt
            ? ` até ${new Date(result.benefitEndsAt).toLocaleDateString('pt-BR')}`
            : ''
        }.`
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Não foi possível resgatar este cupom.'
      );
    } finally {
      setCouponBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#020817] text-slate-100">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <header className="flex flex-col gap-5 border-b border-slate-800 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
              <Zap className="h-6 w-6" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-cyan-400">planos.kyrub.com</p>
              <h1 className="text-2xl font-black text-white">Central de Planos Kyrub</h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href="https://www.kyrub.com"
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-300 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" /> Voltar ao Kyrub
            </a>
            {user ? (
              <button
                type="button"
                onClick={() => void logout()}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-xs font-bold text-slate-300 hover:text-white"
              >
                <LogOut className="h-4 w-4" /> Sair
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void login()}
                disabled={authBusy}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-black text-slate-950 disabled:opacity-60"
              >
                {authBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                Entrar com Google
              </button>
            )}
          </div>
        </header>

        <section className="py-8 text-center sm:py-12">
          <span className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-cyan-300">
            <Sparkles className="h-3.5 w-3.5" /> O menor plano suficiente para cada fase
          </span>
          <h2 className="mx-auto mt-4 max-w-3xl text-3xl font-black leading-tight text-white sm:text-5xl">
            Cresça sua Loja Kyrub sem misturar operação com contratação.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-slate-400 sm:text-base">
            Compare capacidades, acompanhe seu plano e resgate benefícios em um lugar separado do ERP.
          </p>
        </section>

        {user && (
          <section className="mb-7 rounded-3xl border border-cyan-500/20 bg-cyan-500/5 p-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-cyan-400">Seu plano atual</p>
              <div className="mt-2 flex items-center gap-2">
                <Store className="h-5 w-5 text-cyan-300" />
                <strong className="text-2xl font-black text-white">
                  {currentPlan ? labels[currentPlan] : 'Carregando…'}
                </strong>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                {activePlan
                  ? `${catalogLabel(activePlan.catalogLimit)} · ${activePlan.credits.toLocaleString('pt-BR')} Créditos Kyrubia Inteligência/mês`
                  : 'Consultando o entitlement autoritativo da sua loja.'}
              </p>
            </div>
            <div className="mt-4 text-xs text-slate-500 sm:mt-0 sm:text-right">
              Conta conectada<br />
              <span className="text-slate-300">{user.email}</span>
            </div>
          </section>
        )}

        <section className="grid gap-4 md:grid-cols-3">
          {plans.map(plan => {
            const isCurrent = currentPlan === plan.id;
            const isUpgrade = currentPlan ? planRank(plan.id) > planRank(currentPlan) : false;
            return (
              <article
                key={plan.id}
                className={`relative flex flex-col rounded-3xl border p-5 ${
                  plan.id === 'pro'
                    ? 'border-violet-500/40 bg-violet-500/5'
                    : 'border-slate-800 bg-slate-900/60'
                }`}
              >
                {plan.id === 'pro' && (
                  <span className="absolute right-4 top-4 rounded-full bg-violet-500/15 px-2.5 py-1 text-[9px] font-black uppercase text-violet-300">
                    Próximo passo natural
                  </span>
                )}
                <div className="pr-24">
                  <h3 className="text-xl font-black text-white">{plan.name}</h3>
                  <p className="mt-1 text-xs text-slate-500">{plan.positioning}</p>
                </div>
                <div className="mt-5">
                  <strong className="text-3xl font-black text-white">
                    {formatKyrubPlanMonthlyPrice(plan.price)}
                  </strong>
                  <span className="text-xs text-slate-500"> / mês</span>
                </div>
                <ul className="mt-5 flex-1 space-y-3 text-xs text-slate-300">
                  <li className="flex gap-2"><PackageCheck className="h-4 w-4 shrink-0 text-cyan-400" /> {catalogLabel(plan.catalogLimit)}</li>
                  <li className="flex gap-2"><Sparkles className="h-4 w-4 shrink-0 text-violet-400" /> {plan.credits.toLocaleString('pt-BR')} Créditos Kyrubia Inteligência/mês</li>
                  <li className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-emerald-400" /> Comissão de referência de {plan.commission}% em vendas originadas pelo Kyrub</li>
                  {plan.features?.team && <li className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-emerald-400" /> Equipe habilitada</li>}
                  {plan.features?.automations && <li className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-emerald-400" /> Automações habilitadas</li>}
                  {plan.features?.integrations && <li className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-emerald-400" /> Integrações habilitadas</li>}
                </ul>
                <div className="mt-6">
                  {isCurrent ? (
                    <div className="flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 text-sm font-black text-emerald-300">
                      <BadgeCheck className="h-4 w-4" /> Plano atual
                    </div>
                  ) : plan.id === 'free' ? (
                    <div className="min-h-11 rounded-2xl border border-slate-800 px-4 py-3 text-center text-xs font-bold text-slate-500">
                      Plano gratuito disponível
                    </div>
                  ) : KYRUB_COMMERCIAL_PLAN_BILLING_AVAILABLE ? (
                    <button type="button" className="min-h-11 w-full rounded-2xl bg-violet-500 px-4 text-sm font-black text-white">
                      {isUpgrade ? `Contratar ${plan.name}` : `Alterar para ${plan.name}`}
                    </button>
                  ) : (
                    <div className="min-h-11 rounded-2xl border border-slate-700 px-4 py-3 text-center text-xs font-bold text-slate-400">
                      Contratação paga em breve
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </section>

        <section className="mt-7 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-violet-500/25 bg-slate-900 p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-300">
                <TicketPercent className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-violet-300">Benefício Kyrub</p>
                <h3 className="text-lg font-black text-white">Tem um cupom?</h3>
              </div>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              O servidor valida campanha, validade, limite de usos e elegibilidade antes de alterar seu plano. Cupom não simula pagamento.
            </p>

            {user ? (
              <form onSubmit={redeem} className="mt-5 flex flex-col gap-2 sm:flex-row">
                <input
                  value={couponCode}
                  onChange={event => setCouponCode(event.target.value.toUpperCase().replace(/\s+/g, ''))}
                  placeholder="Ex.: KYRUB-PRO-BETA-001"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={40}
                  disabled={couponBusy}
                  className="min-h-12 flex-1 rounded-2xl border border-slate-700 bg-slate-950 px-4 font-mono text-sm uppercase text-white outline-none focus:border-violet-500/60 disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={couponBusy || !couponCode.trim()}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-violet-500 px-5 text-sm font-black text-white hover:bg-violet-400 disabled:opacity-50"
                >
                  {couponBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <TicketPercent className="h-4 w-4" />}
                  {couponBusy ? 'Validando' : 'Aplicar cupom'}
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => void login()}
                disabled={authBusy}
                className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-2xl bg-white px-5 text-sm font-black text-slate-950 disabled:opacity-60"
              >
                <LogIn className="h-4 w-4" /> Entrar para resgatar
              </button>
            )}

            {message && <div role="status" className="mt-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{message}</div>}
            {error && <div role="alert" className="mt-4 rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
          </div>

          <aside className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6">
            <h3 className="text-sm font-black uppercase text-white">Contratação e faturamento</h3>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              A estrutura de planos já é real, mas checkout e cobrança de Pro/Business ainda não estão conectados. Até lá, nenhum botão desta página afirma uma assinatura paga.
            </p>
            <a href="https://www.kyrub.com" className="mt-5 inline-flex items-center gap-2 text-xs font-black text-cyan-300 hover:text-cyan-200">
              Continuar usando o Kyrub <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </aside>
        </section>

        <footer className="mt-8 border-t border-slate-800 pt-5 text-center text-[10px] leading-relaxed text-slate-600">
          * Catálogo ilimitado sujeito a uso justo e às políticas operacionais do Kyrub. Operações locais/determinísticas da Kyrubia não consomem Créditos Kyrubia Inteligência.
          {catalogLoading && ' Atualizando catálogo vigente…'}
        </footer>
      </div>
    </main>
  );
}
