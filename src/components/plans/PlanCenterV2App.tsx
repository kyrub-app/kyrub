import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  BadgeCheck,
  Bot,
  Boxes,
  Check,
  Gauge,
  LoaderCircle,
  LogIn,
  LogOut,
  ReceiptText,
  Sparkles,
  Store,
  TicketPercent,
  Users,
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
  formatKyrubPlanMonthlyPrice,
  type KyrubCommercialPlanId,
} from '../../../shared/kyrubCommercialPlans';
import {
  KYRUB_COMMERCIAL_PLANS_V2,
  KYRUB_COMMERCIAL_PLANS_V2_NOTICE,
  KYRUB_COMMERCIAL_PLANS_V2_SHARED_ECOSYSTEM,
  legacyPlanIdToV2,
  type KyrubCommercialPlanV2Reference,
} from '../../../shared/kyrubCommercialPlansV2';
import {
  reconcileOwnStoreEntitlement,
  redeemKyrubCoupon,
} from '../../utils/couponRedemption';
import { auth, db } from '../../utils/firebase';
import { getPrimaryUserStoreDocumentPath } from '../../utils/storePaths';

const legacyLabels: Record<KyrubCommercialPlanId, string> = {
  free: 'Free',
  pro: 'Pro',
  business: 'Business',
};

const normalizeLegacyPlan = (value: unknown): KyrubCommercialPlanId =>
  value === 'pro' || value === 'business' ? value : 'free';

const catalogLabel = (limit: number | null): string =>
  limit === null
    ? 'Acima das faixas padrão'
    : `Até ${limit.toLocaleString('pt-BR')} produtos ou serviços ativos`;

const volumeLabel = (limit: number | null): string =>
  limit === null
    ? 'Volume comercial sob dimensionamento'
    : `Até ${limit.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        maximumFractionDigits: 0,
      })} de operação mensal`;

const teamLabel = (limit: number | null): string =>
  limit === null
    ? 'Equipe dimensionada para a operação'
    : limit === 1
      ? '1 pessoa na operação'
      : `Até ${limit} pessoas na equipe`;

const priceLabel = (plan: KyrubCommercialPlanV2Reference): string =>
  plan.monthlyPriceBRL === null
    ? 'Sob consulta'
    : formatKyrubPlanMonthlyPrice(plan.monthlyPriceBRL);

