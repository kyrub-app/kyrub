import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { Award, Gift, Sparkles, Target } from 'lucide-react';
import { auth } from '../../utils/firebase';
import { StorePromotionsManager } from '../StorePromotionsManager';

const LEGACY_VOUCHER_HEADING = 'CRIAR NOVO CUPOM';

const findLegacyVoucherGrid = (): HTMLElement | null => {
  const managementContainer = document.getElementById('erp-gerencial-tab');
  if (!managementContainer) return null;

  const heading = Array.from(managementContainer.querySelectorAll('h4')).find(
    candidate =>
      candidate.textContent?.trim().toLocaleUpperCase('pt-BR') ===
      LEGACY_VOUCHER_HEADING
  );
  const grid = heading?.closest('.grid');
  return grid instanceof HTMLElement ? grid : null;
};

const LoyaltyGamificationOverview = () => (
  <section
    id="kyrub-loyalty-gamification-overview"
    className="mt-5 rounded-3xl border border-violet-500/20 bg-violet-500/[0.04] p-5"
  >
    <div className="flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-300">
        <Sparkles className="h-5 w-5" />
      </span>
      <div>
        <span className="font-mono text-[9px] font-black uppercase tracking-[0.18em] text-violet-300">
          Fidelidade & Gamificação
        </span>
        <h3 className="mt-1 text-sm font-black text-white">
          Cupons, pontos, desafios e recompensas no mesmo módulo
        </h3>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
          Cupons e vouchers continuam sendo a autoridade de desconto. Pontos, desafios e recompensas ficam separados do preço-base do produto e não alteram pagamentos sem uma regra autoritativa.
        </p>
      </div>
    </div>

    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <article className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
        <Award className="h-5 w-5 text-amber-300" />
        <strong className="mt-3 block text-xs font-black uppercase text-white">Pontos</strong>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
          Saldo, bônus temporários e multiplicadores de pontos por campanha.
        </p>
      </article>
      <article className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
        <Target className="h-5 w-5 text-cyan-300" />
        <strong className="mt-3 block text-xs font-black uppercase text-white">Desafios</strong>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
          Metas de compra, recorrência e ações promocionais com critérios explícitos.
        </p>
      </article>
      <article className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
        <Gift className="h-5 w-5 text-emerald-300" />
        <strong className="mt-3 block text-xs font-black uppercase text-white">Recompensas</strong>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
          Benefícios e trocas por pontos sem misturar recompensa com desconto de checkout.
        </p>
      </article>
    </div>
  </section>
);

/**
 * The retailer production shell still owns Gerencial navigation. When the
 * legacy Vouchers submodule becomes visible, replace only its session-local
 * form with the server-authoritative promotion manager and expose the loyalty
 * surface that belongs to the same commercial module.
 */
export function StorePromotionsLegacyBridge() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let portalHost: HTMLDivElement | null = null;
    let legacyGrid: HTMLElement | null = null;
    let previousDisplay = '';

    const detach = (): void => {
      if (legacyGrid?.isConnected) legacyGrid.style.display = previousDisplay;
      portalHost?.remove();
      portalHost = null;
      legacyGrid = null;
      previousDisplay = '';
      setHost(null);
    };

    const synchronize = (): void => {
      if (cancelled) return;

      if (portalHost && !portalHost.isConnected) detach();

      if (!portalHost) {
        const candidate = findLegacyVoucherGrid();
        if (candidate?.parentElement) {
          legacyGrid = candidate;
          previousDisplay = candidate.style.display;
          candidate.style.display = 'none';

          portalHost = document.createElement('div');
          portalHost.id = 'kyrub-native-store-promotions-host';
          portalHost.className = 'min-w-0';
          candidate.parentElement.insertBefore(portalHost, candidate);
          setHost(portalHost);
        }
      }

      timer = window.setTimeout(synchronize, 80);
    };

    timer = window.setTimeout(synchronize, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      detach();
    };
  }, []);

  if (!user || !host) return null;

  return createPortal(
    <>
      <StorePromotionsManager
        storeId={user.uid}
        products={[]}
        triggerToast={() => undefined}
      />
      <LoyaltyGamificationOverview />
    </>,
    host
  );
}
