import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../utils/firebase';
import {
  KYRUB_ERP_MANAGEMENT_NAVIGATION_EVENT,
  type ErpManagementNavigationRequest,
} from '../../utils/erpManagementNavigation';
import { StoreCrmRelationshipPanel } from './StoreCrmRelationshipPanel';

const findLegacyCrmButton = (container: HTMLElement): HTMLButtonElement | null => {
  const candidate = Array.from(container.querySelectorAll('button')).find(button =>
    Array.from(button.querySelectorAll('h3, h4')).some(
      heading => heading.textContent?.trim().toLocaleUpperCase('pt-BR') === 'CRM'
    )
  );

  return candidate instanceof HTMLButtonElement ? candidate : null;
};

export const StoreCrmRelationshipBridge = () => {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [storeId, setStoreId] = useState('');
  const [crmSelected, setCrmSelected] = useState(false);

  useEffect(
    () => onAuthStateChanged(auth, user => setStoreId(user?.uid ?? '')),
    []
  );

  useEffect(() => {
    const handleManagementNavigation = (event: Event): void => {
      const detail = (
        event as CustomEvent<ErpManagementNavigationRequest>
      ).detail;
      setCrmSelected(detail?.module === 'crm');
    };

    window.addEventListener(
      KYRUB_ERP_MANAGEMENT_NAVIGATION_EVENT,
      handleManagementNavigation
    );

    return () => {
      window.removeEventListener(
        KYRUB_ERP_MANAGEMENT_NAVIGATION_EVENT,
        handleManagementNavigation
      );
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let portalHost: HTMLDivElement | null = null;
    let crmButton: HTMLButtonElement | null = null;
    let previousButtonDisabled = true;
    let previousButtonAriaDisabled: string | null = null;
    let previousButtonClassName = '';
    const hiddenChildren = new Map<HTMLElement, string>();

    const restoreLegacyChildren = (): void => {
      hiddenChildren.forEach((display, element) => {
        if (element.isConnected) element.style.display = display;
      });
      hiddenChildren.clear();
    };

    const detachHost = (): void => {
      restoreLegacyChildren();
      portalHost?.remove();
      portalHost = null;
      setHost(null);
    };

    const activateFromLegacyButton = (): void => {
      setCrmSelected(true);
    };

    const restoreCrmButton = (): void => {
      if (!crmButton?.isConnected) {
        crmButton = null;
        return;
      }

      crmButton.removeEventListener('click', activateFromLegacyButton);
      crmButton.disabled = previousButtonDisabled;
      if (previousButtonAriaDisabled === null) {
        crmButton.removeAttribute('aria-disabled');
      } else {
        crmButton.setAttribute('aria-disabled', previousButtonAriaDisabled);
      }
      crmButton.className = previousButtonClassName;
      delete crmButton.dataset.kyrubCrmEntry;
      crmButton = null;
    };

    const enhanceCrmButton = (container: HTMLElement): void => {
      const candidate = findLegacyCrmButton(container);
      if (!candidate || candidate === crmButton) return;

      restoreCrmButton();
      crmButton = candidate;
      previousButtonDisabled = candidate.disabled;
      previousButtonAriaDisabled = candidate.getAttribute('aria-disabled');
      previousButtonClassName = candidate.className;

      candidate.disabled = false;
      candidate.setAttribute('aria-disabled', 'false');
      candidate.dataset.kyrubCrmEntry = 'true';
      candidate.className = candidate.className
        .replace(/cursor-not-allowed/g, 'cursor-pointer')
        .replace(/opacity-75/g, '')
        .concat(' hover:border-cyan-500/35');
      candidate.addEventListener('click', activateFromLegacyButton);

      const badge = Array.from(candidate.querySelectorAll('span')).find(span =>
        span.textContent?.trim().toLocaleLowerCase('pt-BR') ===
        'em desenvolvimento'
      );
      if (badge instanceof HTMLElement) {
        badge.textContent = 'Disponível';
        badge.className = badge.className
          .replace(/text-cyan-400/g, 'text-emerald-300')
          .replace(/bg-cyan-500\/10/g, 'bg-emerald-500/10')
          .replace(/border-cyan-500\/20/g, 'border-emerald-500/20');
      }
    };

    const synchronize = (): void => {
      if (cancelled) return;

      const container = document.getElementById('erp-gerencial-tab');
      if (!container) {
        detachHost();
        restoreCrmButton();
        timer = window.setTimeout(synchronize, 80);
        return;
      }

      enhanceCrmButton(container);

      if (!crmSelected) {
        detachHost();
        timer = window.setTimeout(synchronize, 80);
        return;
      }

      if (!portalHost?.isConnected) {
        portalHost = document.createElement('div');
        portalHost.id = 'store-crm-relationship-host';
        portalHost.className = 'min-w-0';
        container.insertBefore(portalHost, container.firstChild);
        setHost(portalHost);
      }

      Array.from(container.children).forEach(child => {
        if (!(child instanceof HTMLElement) || child === portalHost) return;
        if (!hiddenChildren.has(child)) {
          hiddenChildren.set(child, child.style.display);
        }
        child.style.display = 'none';
      });

      timer = window.setTimeout(synchronize, 80);
    };

    timer = window.setTimeout(synchronize, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      detachHost();
      restoreCrmButton();
    };
  }, [crmSelected]);

  if (!host || !storeId || !crmSelected) return null;

  return createPortal(
    <div className="space-y-4" data-kyrub-gerencial-module="crm">
      <button
        type="button"
        onClick={() => setCrmSelected(false)}
        className="inline-flex min-h-10 items-center rounded-xl border border-slate-700 bg-slate-950 px-3 text-[10px] font-black uppercase tracking-wide text-slate-300 transition-colors hover:border-cyan-500/40 hover:text-white"
      >
        ← Menu Gerencial
      </button>
      <StoreCrmRelationshipPanel storeId={storeId} />
    </div>,
    host
  );
};
