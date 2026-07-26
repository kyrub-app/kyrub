import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Package } from 'lucide-react';

type HiddenElementState = {
  element: HTMLElement;
  display: string;
  ariaHidden: string | null;
};

const normalizeText = (value: string | null | undefined): string =>
  value?.trim().toLocaleUpperCase('pt-BR') ?? '';

const findManagementBackButton = (
  container: HTMLElement
): HTMLButtonElement | null =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    button => normalizeText(button.textContent).includes('MENU GERENCIAL')
  ) ?? null;

const findLegacyProductsGrid = (
  container: HTMLElement
): HTMLElement | null => {
  const legacyHeading = Array.from(container.querySelectorAll('h4')).find(
    heading => {
      const text = normalizeText(heading.textContent);
      return (
        text === 'APARÊNCIA DA VITRINE' ||
        text === 'ITENS ATIVOS NO ESTOQUE'
      );
    }
  );

  const grid = legacyHeading?.closest('.grid');
  return grid instanceof HTMLElement ? grid : null;
};

export function ProductWorkspaceLayoutBridge() {
  const [navigationHost, setNavigationHost] = useState<HTMLElement | null>(null);
  const backButtonRef = useRef<HTMLButtonElement | null>(null);
  const hiddenBreadcrumbRef = useRef<HiddenElementState | null>(null);
  const hiddenLegacyGridRef = useRef<HiddenElementState | null>(null);
  const createdHostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const restoreHiddenElement = (
      hiddenElementRef: React.MutableRefObject<HiddenElementState | null>
    ): void => {
      const hiddenState = hiddenElementRef.current;
      if (!hiddenState) return;

      if (hiddenState.element.isConnected) {
        hiddenState.element.style.display = hiddenState.display;
        if (hiddenState.ariaHidden === null) {
          hiddenState.element.removeAttribute('aria-hidden');
        } else {
          hiddenState.element.setAttribute('aria-hidden', hiddenState.ariaHidden);
        }
      }
      hiddenElementRef.current = null;
    };

    const teardown = (): void => {
      createdHostRef.current?.remove();
      createdHostRef.current = null;
      setNavigationHost(null);
      backButtonRef.current = null;
      restoreHiddenElement(hiddenBreadcrumbRef);
      restoreHiddenElement(hiddenLegacyGridRef);
    };

    const hideElement = (
      element: HTMLElement,
      hiddenElementRef: React.MutableRefObject<HiddenElementState | null>
    ): void => {
      if (hiddenElementRef.current?.element === element) {
        element.style.display = 'none';
        element.setAttribute('aria-hidden', 'true');
        return;
      }

      restoreHiddenElement(hiddenElementRef);
      hiddenElementRef.current = {
        element,
        display: element.style.display,
        ariaHidden: element.getAttribute('aria-hidden'),
      };
      element.style.display = 'none';
      element.setAttribute('aria-hidden', 'true');
    };

    const synchronize = (): void => {
      const workspace = document.getElementById('erp-product-inventory-workspace');
      const portalHost = document.getElementById(
        'kyrub-product-inventory-workspace-host'
      );
      const managementContainer = document.getElementById('erp-gerencial-tab');

      if (
        !(workspace instanceof HTMLElement) ||
        !(portalHost instanceof HTMLElement) ||
        !(managementContainer instanceof HTMLElement) ||
        !portalHost.parentElement
      ) {
        if (createdHostRef.current || hiddenBreadcrumbRef.current) teardown();
        return;
      }

      const originalBackButton = findManagementBackButton(managementContainer);
      const originalBreadcrumb = originalBackButton?.parentElement;
      if (
        originalBackButton &&
        originalBreadcrumb instanceof HTMLElement &&
        normalizeText(originalBreadcrumb.textContent).includes('PRODUTOS')
      ) {
        backButtonRef.current = originalBackButton;
        hideElement(originalBreadcrumb, hiddenBreadcrumbRef);
      }

      const legacyGrid = findLegacyProductsGrid(managementContainer);
      if (legacyGrid) hideElement(legacyGrid, hiddenLegacyGridRef);

      if (!createdHostRef.current?.isConnected) {
        const host = document.createElement('div');
        host.id = 'erp-product-navigation-host';
        host.className = 'min-w-0';
        portalHost.parentElement.insertBefore(host, portalHost);
        createdHostRef.current = host;
        setNavigationHost(host);
      }
    };

    synchronize();
    const observer = new MutationObserver(synchronize);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
      teardown();
    };
  }, []);

  if (!navigationHost) return null;

  return createPortal(
    <nav
      className="mb-3 flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/90 px-3 py-2 shadow-lg"
      id="erp-product-navigation"
      aria-label="Navegação do módulo de produtos"
    >
      <button
        type="button"
        onClick={() => backButtonRef.current?.click()}
        className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 text-[10px] font-black uppercase text-slate-300 transition-colors hover:border-orange-500/40 hover:text-white"
        id="erp-product-back-to-management"
      >
        <ArrowLeft className="h-4 w-4 text-orange-400" />
        Menu Gerencial
      </button>

      <span className="flex min-w-0 items-center gap-2 font-mono text-[10px] font-bold uppercase text-slate-500">
        <Package className="h-4 w-4 shrink-0 text-orange-400" />
        <span className="truncate">/ produtos</span>
      </span>
    </nav>,
    navigationHost
  );
}
