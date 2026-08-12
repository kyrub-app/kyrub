import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  BadgePercent,
  Check,
  Clipboard,
  Gift,
  LoaderCircle,
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  TicketPercent,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import {
  KYRUB_PLAN_FEATURES,
  type KyrubCouponCampaign,
  type KyrubCouponStatus,
  type KyrubPlanCatalogEntry,
} from '../../../shared/kyrubPlanManagement';
import type { KyrubCommercialPlanId } from '../../../shared/kyrubCommercialPlans';
import type { AdminProfile } from '../../utils/adminControlPlane';
import {
  createAdminCoupon,
  grantAdminComplimentaryPlan,
  loadAdminPlanManagement,
  publishAdminPlanVersion,
  setAdminCouponStatus,
  type AdminPlanManagementSnapshot,
  type PublishAdminPlanInput,
} from '../../utils/adminPlanManagement';

interface Props {
  authenticatedUser: User;
  profile: AdminProfile;
}

type AsyncState = { busy: boolean; error: string; success: string };

const initialAsync = (): AsyncState => ({ busy: false, error: '', success: '' });
const PLAN_ORDER: KyrubCommercialPlanId[] = ['free', 'pro', 'business'];
const PLAN_LABEL: Record<KyrubCommercialPlanId, string> = {
  free: 'Free',
  pro: 'Pro',
  business: 'Business',
};

const money = (value: number): string =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const planDraft = (entry: KyrubPlanCatalogEntry): PublishAdminPlanInput => ({
  planId: entry.planId,
  monthlyPriceBRL: entry.definition.monthlyPriceBRL,
  activeCatalogLimit: entry.definition.activeCatalogLimit,
  kyrubiaIntelligenceCredits: entry.definition.kyrubiaIntelligenceCredits,
  marketplaceOriginatedSaleCommissionPercent:
    entry.definition.marketplaceOriginatedSaleCommissionPercent,
  features: { ...entry.definition.features },
});

