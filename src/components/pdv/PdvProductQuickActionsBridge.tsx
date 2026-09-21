import { useEffect } from 'react';

const STAFF_ADD_BUTTON_SELECTOR = 'button[id^="staff-pdv-add-"]';
const QUICK_ACTIONS_HOST_ATTRIBUTE = 'data-kyrub-pdv-quick-actions-host';
const SPLIT_ACTIONS_ATTRIBUTE = 'data-kyrub-pdv-split-actions';
const ORIGINAL_DISPLAY_ATTRIBUTE = 'data-kyrub-pdv-original-display';

const isCustomizableProductButton = (button: HTMLButtonElement): boolean =>
  Boolean(button.querySelector('.lucide-sliders-horizontal'));

const clickCustomizationConfirm = (attempt = 0): void => {
  const confirm = document.getElementById('staff-pdv-confirm-customization');
  if (confirm instanceof HTMLButtonElement) {
    confirm.click();
    return;
  }

  if (attempt >= 8) return;
  window.setTimeout(() => clickCustomizationConfirm(attempt + 1), 16);
};

export const PdvProductQuickActionsBridge = () => {
  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    const sync = (): void => {
      if (cancelled) return;

      const originals = Array.from(
        document.querySelectorAll<HTMLButtonElement>(STAFF_ADD_BUTTON_SELECTOR)
      );

      for (const original of originals) {
        const existingHost = original.parentElement?.querySelector<HTMLElement>(
          `[${QUICK_ACTIONS_HOST_ATTRIBUTE}="${original.id}"]`
        );

        if (existingHost) {
          const details = existingHost.querySelector<HTMLButtonElement>(
            '[data-kyrub-pdv-action="details"]'
          );
          const quickAdd = existingHost.querySelector<HTMLButtonElement>(
            '[data-kyrub-pdv-action="quick-add"]'
          );
          if (details) details.disabled = original.disabled;
          if (quickAdd) quickAdd.disabled = original.disabled;
          continue;
        }

        const parent = original.parentElement;
        if (!(parent instanceof HTMLElement)) continue;

        const host = document.createElement('div');
        host.setAttribute(QUICK_ACTIONS_HOST_ATTRIBUTE, original.id);
        host.className = 'flex w-full items-center gap-1.5 sm:w-auto';

        const details = document.createElement('button');
        details.type = 'button';
        details.textContent = 'Detalhes';
        details.disabled = original.disabled;
        details.setAttribute('data-kyrub-pdv-action', 'details');
        details.setAttribute('aria-label', 'Ver detalhes do produto');
        details.className =
          'flex min-h-9 min-w-0 flex-1 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 px-2 py-2 text-[8px] font-black uppercase tracking-wide text-slate-300 transition-colors hover:border-orange-500/40 hover:text-orange-300 disabled:cursor-not-allowed disabled:opacity-35 sm:min-h-11 sm:px-3 sm:text-[9px]';
        details.addEventListener('click', () => {
          if (!original.disabled) original.click();
        });

        const quickAdd = document.createElement('button');
        quickAdd.type = 'button';
        quickAdd.textContent = '+ Add';
        quickAdd.disabled = original.disabled;
        quickAdd.setAttribute('data-kyrub-pdv-action', 'quick-add');
        quickAdd.setAttribute('aria-label', 'Adicionar produto diretamente aos itens do pedido');
        quickAdd.className =
          'flex min-h-9 shrink-0 items-center justify-center rounded-xl px-2.5 py-2 text-[8px] font-black uppercase tracking-wide text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-35 sm:min-h-11 sm:px-3 sm:text-[9px]';
        quickAdd.style.backgroundColor = original.style.backgroundColor || '#f97316';
        quickAdd.addEventListener('click', () => {
          if (original.disabled) return;

          original.click();

          if (isCustomizableProductButton(original)) {
            return;
          }

          window.setTimeout(() => clickCustomizationConfirm(), 0);
        });

        host.append(details, quickAdd);

        original.setAttribute(SPLIT_ACTIONS_ATTRIBUTE, 'true');
        original.setAttribute(ORIGINAL_DISPLAY_ATTRIBUTE, original.style.display);
        original.style.display = 'none';
        parent.appendChild(host);
      }
    };

    const scheduleSync = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(sync, 20);
    };

    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled'],
    });

    sync();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      observer.disconnect();

      document
        .querySelectorAll<HTMLElement>(`[${QUICK_ACTIONS_HOST_ATTRIBUTE}]`)
        .forEach(host => host.remove());

      document
        .querySelectorAll<HTMLButtonElement>(`${STAFF_ADD_BUTTON_SELECTOR}[${SPLIT_ACTIONS_ATTRIBUTE}]`)
        .forEach(original => {
          original.style.display = original.getAttribute(ORIGINAL_DISPLAY_ATTRIBUTE) ?? '';
          original.removeAttribute(SPLIT_ACTIONS_ATTRIBUTE);
          original.removeAttribute(ORIGINAL_DISPLAY_ATTRIBUTE);
        });
    };
  }, []);

  return null;
};
