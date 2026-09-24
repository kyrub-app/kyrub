import { useEffect } from 'react';

type HeaderDiscoveryDestination = 'praca' | 'marketplace';

const MAX_ACTIVATION_ATTEMPTS = 24;

const findProfileTrigger = (): HTMLButtonElement | null => {
  const trigger = document.getElementById('header-user-profile-trigger');
  return trigger instanceof HTMLButtonElement ? trigger : null;
};

const findSquareButton = (): HTMLButtonElement | null => {
  const socialHub = document.getElementById('profile-social-hub-modal');
  if (!(socialHub instanceof HTMLElement)) return null;

  const sections = socialHub.querySelector(
    'nav[aria-label="Seções do perfil"]'
  );
  if (!(sections instanceof HTMLElement)) return null;

  return (
    Array.from(sections.querySelectorAll('button')).find(button =>
      (button.textContent ?? '')
        .trim()
        .toLocaleLowerCase('pt-BR')
        .includes('praça')
    ) as HTMLButtonElement | undefined
  ) ?? null;
};

const findMarketplaceOpenButton = (): HTMLButtonElement | null => {
  const socialHub = document.getElementById('profile-social-hub-modal');
  if (!(socialHub instanceof HTMLElement)) return null;

  const button = socialHub.querySelector('button[aria-label="Abrir Ofertas"]');
  return button instanceof HTMLButtonElement ? button : null;
};

const findMarketplaceCloseButton = (): HTMLButtonElement | null => {
  const button = document.querySelector('button[aria-label="Fechar Ofertas"]');
  return button instanceof HTMLButtonElement ? button : null;
};

const closeSocialHub = (): void => {
  const button = document.querySelector(
    '#profile-social-hub-modal button[aria-label="Fechar meu perfil"]'
  );
  if (button instanceof HTMLButtonElement) button.click();
};

const closeWalletModal = (): void => {
  const modal = document.getElementById('modal-wallet');
  if (!(modal instanceof HTMLElement)) return;

  const closeButton = Array.from(modal.querySelectorAll('button')).find(
    button => (button.textContent ?? '').trim() === '✕'
  );
  if (closeButton instanceof HTMLButtonElement) closeButton.click();
};

const ensureSocialHubOpen = (): void => {
  if (document.getElementById('profile-social-hub-modal')) return;
  findProfileTrigger()?.click();
};

export function HeaderDiscoveryShortcutActivationBridge() {
  useEffect(() => {
    let pendingDestination: HeaderDiscoveryDestination | null = null;
    let activationAttempts = 0;
    let activationFrame: number | null = null;

    const clearPendingActivation = (): void => {
      pendingDestination = null;
      activationAttempts = 0;
      if (activationFrame !== null) {
        window.cancelAnimationFrame(activationFrame);
        activationFrame = null;
      }
    };

    const activatePendingDestination = (): void => {
      activationFrame = null;
      const destination = pendingDestination;
      if (!destination) return;

      ensureSocialHubOpen();

      if (destination === 'praca') {
        findMarketplaceCloseButton()?.click();
        const squareButton = findSquareButton();
        if (squareButton) {
          pendingDestination = null;
          activationAttempts = 0;
          squareButton.click();
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
      } else {
        if (findMarketplaceCloseButton()) {
          pendingDestination = null;
          activationAttempts = 0;
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }

        const marketplaceButton = findMarketplaceOpenButton();
        if (marketplaceButton) {
          pendingDestination = null;
          activationAttempts = 0;
          marketplaceButton.click();
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
      }

      activationAttempts += 1;
      if (activationAttempts > MAX_ACTIVATION_ATTEMPTS) {
        clearPendingActivation();
        return;
      }

      activationFrame = window.requestAnimationFrame(
        activatePendingDestination
      );
    };

    const scheduleActivation = (
      destination: HeaderDiscoveryDestination
    ): void => {
      pendingDestination = destination;
      activationAttempts = 0;
      ensureSocialHubOpen();

      if (activationFrame === null) {
        activationFrame = window.requestAnimationFrame(
          activatePendingDestination
        );
      }
    };

    const handleHeaderShortcutClick = (event: MouseEvent): void => {
      const target = event.target as Element | null;
      if (!target) return;

      const walletTrigger = target.closest(
        '#header-wallet-balance > button:first-child'
      );
      if (walletTrigger instanceof HTMLButtonElement) {
        clearPendingActivation();
        closeSocialHub();
        return;
      }

      const notesTrigger = target.closest('#header-notes-trigger');
      if (notesTrigger instanceof HTMLButtonElement) {
        clearPendingActivation();
        closeWalletModal();
        return;
      }

      const trigger = target.closest(
        '#header-praca-trigger, #header-marketplace-trigger'
      );
      if (!(trigger instanceof HTMLButtonElement)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      closeWalletModal();
      scheduleActivation(
        trigger.id === 'header-praca-trigger' ? 'praca' : 'marketplace'
      );
    };

    document.addEventListener('click', handleHeaderShortcutClick, true);

    return () => {
      document.removeEventListener('click', handleHeaderShortcutClick, true);
      clearPendingActivation();
    };
  }, []);

  return null;
}