const toIso = (value: string): string | null => {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const PlanEditor = ({
  entry,
  user,
  onPublished,
}: {
  entry: KyrubPlanCatalogEntry;
  user: User;
  onPublished: (entry: KyrubPlanCatalogEntry) => void;
}) => {
  const [draft, setDraft] = useState<PublishAdminPlanInput>(() => planDraft(entry));
  const [state, setState] = useState<AsyncState>(initialAsync);

  useEffect(() => setDraft(planDraft(entry)), [entry]);

  const updateNumber = (
    key: 'monthlyPriceBRL' | 'kyrubiaIntelligenceCredits' | 'marketplaceOriginatedSaleCommissionPercent',
    raw: string
  ) => {
    const value = Number(raw.replace(',', '.'));
    setDraft(current => ({ ...current, [key]: Number.isFinite(value) ? value : 0 }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (state.busy) return;
    const confirmed = window.confirm(
      `Publicar uma nova versão do plano ${PLAN_LABEL[entry.planId]}? A versão atual permanecerá no histórico para auditoria e futuros contratos.`
    );
    if (!confirmed) return;
    setState({ busy: true, error: '', success: '' });
    try {
      const published = await publishAdminPlanVersion(user, draft);
      onPublished(published);
      setState({
        busy: false,
        error: '',
        success: `Versão ${published.activeVersion} do ${PLAN_LABEL[entry.planId]} publicada.`,
      });
    } catch (error) {
      setState({
        busy: false,
        error: error instanceof Error ? error.message : 'Não foi possível publicar o plano.',
        success: '',
      });
    }
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-[9px] font-black uppercase tracking-[0.18em] text-cyan-400">
            Versão ativa {entry.activeVersion}
          </span>
          <h3 className="mt-1 text-lg font-black text-white">{PLAN_LABEL[entry.planId]}</h3>
          <p className="mt-1 text-[10px] text-slate-500">
            {entry.updatedAt
              ? `Atualizado em ${new Date(entry.updatedAt).toLocaleString('pt-BR')}`
              : 'Usando referência comercial V1 como bootstrap.'}
          </p>
        </div>
        <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[8px] font-black uppercase text-emerald-300">
          Ativo
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="mb-1.5 block text-[9px] font-black uppercase tracking-wider text-slate-500">Valor mensal</span>
          <input
            type="number"
            min="0"
            step="0.01"
            disabled={entry.planId === 'free' || state.busy}
            value={draft.monthlyPriceBRL}
            onChange={event => updateNumber('monthlyPriceBRL', event.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-xs text-white outline-none focus:border-cyan-500/60 disabled:opacity-50"
          />
          <span className="mt-1 block text-[9px] text-slate-600">{money(draft.monthlyPriceBRL)}</span>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[9px] font-black uppercase tracking-wider text-slate-500">Produtos/serviços</span>
          <input
            type="number"
            min="0"
            step="1"
            disabled={state.busy || (entry.planId === 'business' && draft.activeCatalogLimit === null)}
            value={draft.activeCatalogLimit ?? ''}
            onChange={event => {
              const value = Number.parseInt(event.target.value, 10);
              setDraft(current => ({
                ...current,
                activeCatalogLimit: Number.isFinite(value) ? value : 0,
              }));
            }}
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-xs text-white outline-none focus:border-cyan-500/60 disabled:opacity-50"
          />
          {entry.planId === 'business' && (
            <label className="mt-2 flex items-center gap-2 text-[9px] text-slate-500">
              <input
                type="checkbox"
                checked={draft.activeCatalogLimit === null}
                onChange={event => setDraft(current => ({
                  ...current,
                  activeCatalogLimit: event.target.checked ? null : 100,
                }))}
              />
              Comercialmente ilimitado
            </label>
          )}
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[9px] font-black uppercase tracking-wider text-slate-500">Créditos Kyrubia/mês</span>
          <input
            type="number"
            min="0"
            step="1"
            disabled={state.busy}
            value={draft.kyrubiaIntelligenceCredits}
            onChange={event => updateNumber('kyrubiaIntelligenceCredits', event.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-xs text-white outline-none focus:border-cyan-500/60 disabled:opacity-50"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[9px] font-black uppercase tracking-wider text-slate-500">Comissão marketplace (%)</span>
          <input
            type="number"
            min="0"
            max="100"
            step="0.1"
            disabled={state.busy}
            value={draft.marketplaceOriginatedSaleCommissionPercent}
            onChange={event => updateNumber('marketplaceOriginatedSaleCommissionPercent', event.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-xs text-white outline-none focus:border-cyan-500/60 disabled:opacity-50"
          />
        </label>
      </div>

      <div className="mt-4">
        <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">Funcionalidades</span>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {KYRUB_PLAN_FEATURES.map(feature => (
            <label
              key={feature.id}
              className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-800 bg-slate-900/70 p-3"
            >
              <input
                type="checkbox"
                className="mt-0.5"
                checked={draft.features[feature.id]}
                disabled={state.busy}
                onChange={event => setDraft(current => ({
                  ...current,
                  features: {
                    ...current.features,
                    [feature.id]: event.target.checked,
                  },
                }))}
              />
              <span>
                <strong className="block text-[10px] text-slate-200">{feature.label}</strong>
                <span className="mt-0.5 block text-[9px] leading-relaxed text-slate-600">{feature.description}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={state.busy}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-slate-950 hover:bg-cyan-300 disabled:opacity-50"
        >
          {state.busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {state.busy ? 'Publicando' : 'Salvar como nova versão'}
        </button>
        {state.error && <span className="text-[10px] text-red-300">{state.error}</span>}
        {state.success && <span className="text-[10px] text-emerald-300">{state.success}</span>}
      </div>
    </form>
  );
};

const CouponCreator = ({
  user,
  onCreated,
}: {
  user: User;
  onCreated: (coupon: KyrubCouponCampaign) => void;
}) => {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [targetPlan, setTargetPlan] = useState<'pro' | 'business'>('pro');
  const [discountType, setDiscountType] = useState<'percent' | 'fixed_brl'>('percent');
  const [discountValue, setDiscountValue] = useState('100');
  const [durationType, setDurationType] = useState<'months' | 'until' | 'indefinite'>('indefinite');
  const [durationMonths, setDurationMonths] = useState('');
  const [benefitEndsAt, setBenefitEndsAt] = useState('');
  const [redeemStartsAt, setRedeemStartsAt] = useState('');
  const [redeemEndsAt, setRedeemEndsAt] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [state, setState] = useState<AsyncState>(initialAsync);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (state.busy) return;
    setState({ busy: true, error: '', success: '' });
    try {
      const coupon = await createAdminCoupon(user, {
        code,
        label,
        targetPlan,
        targetPlanVersion: null,
        discountType,
        discountValue: Number(discountValue.replace(',', '.')),
        durationType,
        durationMonths: durationType === 'months' ? Number.parseInt(durationMonths, 10) : null,
        benefitEndsAt: durationType === 'until' ? toIso(benefitEndsAt) : null,
        redeemStartsAt: toIso(redeemStartsAt),
        redeemEndsAt: toIso(redeemEndsAt),
        maxRedemptions: maxRedemptions.trim() ? Number.parseInt(maxRedemptions, 10) : null,
        maxRedemptionsPerStore: 1,
        status: 'draft',
      });
      onCreated(coupon);
      setCode('');
      setLabel('');
      setState({
        busy: false,
        error: '',
        success: `Cupom ${coupon.code} criado como rascunho. Ative-o quando estiver pronto para compartilhar.`,
      });
    } catch (error) {
      setState({
        busy: false,
        error: error instanceof Error ? error.message : 'Não foi possível criar o cupom.',
        success: '',
      });
    }
  };

  const partialWithoutBilling = discountType !== 'percent' || Number(discountValue) !== 100;

  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
      <div className="flex items-center gap-2 text-violet-300">
        <TicketPercent className="h-4 w-4" />
        <h3 className="text-sm font-black text-white">Criar cupom</h3>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
        O código nasce como rascunho. Ativar e pausar são ações administrativas separadas e auditadas.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-[9px] font-black uppercase text-slate-500">Código compartilhável</span>
          <input
            value={code}
            onChange={event => setCode(event.target.value.toUpperCase().replace(/\s+/g, ''))}
            placeholder="Ex.: KYRUBBETA100"
            maxLength={40}
            required
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 font-mono text-xs uppercase text-white outline-none focus:border-violet-500/60"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-[9px] font-black uppercase text-slate-500">Nome da campanha</span>
          <input
            value={label}
            onChange={event => setLabel(event.target.value)}
            placeholder="Ex.: Primeiras lojas parceiras beta"
            maxLength={120}
            required
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-xs text-white outline-none focus:border-violet-500/60"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[9px] font-black uppercase text-slate-500">Plano</span>
          <select
            value={targetPlan}
            onChange={event => setTargetPlan(event.target.value as 'pro' | 'business')}
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-xs text-white"
          >
            <option value="pro">Pro</option>
            <option value="business">Business</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[9px] font-black uppercase text-slate-500">Tipo de desconto</span>
          <select
            value={discountType}
            onChange={event => setDiscountType(event.target.value as 'percent' | 'fixed_brl')}
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-xs text-white"
          >
            <option value="percent">Percentual</option>
            <option value="fixed_brl">Valor em R$</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[9px] font-black uppercase text-slate-500">Desconto</span>
          <input
            type="number"
            min="0.01"
            max={discountType === 'percent' ? '100' : undefined}
            step="0.01"
            value={discountValue}
            onChange={event => setDiscountValue(event.target.value)}
            required
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-xs text-white"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[9px] font-black uppercase text-slate-500">Duração</span>
          <select
            value={durationType}
            onChange={event => setDurationType(event.target.value as 'months' | 'until' | 'indefinite')}
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-xs text-white"
          >
            <option value="indefinite">Sem vencimento definido</option>
            <option value="months">Quantidade de meses</option>
            <option value="until">Até uma data</option>
          </select>
        </label>

        {durationType === 'months' && (
          <label className="block">
            <span className="mb-1.5 block text-[9px] font-black uppercase text-slate-500">Meses</span>
            <input type="number" min="1" max="120" value={durationMonths} onChange={event => setDurationMonths(event.target.value)} required className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-xs text-white" />
          </label>
        )}
        {durationType === 'until' && (
          <label className="block">
            <span className="mb-1.5 block text-[9px] font-black uppercase text-slate-500">Benefício até</span>
            <input type="datetime-local" value={benefitEndsAt} onChange={event => setBenefitEndsAt(event.target.value)} required className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-xs text-white" />
          </label>
        )}
        <label className="block">
          <span className="mb-1.5 block text-[9px] font-black uppercase text-slate-500">Resgates a partir de</span>
          <input type="datetime-local" value={redeemStartsAt} onChange={event => setRedeemStartsAt(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-xs text-white" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[9px] font-black uppercase text-slate-500">Resgates até</span>
          <input type="datetime-local" value={redeemEndsAt} onChange={event => setRedeemEndsAt(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-xs text-white" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[9px] font-black uppercase text-slate-500">Máximo de resgates</span>
          <input type="number" min="1" value={maxRedemptions} onChange={event => setMaxRedemptions(event.target.value)} placeholder="Sem limite" className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-xs text-white" />
        </label>
      </div>

      {partialWithoutBilling && (
        <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2.5 text-[10px] leading-relaxed text-amber-200">
          Descontos parciais podem ser preparados agora, mas o resgate ficará bloqueado até o billing estar conectado. Cupons 100% podem funcionar como cortesia no beta sem simular pagamento.
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={state.busy} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-violet-500 px-4 py-2.5 text-[10px] font-black uppercase text-white hover:bg-violet-400 disabled:opacity-50">
          {state.busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <TicketPercent className="h-4 w-4" />}
          {state.busy ? 'Criando' : 'Criar cupom em rascunho'}
        </button>
        {state.error && <span className="text-[10px] text-red-300">{state.error}</span>}
        {state.success && <span className="text-[10px] text-emerald-300">{state.success}</span>}
      </div>
    </form>
  );
};

const CouponList = ({
  user,
  coupons,
  onStatus,
}: {
  user: User;
  coupons: KyrubCouponCampaign[];
  onStatus: (code: string, status: KyrubCouponStatus) => void;
}) => {
  const [busyCode, setBusyCode] = useState('');
  const [message, setMessage] = useState('');

  const changeStatus = async (coupon: KyrubCouponCampaign, status: KyrubCouponStatus) => {
    if (busyCode) return;
    setBusyCode(coupon.code);
    setMessage('');
    try {
      await setAdminCouponStatus(user, coupon.code, status);
      onStatus(coupon.code, status);
      setMessage(`${coupon.code}: ${status}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível alterar o cupom.');
    } finally {
      setBusyCode('');
    }
  };

  if (coupons.length === 0) {
    return <div className="rounded-2xl border border-dashed border-slate-800 p-5 text-xs text-slate-500">Nenhum cupom criado ainda.</div>;
  }

  return (
    <div className="space-y-2">
      {coupons.map(coupon => (
        <article key={coupon.id} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <strong className="font-mono text-sm text-white">{coupon.code}</strong>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[8px] font-black uppercase text-slate-400">{coupon.status}</span>
              </div>
              <p className="mt-1 text-xs font-bold text-slate-300">{coupon.label}</p>
              <p className="mt-1 text-[9px] text-slate-500">
                {PLAN_LABEL[coupon.targetPlan]} · {coupon.discountType === 'percent' ? `${coupon.discountValue}%` : money(coupon.discountValue)} · {coupon.redemptionCount}{coupon.maxRedemptions === null ? '' : `/${coupon.maxRedemptions}`} resgate(s)
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(coupon.code)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[9px] font-black text-slate-300"
              >
                <Clipboard className="h-3 w-3" /> Copiar
              </button>
              {coupon.status !== 'active' && coupon.status !== 'retired' && (
                <button type="button" disabled={busyCode === coupon.code} onClick={() => void changeStatus(coupon, 'active')} className="rounded-lg border border-emerald-500/30 px-2.5 py-1.5 text-[9px] font-black text-emerald-300">Ativar</button>
              )}
              {coupon.status === 'active' && (
                <button type="button" disabled={busyCode === coupon.code} onClick={() => void changeStatus(coupon, 'paused')} className="rounded-lg border border-amber-500/30 px-2.5 py-1.5 text-[9px] font-black text-amber-300">Pausar</button>
              )}
            </div>
          </div>
        </article>
      ))}
      {message && <p className="text-[10px] text-slate-400">{message}</p>}
    </div>
  );
};

const DirectGrant = ({ user }: { user: User }) => {
  const [uid, setUid] = useState('');
  const [plan, setPlan] = useState<'pro' | 'business'>('pro');
  const [state, setState] = useState<AsyncState>(initialAsync);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (state.busy || !uid.trim()) return;
    if (!window.confirm(`Conceder ${PLAN_LABEL[plan]} cortesia sem vencimento definido para a Loja Kyrub desse UID? Nenhuma cobrança será criada.`)) return;
    setState({ busy: true, error: '', success: '' });
    try {
      const result = await grantAdminComplimentaryPlan(user, {
        targetUserId: uid.trim(),
        targetPlan: plan,
        durationType: 'indefinite',
        durationMonths: null,
        benefitEndsAt: null,
        campaignId: null,
      });
      setState({ busy: false, error: '', success: `${PLAN_LABEL[result.plan]} cortesia concedido à loja ${result.storeId}, versão ${result.planVersion}.` });
    } catch (error) {
      setState({ busy: false, error: error instanceof Error ? error.message : 'Não foi possível conceder a cortesia.', success: '' });
    }
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
      <div className="flex items-center gap-2">
        <Gift className="h-4 w-4 text-fuchsia-300" />
        <h3 className="text-sm font-black text-white">Concessão direta</h3>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
        Para exceções administradas. O servidor registra origem <strong className="text-slate-300">admin_grant</strong>; não simula assinatura nem pagamento.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_180px_auto]">
        <input value={uid} onChange={event => setUid(event.target.value)} placeholder="UID exato do proprietário" className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 font-mono text-xs text-white" />
        <select value={plan} onChange={event => setPlan(event.target.value as 'pro' | 'business')} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-xs text-white">
          <option value="pro">Pro cortesia</option>
          <option value="business">Business cortesia</option>
        </select>
        <button type="submit" disabled={state.busy || !uid.trim()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-fuchsia-500 px-4 py-2.5 text-[10px] font-black uppercase text-white disabled:opacity-50">
          {state.busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
          Conceder
        </button>
      </div>
      {state.error && <p className="mt-2 text-[10px] text-red-300">{state.error}</p>}
      {state.success && <p className="mt-2 text-[10px] text-emerald-300">{state.success}</p>}
    </form>
  );
};

export default function AdminPlansCouponsWorkspace({ authenticatedUser, profile }: Props) {
  const [snapshot, setSnapshot] = useState<AdminPlanManagementSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      setSnapshot(await loadAdminPlanManagement(authenticatedUser));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar Planos & Cupons.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (profile.role === 'super_admin' && profile.status === 'active') {
      void refresh();
    }
    // authenticatedUser is stable for the active admin session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.role, profile.status]);

  const plans = useMemo(
    () => PLAN_ORDER.flatMap(planId => {
      const entry = snapshot?.plans.find(item => item.planId === planId);
      return entry ? [entry] : [];
    }),
    [snapshot]
  );

  if (profile.role !== 'super_admin' || profile.status !== 'active') return null;

  return (
    <section id="admin-plans-coupons" aria-labelledby="admin-plans-coupons-title" className="space-y-4 rounded-[2rem] border border-cyan-500/20 bg-cyan-500/5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 text-cyan-300">
            <SlidersHorizontal className="h-5 w-5" />
            <span className="text-[9px] font-black uppercase tracking-[0.2em]">Planos & Cupons</span>
          </div>
          <h2 id="admin-plans-coupons-title" className="mt-2 text-xl font-black text-white">Governança comercial versionada</h2>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            Altere preço, capacidade e funcionalidades criando uma nova versão do plano. Cupons e concessões usam a mesma camada de entitlement e nunca registram pagamento fictício.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-500/20 bg-slate-950/70 px-3 py-2 text-[9px] font-black text-cyan-300">
            <ShieldCheck className="h-3.5 w-3.5" /> Somente Super Admin
          </span>
          <button type="button" onClick={() => void refresh()} disabled={loading} aria-label="Atualizar Planos e Cupons" className="rounded-xl border border-slate-700 bg-slate-900 p-2.5 text-slate-300 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && <div className="rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-xs text-red-200">{error}</div>}
      {loading && !snapshot && <div className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-950/50 p-5 text-xs text-slate-400"><LoaderCircle className="h-4 w-4 animate-spin" /> Carregando catálogo administrativo</div>}

      {snapshot && (
        <>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-cyan-300" />
              <h3 className="text-sm font-black uppercase tracking-wider text-white">Planos</h3>
            </div>
            {plans.map(entry => (
              <PlanEditor
                key={entry.planId}
                entry={entry}
                user={authenticatedUser}
                onPublished={published => setSnapshot(current => current ? {
                  ...current,
                  plans: current.plans.map(item => item.planId === published.planId ? published : item),
                } : current)}
              />
            ))}
          </div>

          <div className="space-y-3 border-t border-slate-800 pt-4">
            <div className="flex items-center gap-2">
              <BadgePercent className="h-4 w-4 text-violet-300" />
              <h3 className="text-sm font-black uppercase tracking-wider text-white">Cupons compartilháveis</h3>
            </div>
            <CouponCreator
              user={authenticatedUser}
              onCreated={coupon => setSnapshot(current => current ? {
                ...current,
                coupons: [coupon, ...current.coupons],
              } : current)}
            />
            <CouponList
              user={authenticatedUser}
              coupons={snapshot.coupons}
              onStatus={(code, status) => setSnapshot(current => current ? {
                ...current,
                coupons: current.coupons.map(coupon => coupon.code === code ? { ...coupon, status } : coupon),
              } : current)}
            />
          </div>

          <div className="space-y-3 border-t border-slate-800 pt-4">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-fuchsia-300" />
              <h3 className="text-sm font-black uppercase tracking-wider text-white">Exceções administradas</h3>
            </div>
            <DirectGrant user={authenticatedUser} />
          </div>
        </>
      )}
    </section>
  );
}
