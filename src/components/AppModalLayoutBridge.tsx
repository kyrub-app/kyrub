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

const normalizeText = (value: string | null | undefined): string =>
  (value ?? '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('pt-BR');

const isKyrubAiNotePanel = (panel: HTMLElement): boolean => {
  const accessibleLabel = normalizeText(panel.getAttribute('aria-label'));
  const title = normalizeText(panel.querySelector(':scope > header h2')?.textContent);
  return (
    accessibleLabel.includes('CRIAÇÃO DE NOTA') ||
    title.includes('CONFIRMAR NOVA NOTA') ||
    title.includes('NOTA CRIADA')
  );
};

const visibleViewportBottom = (): number => {
  const viewport = window.visualViewport;
  return viewport
    ? viewport.offsetTop + viewport.height
    : window.innerHeight;
};

const conversationBottomBoundary = (
  conversationTop: number,
  viewportBottom: number
): number => {
  let boundary = viewportBottom;

  document.querySelectorAll<HTMLElement>('nav').forEach(navigation => {
    const rectangle = navigation.getBoundingClientRect();
    const isVisible = rectangle.height > 0 && rectangle.bottom > 0;
    const isBelowConversation = rectangle.top > conversationTop + 120;
    const isInsideViewport = rectangle.top < boundary;

    if (isVisible && isBelowConversation && isInsideViewport) {
      boundary = rectangle.top;
    }
  });

  return boundary;
};

export function AppModalLayoutBridge() {
  useEffect(() => {
    const decoratedOverlays = new Set<HTMLElement>();
    const decoratedPanels = new Set<HTMLElement>();
    const decoratedNoteOverlays = new Set<HTMLElement>();
    const decoratedNotePanels = new Set<HTMLElement>();
    const decoratedConversations = new Set<HTMLElement>();

    const decorateConversation = () => {
      const conversation = document.querySelector<HTMLElement>(
        '#kyrub-ai-workspace > section'
      );
      if (!conversation) return;

      conversation.dataset.kyrubAiConversation = 'true';
      decoratedConversations.add(conversation);

      const rectangle = conversation.getBoundingClientRect();
      const viewportBottom = visibleViewportBottom();
      const boundary = conversationBottomBoundary(rectangle.top, viewportBottom);
      const availableHeight = Math.max(
        240,
        Math.floor(boundary - rectangle.top - 8)
      );

      conversation.style.setProperty(
        '--kyrub-ai-conversation-height',
        `${availableHeight}px`
      );
    };

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

          if (isKyrubAiNotePanel(panel)) {
            overlay.dataset.kyrubAiNoteOverlay = 'true';
            panel.dataset.kyrubAiNotePanel = 'true';
            decoratedNoteOverlays.add(overlay);
            decoratedNotePanels.add(panel);
          }
        });

      decorateConversation();
    };

    decorate();
    const observer = new MutationObserver(decorate);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', decorate);
    window.visualViewport?.addEventListener('resize', decorate);
    window.visualViewport?.addEventListener('scroll', decorate);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', decorate);
      window.visualViewport?.removeEventListener('resize', decorate);
      window.visualViewport?.removeEventListener('scroll', decorate);
      decoratedOverlays.forEach(overlay => {
        delete overlay.dataset.kyrubTopOverlay;
      });
      decoratedPanels.forEach(panel => {
        delete panel.dataset.kyrubTopPanel;
      });
      decoratedNoteOverlays.forEach(overlay => {
        delete overlay.dataset.kyrubAiNoteOverlay;
      });
      decoratedNotePanels.forEach(panel => {
        delete panel.dataset.kyrubAiNotePanel;
      });
      decoratedConversations.forEach(conversation => {
        delete conversation.dataset.kyrubAiConversation;
        conversation.style.removeProperty('--kyrub-ai-conversation-height');
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

      [data-kyrub-ai-conversation="true"] {
        display: flex !important;
        flex-direction: column !important;
        height: var(--kyrub-ai-conversation-height, 70dvh) !important;
        min-height: 0 !important;
        max-height: var(--kyrub-ai-conversation-height, 70dvh) !important;
        overflow: hidden !important;
        overscroll-behavior: contain !important;
      }

      [data-kyrub-ai-conversation="true"] > header,
      [data-kyrub-ai-conversation="true"] > form {
        position: relative !important;
        z-index: 2 !important;
        flex: 0 0 auto !important;
        background: rgb(2 6 23 / 0.98) !important;
        backdrop-filter: blur(12px) !important;
      }

      [data-kyrub-ai-conversation="true"] > div {
        flex: 1 1 auto !important;
        min-height: 0 !important;
        overflow-x: hidden !important;
        overflow-y: auto !important;
        overscroll-behavior: contain !important;
        -webkit-overflow-scrolling: touch;
        scrollbar-gutter: stable;
      }

      [data-kyrub-ai-note-overlay="true"] {
        overflow-y: hidden !important;
      }

      [data-kyrub-ai-note-panel="true"] {
        display: flex !important;
        flex-direction: column !important;
        min-height: 0 !important;
        overflow: hidden !important;
      }

      [data-kyrub-ai-note-panel="true"] > header,
      [data-kyrub-ai-note-panel="true"] > footer {
        position: relative !important;
        z-index: 2 !important;
        flex: 0 0 auto !important;
        background: rgb(2 6 23 / 0.98) !important;
        backdrop-filter: blur(12px) !important;
      }

      [data-kyrub-ai-note-panel="true"] > div {
        flex: 1 1 auto !important;
        min-height: 0 !important;
        overflow-x: hidden !important;
        overflow-y: auto !important;
        overscroll-behavior: contain !important;
        -webkit-overflow-scrolling: touch;
        scrollbar-gutter: stable;
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
