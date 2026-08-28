import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Crown, LoaderCircle, TicketPercent, X } from 'lucide-react';
import { auth } from '../../utils/firebase';
import { redeemKyrubCoupon } from '../../utils/couponRedemption';
import {
  loadCachedUserStore,
  saveCachedUserStore,
} from '../../utils/storePersistence';
import { invalidateKyrubErpContext } from '../../actions/erpReadActionService';

const HOST_ID = 'kyrub-plan-billing-host';

type StorePlan = 'free' | 'pro' | 'business';

const planLabel = (plan: StorePlan): string => {
  if (plan === 'business') return 'Business';
  if (plan === 'pro') return 'Premium';
  return 'Grátis';
};

export function StoreCouponRedemptionBridge() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [plan, setPlan] = useState<StorePlan>('free');

  const refreshPlan = () => {
    const user = auth.currentUser;
    if (!user) {
      setPlan('free');
      return;
    }
    const cached = loadCachedUserStore(localStorage, user.uid, user.email ?? '');
    const nextPlan = cached?.plan;
    setPlan(nextPlan === 'business' || nextPlan === 'pro' ? nextPlan : 'free');
  };

  useEffect(() => {
    let frame = 0;
    let stopped = false;

    const attach = () => {
      frame = 0;
      if (stopped) return;
      const wallet = document.getElementById('header-wallet-balance');
      if (!wallet?.parentElement) return;

      let mount = document.getElementById(HOST_ID);
      if (!mount) {
        mount = document.createElement('div');
        mount.id = HOST_ID;
        mount.className = 'shrink-0';
        wallet.parentElement.insertBefore(mount, wallet);
      }
      setHost(mount);
    };

    const schedule = () => {
      if (frame || stopped) return;
      frame = window.requestAnimationFrame(attach);
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();

    return () => {
      stopped = true;
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    refreshPlan();
    const unsubscribe = auth.onAuthStateChanged(refreshPlan);
    const entitlementUpdated = () => refreshPlan();
    window.addEventListener('kyrub:store-entitlement-updated', entitlementUpdated);
    return () => {
      unsubscribe();
      window.removeEventListener('kyrub:store-entitlement-updated', entitlementUpdated);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    refreshPlan();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && !busy && setOpen(false);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open, busy]);

  const redeem = async (event: FormEvent) => {
    event.preventDefault();
    const user = auth.currentUser;
    const normalizedCode = code.trim().toUpperCase();
    if (!user) {
      setError('Faça login novamente para resgatar o código.');
      return;
    }
    if (!normalizedCode || busy) return;
    if (!window.confirm(
      `Resgatar o código ${normalizedCode}? Se ele estiver ativo e elegível, o plano da sua Loja Kyrub poderá ser alterado.`
    )) return;

    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await redeemKyrubCoupon(user, normalizedCode);
      const cached = loadCachedUserStore(localStorage, user.uid, user.email ?? '');
      if (cached) {
        saveCachedUserStore(localStorage, user.uid, { ...cached, plan: result.plan }, false);
      }
      invalidateKyrubErpContext(user.uid);
      window.dispatchEvent(new CustomEvent('kyrub:store-entitlement-updated', {
        detail: {
          plan: result.plan,
          planVersion: result.planVersion,
          source: 'coupon',
          code: result.code,
        },
      }));
      const resolvedPlan: StorePlan = result.plan === 'business' ? 'business' : 'pro';
      setPlan(resolvedPlan);
      setSuccess(
        `${result.code} resgatado. Seu plano agora é ${planLabel(resolvedPlan)}${result.benefitEndsAt ? ` até ${new Date(result.benefitEndsAt).toLocaleDateString('pt-BR')}` : ''}.`
      );
      setCode('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível resgatar este código.');
    } finally {
      setBusy(false);
    }
  };

  if (!host) return null;

  return (
    <>
      {createPortal(
        <button
          type="button"
          aria-label="Plano e cobrança"
          title="Plano e cobrança"
          onClick={() => {
            setError('');
            setSuccess('');
            refreshPlan();
            setOpen(true);
          }}
          className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-violet-500/25 bg-violet-500/10 text-violet-300 transition hover:bg-violet-500/20"
        >
          <Crown className="h-5 w-5" />
          {plan !== 'free' && (
            <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-slate-950 bg-violet-400" />
          )}
        </button>,
        host
      )}

      {open && createPortal(
        <div
          className="fixed inset-0 z-[10060] flex items-start justify-center overflow-y-auto bg-slate-950/85 p-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-sm sm:p-6"
          data-kyrub-skip-top-overlay="true"
          onMouseDown={event => {
            if (event.target === event.currentTarget && !busy) setOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="plan-billing-title"
            className="w-full max-w-md overflow-hidden rounded-[2rem] border border-violet-500/20 bg-slate-900 text-slate-100 shadow-2xl"
          >
            <header className="border-b border-slate-800 bg-slate-950 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-300">
                    <Crown className="h-5 w-5" />
                  </span>
                  <div>
                    <span className="font-mono text-[9px] font-black uppercase tracking-[0.18em] text-violet-300">Conta Kyrub</span>
                    <h2 id="plan-billing-title" className="mt-1 text-xl font-black text-white">Plano e cobrança</h2>
                  </div>
                </div>
                <button type="button" aria-label="Fechar Plano e cobrança" disabled={busy} onClick={() => setOpen(false)} className="rounded-xl border border-slate-700 p-2 text-slate-400 hover:text-white disabled:opacity-50">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            <div className="space-y-4 p-5">
              <div className="rounded-3xl border border-violet-500/20 bg-violet-500/[0.07] p-4">
                <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">Plano atual</span>
                <div className="mt-1 flex items-end justify-between gap-3">
                  <strong className="text-2xl font-black text-white">{planLabel(plan)}</strong>
                  <span className="rounded-full border border-violet-500/25 bg-slate-950 px-3 py-1 text-[9px] font-black uppercase text-violet-300">Ativo</span>
                </div>
                {plan === 'free' ? (
                  <p className="mt-3 text-sm leading-relaxed text-slate-400">O plano gratuito permite publicar até <strong className="text-white">5 itens</strong> na vitrine. Itens adicionais podem continuar sendo preparados como rascunho até um upgrade.</p>
                ) : (
                  <p className="mt-3 text-sm leading-relaxed text-slate-400">Seu benefício de plano está ativo. Limites e recursos disponíveis seguem o entitlement confirmado pelo servidor.</p>
                )}
              </div>

              <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="flex items-center gap-2 text-violet-300">
                  <TicketPercent className="h-4 w-4" />
                  <h3 className="text-xs font-black uppercase text-white">Tenho um código promocional</h3>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">Use aqui códigos promocionais fornecidos pelo Kyrub. Eles são diferentes dos cupons de desconto que sua loja oferece aos clientes.</p>

                <form onSubmit={redeem} className="mt-4 space-y-3">
                  <input
                    value={code}
                    onChange={event => setCode(event.target.value.toUpperCase().replace(/\s+/g, ''))}
                    placeholder="Ex.: KYRUBBETA100"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    maxLength={40}
                    disabled={busy}
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-base uppercase text-white outline-none focus:border-violet-500/60 disabled:opacity-50"
                  />
                  <button type="submit" disabled={busy || !code.trim()} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-violet-500 px-4 py-3 text-sm font-black text-white hover:bg-violet-400 disabled:opacity-50">
                    {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <TicketPercent className="h-4 w-4" />}
                    {busy ? 'Validando código' : 'Resgatar código'}
                  </button>
                </form>

                {error && <div className="mt-4 rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200" role="alert">{error}</div>}
                {success && <div className="mt-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm leading-relaxed text-emerald-200" role="status">{success}</div>}
              </div>

              <p className="text-[10px] leading-relaxed text-slate-500">Cobrança recorrente e upgrade pago serão exibidos nesta central quando os meios de assinatura forem habilitados.</p>
            </div>
          </section>
        </div>,
        document.body
      )}
    </>
  );
}
