import { useEffect } from 'react';

const ACTIVE_CONVERSATION_SELECTOR =
  '#kyrub-ai-workspace > section:has(> header):has(> form)';
const BACK_BUTTON_SELECTOR = 'button[aria-label="Voltar às conversas"]';

const visibleViewportBounds = (): { top: number; bottom: number } => {
  const viewport = window.visualViewport;
  if (!viewport) {
    return { top: 0, bottom: window.innerHeight };
  }

  return {
    top: viewport.offsetTop,
    bottom: viewport.offsetTop + viewport.height,
  };
};

const isHeaderVisible = (header: HTMLElement): boolean => {
  const rectangle = header.getBoundingClientRect();
  const viewport = visibleViewportBounds();
  return (
    rectangle.bottom > viewport.top + 8 &&
    rectangle.top < viewport.bottom - 8
  );
};

export function KyrubAiConversationHeaderGuard() {
  useEffect(() => {
    let animationFrame = 0;
    let fallbackTimer = 0;
    let currentConversation: HTMLElement | null = null;

    const fallbackButton = document.createElement('button');
    fallbackButton.type = 'button';
    fallbackButton.hidden = true;
    fallbackButton.setAttribute('aria-label', 'Voltar às conversas');
    fallbackButton.dataset.kyrubAiFallbackBack = 'true';
    fallbackButton.textContent = '← Voltar';
    Object.assign(fallbackButton.style, {
      position: 'fixed',
      zIndex: '140',
      top: 'max(12px, env(safe-area-inset-top, 0px))',
      left: 'max(12px, env(safe-area-inset-left, 0px))',
      minHeight: '44px',
      padding: '0 14px',
      border: '1px solid rgb(51 65 85)',
      borderRadius: '9999px',
      background: 'rgb(15 23 42 / 0.96)',
      color: 'rgb(226 232 240)',
      fontSize: '14px',
      fontWeight: '800',
      boxShadow: '0 12px 30px rgb(2 6 23 / 0.45)',
      backdropFilter: 'blur(12px)',
    });

    fallbackButton.addEventListener('click', () => {
      document
        .querySelector<HTMLButtonElement>(
          `${ACTIVE_CONVERSATION_SELECTOR} > header ${BACK_BUTTON_SELECTOR}`
        )
        ?.click();
    });
    document.body.appendChild(fallbackButton);

    const revealConversation = (conversation: HTMLElement): void => {
      conversation.scrollIntoView({
        behavior: 'auto',
        block: 'start',
        inline: 'nearest',
      });
    };

    const sync = (): void => {
      const conversation = document.querySelector<HTMLElement>(
        ACTIVE_CONVERSATION_SELECTOR
      );
      const header = conversation?.querySelector<HTMLElement>(':scope > header');
      const backButton = header?.querySelector<HTMLButtonElement>(
        BACK_BUTTON_SELECTOR
      );

      if (!conversation || !header || !backButton) {
        currentConversation = null;
        fallbackButton.hidden = true;
        return;
      }

      header.dataset.kyrubAiConversationHeader = 'true';

      if (conversation !== currentConversation) {
        currentConversation = conversation;
        revealConversation(conversation);
      } else if (!isHeaderVisible(header)) {
        revealConversation(conversation);
      }

      window.clearTimeout(fallbackTimer);
      fallbackTimer = window.setTimeout(() => {
        fallbackButton.hidden = isHeaderVisible(header);
      }, 80);
    };

    const scheduleSync = (): void => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(sync);
    };

    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    document.addEventListener('scroll', scheduleSync, true);
    window.addEventListener('resize', scheduleSync);
    window.visualViewport?.addEventListener('resize', scheduleSync);
    window.visualViewport?.addEventListener('scroll', scheduleSync);
    scheduleSync();

    return () => {
      observer.disconnect();
      document.removeEventListener('scroll', scheduleSync, true);
      window.removeEventListener('resize', scheduleSync);
      window.visualViewport?.removeEventListener('resize', scheduleSync);
      window.visualViewport?.removeEventListener('scroll', scheduleSync);
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(fallbackTimer);
      fallbackButton.remove();
      document
        .querySelectorAll<HTMLElement>('[data-kyrub-ai-conversation-header]')
        .forEach(element => {
          delete element.dataset.kyrubAiConversationHeader;
        });
    };
  }, []);

  return (
    <style>{`
      [data-kyrub-ai-conversation-header="true"] {
        position: relative !important;
        z-index: 30 !important;
        flex: 0 0 auto !important;
        background: rgb(2 6 23 / 0.98) !important;
        backdrop-filter: blur(12px) !important;
      }
    `}</style>
  );
}
