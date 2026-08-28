import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Coins } from 'lucide-react';

type Props = {
  isOpen: boolean;
  points: number;
  disabled?: boolean;
  onChange: (points: number) => void;
};

export function ProductLoyaltyFieldsBridge({ isOpen, points, disabled, onChange }: Props) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setHost(null);
      return;
    }
    let cancelled = false;
    let timer = 0;
    let currentHost: HTMLDivElement | null = null;
    const sync = () => {
      if (cancelled) return;
      const tab = document.getElementById('product-showcase-tab');
      if (!tab) {
        timer = window.setTimeout(sync, 80);
        return;
      }
      if (!currentHost || !currentHost.isConnected) {
        currentHost = document.createElement('div');
        currentHost.id = 'product-loyalty-points-host';
        const preparation = document.getElementById('product-preparation-station-control');
        if (preparation?.parentElement === tab) tab.insertBefore(currentHost, preparation);
        else tab.appendChild(currentHost);
        setHost(currentHost);
      }
      timer = window.setTimeout(sync, 120);
    };
    sync();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      currentHost?.remove();
      setHost(null);
    };
  }, [isOpen]);

  if (!host) return null;

  return createPortal(
    <section className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4" id="product-loyalty-points-control">
      <div className="flex items-start gap-3">
        <Coins className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
        <div className="min-w-0 flex-1">
          <label className="block text-[10px] font-black uppercase tracking-wide text-amber-200">Fidelidade & pontos</label>
          <p className="mt-1 text-[9px] leading-relaxed text-slate-500">Pontuação-base permanente gerada por uma unidade deste item. Campanhas podem conceder bônus sem alterar esta regra.</p>
          <div className="mt-3 flex items-center gap-2">
            <input
              type="number"
              min="0"
              step="1"
              value={points}
              onChange={event => onChange(Math.max(0, Math.floor(Number(event.target.value) || 0)))}
              disabled={disabled}
              className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs font-black text-amber-200 outline-none focus:border-amber-400 disabled:opacity-45"
            />
            <span className="shrink-0 text-[10px] font-black uppercase text-slate-500">pts / un.</span>
          </div>
          <p className="mt-2 text-[8px] text-slate-600">0 = este item não gera pontos-base.</p>
        </div>
      </div>
    </section>,
    host
  );
}
