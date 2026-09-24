import { useEffect } from 'react';

const FILTERS_ID = 'marketplace-discovery-filters';
const WORKSPACE_ID = 'kyrub-ai-workspace';

export function KyrubiaMarketplaceFilterGuard() {
  useEffect(() => {
    let hiddenFilters: HTMLElement | null = null;
    let previousDisplay = '';
    let previousAriaHidden: string | null = null;

    const restore = () => {
      if (!hiddenFilters) return;
      hiddenFilters.style.display = previousDisplay;
      if (previousAriaHidden === null) hiddenFilters.removeAttribute('aria-hidden');
      else hiddenFilters.setAttribute('aria-hidden', previousAriaHidden);
      hiddenFilters = null;
      previousDisplay = '';
      previousAriaHidden = null;
    };

    const sync = () => {
      const workspaceOpen = document.getElementById(WORKSPACE_ID) instanceof HTMLElement;
      const filters = document.getElementById(FILTERS_ID);

      if (!workspaceOpen || !(filters instanceof HTMLElement)) {
        restore();
        return;
      }

      if (hiddenFilters !== filters) {
        restore();
        hiddenFilters = filters;
        previousDisplay = filters.style.display;
        previousAriaHidden = filters.getAttribute('aria-hidden');
      }

      filters.style.display = 'none';
      filters.setAttribute('aria-hidden', 'true');
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    const interval = window.setInterval(sync, 500);

    return () => {
      observer.disconnect();
      window.clearInterval(interval);
      restore();
    };
  }, []);

  return null;
}
