import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CreditCard, ExternalLink } from 'lucide-react';
import { getPlanCenterUrl } from '../utils/planCenter';

export function ProfilePlanCenterBridge() {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const synchronize = () => {
      const closeButton = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Fechar configurações do perfil"]'
      );
      const modal = closeButton?.closest<HTMLElement>('.fixed');
      if (!modal) {
        setTarget(null);
        return;
      }

      const usageHeading = [...modal.querySelectorAll<HTMLElement>('h4')].find(
        element => element.textContent?.trim() === 'Perfis de uso'
      );
      const usageSection = usageHeading?.closest<HTMLElement>('section');
      if (!usageSection) {
        setTarget(null);
        return;
      }

      let slot = modal.querySelector<HTMLElement>(
        '[data-kyrub-plan-center-profile-slot="true"]'
      );
      if (!slot) {
        slot = document.createElement('div');
        slot.dataset.kyrubPlanCenterProfileSlot = 'true';
        usageSection.insertAdjacentElement('afterend', slot);
      }
      setTarget(current => (current === slot ? current : slot));
    };

    synchronize();
    const observer = new MutationObserver(synchronize);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      document
        .querySelectorAll<HTMLElement>('[data-kyrub-plan-center-profile-slot="true"]')
        .forEach(element => element.remove());
    };
  }, []);

  if (!target) return null;

  return createPortal(
    <section className="mt-4 rounded-2xl border border-violet-500/25 bg-violet-500/5 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-300">
          <CreditCard className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-[10px] font-black uppercase text-slate-100">
            Plano e faturamento
          </h4>
          <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
            Compare planos, consulte sua capacidade e resgate cupons na Central de Planos.
          </p>
          <a
            href={getPlanCenterUrl()}
            className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-[10px] font-black uppercase text-violet-200 hover:bg-violet-500/20"
          >
            Abrir Central de Planos <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </section>,
    target
  );
}
