import { useEffect } from 'react';

const findModalPanel = (overlay: HTMLElement): HTMLElement | null => {
  for (const child of Array.from(overlay.children)) {
    if (!(child instanceof HTMLElement)) continue;
    const className = child.className;
    if (
      child.tagName === 'SECTION' ||
      child.getAttribute('role') === 'dialog' ||
      (typeof className === 'string' && className.includes('max-w-')) ||
      child.querySelector(':scope > header')
    ) {
      return child;
    }
  }
  return null;
};

export function AppModalLayoutBridge() {
  useEffect(() => {
    const decoratedOverlays = new Set<HTMLElement>();
    const decoratedPanels = new Set<HTMLElement>();

    const decorate = () => {
      document
        .querySelectorAll<HTMLElement>('.fixed.inset-0')
        .forEach(overlay => {
          if (overlay.dataset.kyrubSkipTopOverlay === 'true') return;
          const panel = findModalPanel(overlay);
          if (!panel) return;

          overlay.dataset.kyrubTopOverlay = 'true';
          panel.dataset.kyrubTopPanel = 'true';
          decoratedOverlays.add(overlay);
          decoratedPanels.add(panel);
        });
    };

    decorate();
    const observer = new MutationObserver(decorate);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', decorate);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', decorate);
      decoratedOverlays.forEach(overlay => {
        delete overlay.dataset.kyrubTopOverlay;
      });
      decoratedPanels.forEach(panel => {
        delete panel.dataset.kyrubTopPanel;
      });
    };
  }, []);

  return (
    <style>{`
      [data-kyrub-top-overlay="true"] {
        align-items: flex-start !important;
        justify-content: center !important;
        overflow-x: hidden !important;
        overflow-y: auto !important;
        overscroll-behavior: contain !important;
        padding-top: max(12px, env(safe-area-inset-top, 0px)) !important;
        padding-right: max(12px, env(safe-area-inset-right, 0px)) !important;
        padding-bottom: max(12px, env(safe-area-inset-bottom, 0px)) !important;
        padding-left: max(12px, env(safe-area-inset-left, 0px)) !important;
        scroll-padding-top: max(12px, env(safe-area-inset-top, 0px)) !important;
      }

      [data-kyrub-top-panel="true"] {
        flex-shrink: 0 !important;
        margin-top: 0 !important;
        margin-bottom: 0 !important;
        max-height: calc(
          100dvh - 24px - env(safe-area-inset-top, 0px) -
            env(safe-area-inset-bottom, 0px)
        ) !important;
        border-radius: 24px !important;
      }

      [data-kyrub-top-panel="true"] [class~="text-[7px]"] {
        font-size: 0.6875rem !important;
        line-height: 0.9375rem !important;
      }
      [data-kyrub-top-panel="true"] [class~="text-[8px]"] {
        font-size: 0.75rem !important;
        line-height: 1rem !important;
      }
      [data-kyrub-top-panel="true"] [class~="text-[9px]"] {
        font-size: 0.8125rem !important;
        line-height: 1.0625rem !important;
      }
      [data-kyrub-top-panel="true"] [class~="text-[10px]"] {
        font-size: 0.875rem !important;
        line-height: 1.25rem !important;
      }
      [data-kyrub-top-panel="true"] [class~="text-[11px]"] {
        font-size: 0.9375rem !important;
        line-height: 1.25rem !important;
      }
      [data-kyrub-top-panel="true"] .text-xs {
        font-size: 0.9375rem !important;
        line-height: 1.375rem !important;
      }
      [data-kyrub-top-panel="true"] .text-sm {
        font-size: 1rem !important;
        line-height: 1.5rem !important;
      }
      [data-kyrub-top-panel="true"] .text-base {
        font-size: 1.125rem !important;
        line-height: 1.625rem !important;
      }
      [data-kyrub-top-panel="true"] input,
      [data-kyrub-top-panel="true"] textarea,
      [data-kyrub-top-panel="true"] select {
        font-size: 1rem !important;
        line-height: 1.5rem !important;
      }

      @media (min-width: 640px) {
        [data-kyrub-top-overlay="true"] {
          padding-top: max(24px, env(safe-area-inset-top, 0px)) !important;
          padding-right: max(24px, env(safe-area-inset-right, 0px)) !important;
          padding-bottom: max(24px, env(safe-area-inset-bottom, 0px)) !important;
          padding-left: max(24px, env(safe-area-inset-left, 0px)) !important;
          scroll-padding-top: max(24px, env(safe-area-inset-top, 0px)) !important;
        }

        [data-kyrub-top-panel="true"] {
          max-height: calc(
            100dvh - 48px - env(safe-area-inset-top, 0px) -
              env(safe-area-inset-bottom, 0px)
          ) !important;
        }
      }
    `}</style>
  );
}
