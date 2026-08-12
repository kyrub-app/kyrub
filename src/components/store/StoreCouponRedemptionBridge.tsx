import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, TicketPercent, X } from 'lucide-react';
import { auth } from '../../utils/firebase';
import { redeemKyrubCoupon } from '../../utils/couponRedemption';
import {
  loadCachedUserStore,
  saveCachedUserStore,
} from '../../utils/storePersistence';
import { invalidateKyrubErpContext } from '../../actions/erpReadActionService';

export function StoreCouponRedemptionBridge() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const sync = () => {
      const actions = document.getElementById('kyrub-store-save-publish-actions');
      setHost(actions);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!host) setOpen(false);
  }, [host]);

  const redeem = async (event: FormEvent) => {
    event.preventDefault();
    const user = auth.currentUser;
    const normalizedCode = code.trim().toUpperCase();
    if (!user) {
      setError('Faça login novamente para resgatar o cupom.');
      return;
    }
    if (!normalizedCode || busy) return;
    if (!window.confirm(
      `Resgatar o cupom ${normalizedCode} para sua Loja Kyrub? Se ele estiver ativo e elegível, o entitlement do plano poderá ser alterado.`
    )) {
      return;
    }

    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await redeemKyrubCoupon(user, normalizedCode);
      const cached = loadCachedUserStore(
        localStorage,
        user.uid,
        user.email ?? ''
      );
      if (cached) {
        saveCachedUserStore(
          localStorage,
          user.uid,
          { ...cached, plan: result.plan },
          false
        );
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
      setSuccess(
        `${result.code} resgatado. Sua Loja Kyrub agora possui o plano ${result.plan === 'business' ? 'Business' : 'Pro'}${result.benefitEndsAt ? ` até ${new Date(result.benefitEndsAt).toLocaleDateString('pt-BR')}` : ' sem vencimento promocional definido'}.`
      );
      setCode('');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Não foi possível resgatar este cupom.'
      );
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
          onClick={() => {
            setError('');
            setSuccess('');
            setOpen(true);
          }}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs font-black text-violet-200 transition hover:bg-violet-500/20"
        >
          <TicketPercent className="h-4 w-4" />
          Resgatar cupom
        </button>,
        host
      )}

      {open && createPortal(
        <div
          className="fixed inset-0 z-[10060] flex items-start justify-center overflow-y-auto bg-slate-950/80 p-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-sm sm:p-6"
          data-kyrub-skip-top-overlay="true"
          onMouseDown={event => {
            if (event.target === event.currentTarget && !busy) setOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="store-coupon-redemption-title"
            className="w-full max-w-md rounded-[2rem] border border-violet-500/25 bg-slate-900 p-5 text-slate-100 shadow-2xl sm:p-6"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-violet-300">
                  <TicketPercent className="h-5 w-5" />
                  <span className="text-[10px] font-black uppercase tracking-[0.18em]">Cupom Kyrub</span>
                </div>
                <h2 id="store-coupon-redemption-title" className="mt-2 text-xl font-black text-white">
                  Resgatar benefício
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  Digite o código compartilhado pelo Kyrub. O servidor confirma validade, limites e elegibilidade antes de alterar o plano da loja.
                </p>
              </div>
              <button
                type="button"
                aria-label="Fechar resgate de cupom"
                disabled={busy}
                onClick={() => setOpen(false)}
                className="rounded-xl border border-slate-700 p-2 text-slate-400 hover:text-white disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={redeem} className="mt-5 space-y-3">
              <label className="block">
                <span className="mb-2 block text-[10px] font-black uppercase tracking-wider text-slate-500">
                  Código
                </span>
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
              </label>

              <button
                type="submit"
                disabled={busy || !code.trim()}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-violet-500 px-4 py-3 text-sm font-black text-white hover:bg-violet-400 disabled:opacity-50"
              >
                {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <TicketPercent className="h-4 w-4" />}
                {busy ? 'Validando cupom' : 'Resgatar cupom'}
              </button>
            </form>

            {error && (
              <div className="mt-4 rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200" role="alert">
                {error}
              </div>
            )}
            {success && (
              <div className="mt-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm leading-relaxed text-emerald-200" role="status">
                {success}
              </div>
            )}
          </section>
        </div>,
        document.body
      )}
    </>
  );
}