export function PlanCenterV2App() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [currentPlan, setCurrentPlan] = useState<KyrubCommercialPlanId | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [couponBusy, setCouponBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => onAuthStateChanged(auth, setUser), []);

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
        setCurrentPlan(normalizeLegacyPlan(snapshot.data().plan));
      },
      () => setCurrentPlan(null)
    );
  }, [user]);

  const currentV2Plan = currentPlan ? legacyPlanIdToV2(currentPlan) : null;

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
          ? 'Este domínio ainda precisa ser autorizado no Firebase Authentication antes do login da Central de Planos.'
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
        `${result.code} aplicado com sucesso. Sua Loja Kyrub agora está no plano ${legacyLabels[result.plan]}${
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
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-10">
        <header className="flex flex-col gap-5 border-b border-slate-800 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-orange-500/30 bg-orange-500/10 text-orange-300">
              <Zap className="h-6 w-6" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-orange-400">planos.kyrub.com</p>
              <h1 className="text-2xl font-black text-white">Planos Kyrub</h1>
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

        <section className="py-10 text-center sm:py-14">
          <span className="inline-flex items-center gap-2 rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-orange-300">
            <Sparkles className="h-3.5 w-3.5" /> Um sistema inteiro
          </span>
          <h2 className="mx-auto mt-4 max-w-4xl text-3xl font-black leading-tight text-white sm:text-5xl">
            Planos que crescem com o seu negócio.
          </h2>
          <p className="mx-auto mt-4 max-w-3xl text-sm leading-relaxed text-slate-400 sm:text-base">
            Você não precisa montar o Kyrub comprando módulos separados. Loja, gestão, vendas, relacionamento, Cairúbia, integrações e recursos fiscais fazem parte do mesmo ecossistema. O que muda é a capacidade necessária para acompanhar o tamanho da sua operação.
          </p>
        </section>

        <section className="mb-7 rounded-3xl border border-cyan-500/20 bg-cyan-500/5 p-5">
          <div className="flex items-start gap-3">
            <Gauge className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" />
            <div>
              <h3 className="text-sm font-black text-white">O Kyrub mede o porte da operação, não apenas o tamanho do catálogo.</h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                As faixas combinam produtos ou serviços ativos, volume comercial processado e intensidade operacional. Assim, uma empresa com poucos produtos e alto movimento não é tratada como uma operação pequena, e um catálogo extenso sozinho não define o porte do negócio.
              </p>
            </div>
          </div>
        </section>

        {user && (
          <section className="mb-7 rounded-3xl border border-orange-500/20 bg-orange-500/5 p-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-orange-400">Seu plano atual</p>
              <div className="mt-2 flex items-center gap-2">
                <Store className="h-5 w-5 text-orange-300" />
                <strong className="text-2xl font-black text-white">
                  {currentPlan ? legacyLabels[currentPlan] : 'Carregando…'}
                </strong>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Seu entitlement atual continua sendo respeitado durante a transição para a estrutura comercial V2.
              </p>
            </div>
            <div className="mt-4 text-xs text-slate-500 sm:mt-0 sm:text-right">
              Conta conectada<br />
              <span className="text-slate-300">{user.email}</span>
            </div>
          </section>
        )}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {KYRUB_COMMERCIAL_PLANS_V2.map(plan => {
            const isCurrent = currentV2Plan === plan.id;
            return (
              <article
                key={plan.id}
                className={`relative flex flex-col rounded-3xl border p-5 ${
                  plan.highlighted
                    ? 'border-violet-500/40 bg-violet-500/5 shadow-lg shadow-violet-950/20'
                    : 'border-slate-800 bg-slate-900/60'
                }`}
              >
                {plan.highlighted && (
                  <span className="mb-3 self-start rounded-full bg-violet-500/15 px-2.5 py-1 text-[9px] font-black uppercase text-violet-300">
                    Crescimento
                  </span>
                )}
                <p className="text-[10px] font-black uppercase tracking-[0.15em] text-orange-300">{plan.stage}</p>
                <h3 className="mt-1 text-xl font-black text-white">{plan.name}</h3>
                <p className="mt-2 min-h-14 text-xs leading-relaxed text-slate-500">{plan.positioning}</p>

                <div className="mt-5">
                  <strong className="text-3xl font-black text-white">{priceLabel(plan)}</strong>
                  {plan.monthlyPriceBRL !== null && <span className="text-xs text-slate-500"> / mês</span>}
                </div>

                <ul className="mt-5 flex-1 space-y-3 text-xs text-slate-300">
                  <li className="flex gap-2"><Boxes className="h-4 w-4 shrink-0 text-cyan-400" /> {catalogLabel(plan.activeCatalogLimit)}</li>
                  <li className="flex gap-2"><Gauge className="h-4 w-4 shrink-0 text-cyan-400" /> {volumeLabel(plan.monthlyProcessedVolumeBRL)}</li>
                  <li className="flex gap-2"><Users className="h-4 w-4 shrink-0 text-cyan-400" /> {teamLabel(plan.teamMemberLimit)}</li>
                  <li className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-emerald-400" /> Mesmo ecossistema Kyrub</li>
                  <li className="flex gap-2"><Bot className="h-4 w-4 shrink-0 text-violet-400" /> Cairúbia determinística incluída</li>
                  <li className="flex gap-2"><ReceiptText className="h-4 w-4 shrink-0 text-orange-300" /> Kyrub Fiscal dentro da capacidade da operação</li>
                </ul>

                <div className="mt-6">
                  {isCurrent ? (
                    <div className="flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 text-sm font-black text-emerald-300">
                      <BadgeCheck className="h-4 w-4" /> Plano atual
                    </div>
                  ) : plan.id === 'free' ? (
                    <a href="https://www.kyrub.com" className="flex min-h-11 items-center justify-center rounded-2xl border border-slate-700 px-4 text-center text-xs font-black text-slate-300">
                      Começar grátis
                    </a>
                  ) : KYRUB_COMMERCIAL_PLAN_BILLING_AVAILABLE ? (
                    <button type="button" className="min-h-11 w-full rounded-2xl bg-violet-500 px-4 text-sm font-black text-white">
                      Escolher {plan.name}
                    </button>
                  ) : (
                    <div className="min-h-11 rounded-2xl border border-slate-700 px-4 py-3 text-center text-xs font-bold text-slate-400">
                      Contratação V2 em breve
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </section>

        <section className="mt-7 rounded-3xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex items-start gap-3">
            <Zap className="mt-0.5 h-5 w-5 shrink-0 text-orange-300" />
            <div>
              <h3 className="text-base font-black text-white">O mesmo Kyrub em todas as fases.</h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                Os planos organizam capacidade. Eles não transformam CRM, Fiscal, Cairúbia ou integrações em peças isoladas que você precisa comprar uma por uma.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {KYRUB_COMMERCIAL_PLANS_V2_SHARED_ECOSYSTEM.map(feature => (
                  <span key={feature} className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1.5 text-[10px] font-bold text-slate-300">
                    {feature}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mt-7 grid gap-5 lg:grid-cols-2">
          <article className="rounded-3xl border border-violet-500/20 bg-violet-500/5 p-5">
            <Bot className="h-6 w-6 text-violet-300" />
            <h3 className="mt-3 text-lg font-black text-white">Cairúbia incluída. Sem pacote de créditos.</h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              Operações determinísticas são executadas pelo próprio Kyrub. Quando um comando precisa de uma LLM, a Cairúbia usa a inteligência que o usuário conectou — como ChatGPT, Gemini, Claude ou outro provedor compatível — sem criar um saldo artificial de créditos Kyrub.
            </p>
          </article>

          <article className="rounded-3xl border border-orange-500/20 bg-orange-500/5 p-5">
            <ReceiptText className="h-6 w-6 text-orange-300" />
            <h3 className="mt-3 text-lg font-black text-white">Kyrub Fiscal acompanha o porte da operação.</h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              A experiência comercial não vende um pacote de notas. A capacidade fiscal acompanha a faixa operacional do plano; operações de volume excepcional podem exigir reenquadramento. Autoridade fiscal, política tributária e emissão continuam obedecendo aos gates próprios de segurança do Kyrub.
            </p>
          </article>
        </section>

        <section className="mt-7 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <article className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5">
            <h3 className="text-lg font-black text-white">Seu negócio cresceu? O Kyrub cresce junto.</h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              O reenquadramento considera o conjunto da operação. Quantidade de produtos é um sinal, não a única medida. Volume comercial, equipe e intensidade operacional ajudam a identificar a faixa adequada sem dividir o sistema em módulos.
            </p>
          </article>

          <aside className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="flex items-center gap-2">
              <TicketPercent className="h-5 w-5 text-cyan-300" />
              <h3 className="text-base font-black text-white">Cupom ou benefício</h3>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              Cupons existentes continuam respeitando os entitlements atuais durante a migração V2.
            </p>
            <form onSubmit={redeem} className="mt-4 flex gap-2">
              <input
                value={couponCode}
                onChange={event => setCouponCode(event.target.value.toUpperCase())}
                placeholder="CÓDIGO"
                className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-bold uppercase text-white outline-none focus:border-cyan-500"
              />
              <button
                type="submit"
                disabled={couponBusy}
                className="min-h-10 rounded-xl bg-cyan-500 px-4 text-xs font-black text-slate-950 disabled:opacity-60"
              >
                {couponBusy ? 'Aplicando…' : 'Aplicar'}
              </button>
            </form>
          </aside>
        </section>

        {(message || error) && (
          <div className={`mt-5 rounded-2xl border px-4 py-3 text-xs ${error ? 'border-red-500/30 bg-red-500/10 text-red-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'}`}>
            {error || message}
          </div>
        )}

        <footer className="mt-8 border-t border-slate-800 pt-5 text-center text-[10px] leading-relaxed text-slate-600">
          {KYRUB_COMMERCIAL_PLANS_V2_NOTICE}
        </footer>
      </div>
    </main>
  );
}
