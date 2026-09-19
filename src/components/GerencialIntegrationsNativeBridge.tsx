import { lazy, Suspense, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const LazyIntegrationsRuntime = lazy(async () => {
  const module = await import('./GerencialIntegrationsRuntime');
  return { default: module.GerencialIntegrationsRuntime };
});

const LEGACY_INTEGRATIONS_HEADING = 'CONFIGURAÇÃO DE CANAIS EXTERNOS';

const findLegacyIntegrationsGrid = (): HTMLElement | null => {
  const managementContainer = document.getElementById('erp-gerencial-tab');
  if (!managementContainer) return null;

  const integrationsHeading = Array.from(
    managementContainer.querySelectorAll('h4')
  ).find(
    heading =>
      heading.textContent?.trim().toLocaleUpperCase('pt-BR') ===
      LEGACY_INTEGRATIONS_HEADING
  );
  const candidate = integrationsHeading?.closest('.grid');
  return candidate instanceof HTMLElement ? candidate : null;
};

/**
 * The production retailer shell still renders the legacy Gerencial DOM while
 * individual modules are migrated. This bridge replaces only the legacy
 * Integracoes submodule with the authoritative native runtime that already
 * owns Mercado Livre, fiscal connectors and store connection state.
 */
export function GerencialIntegrationsNativeBridge() {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    let cancelled = false;
    let timer = 0;
    let portalHost: HTMLDivElement | null = null;
    let legacyGrid: HTMLElement | null = null;
    let previousDisplay = '';

    const detachCurrentHost = (): void => {
      if (legacyGrid?.isConnected) {
        legacyGrid.style.display = previousDisplay;
      }
      portalHost?.remove();
      portalHost = null;
      legacyGrid = null;
      previousDisplay = '';
      setHost(null);
    };

    const synchronize = (): void => {
      if (cancelled) return;

      if (portalHost && !portalHost.isConnected) {
        portalHost = null;
        legacyGrid = null;
        previousDisplay = '';
        setHost(null);
      }

      if (!portalHost) {
        const candidate = findLegacyIntegrationsGrid();
        if (candidate?.parentElement) {
          legacyGrid = candidate;
          previousDisplay = candidate.style.display;
          candidate.style.display = 'none';

          portalHost = document.createElement('div');
          portalHost.id = 'kyrub-native-integrations-runtime-host';
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
      detachCurrentHost();
    };
  }, []);

  if (!host) return null;

  return createPortal(
    <Suspense
      fallback={
        <div className="rounded-3xl border border-cyan-500/20 bg-slate-900 p-5 text-[10px] text-cyan-100">
          Carregando Integrações…
        </div>
      }
    >
      <LazyIntegrationsRuntime triggerToast={() => undefined} />
    </Suspense>,
    host
  );
}
