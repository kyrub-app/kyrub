import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckSquare, Compass, Store as StoreIcon } from 'lucide-react';

const SOCIAL_ENTRY_ATTRIBUTE = 'data-kyrub-social-entry';
const PRIMARY_NAV_ATTRIBUTE = 'data-kyrub-primary-workspace-nav';
const ORIGINAL_LABEL_ATTRIBUTE = 'data-kyrub-original-label';

type SocialShortcutDestination = 'praca' | 'marketplace';

const findPrimaryBottomNav = (): HTMLElement | null => {
  const markedNav = document.querySelector(
    `nav[${PRIMARY_NAV_ATTRIBUTE}="true"]`
  );
  if (markedNav instanceof HTMLElement) return markedNav;

  const navs = Array.from(document.querySelectorAll('nav'));
  const nav = navs.find(candidate => {
    const text = candidate.textContent ?? '';
    return (
      text.includes('Renda') &&
      (text.includes('Notas') || text.includes('Social')) &&
      (text.includes('Kyrub') || text.includes('Kyrubia'))
    );
  });

  if (!(nav instanceof HTMLElement)) return null;
  nav.setAttribute(PRIMARY_NAV_ATTRIBUTE, 'true');
  return nav;
};

const findLegacyNotesButton = (): HTMLButtonElement | null => {
  const nav = findPrimaryBottomNav();
  if (!nav) return null;

  const markedButton = nav.querySelector(
    `button[${SOCIAL_ENTRY_ATTRIBUTE}="true"]`
  );
  if (markedButton instanceof HTMLButtonElement) return markedButton;

  return (
    Array.from(nav.querySelectorAll('button')).find(button =>
      (button.textContent ?? '')
        .trim()
        .toLocaleLowerCase('pt-BR')
        .includes('notas')
    ) as HTMLButtonElement | undefined
  ) ?? null;
};

const findProfileTrigger = (): HTMLButtonElement | null => {
  const trigger = document.getElementById('header-user-profile-trigger');
  return trigger instanceof HTMLButtonElement ? trigger : null;
};

const findProfileSquareButton = (): HTMLButtonElement | null => {
  const profileTabs = document.querySelector(
    '#profile-social-hub-modal nav[aria-label="Seções do perfil"]'
  );
  if (!(profileTabs instanceof HTMLElement)) return null;

  return (
    Array.from(profileTabs.querySelectorAll('button')).find(button =>
      (button.textContent ?? '')
        .trim()
        .toLocaleLowerCase('pt-BR')
        .startsWith('praça')
    ) as HTMLButtonElement | undefined
  ) ?? null;
};

const findProfileMarketplaceButton = (): HTMLButtonElement | null => {
  const button = document.querySelector(
    '#profile-social-hub-modal button[aria-label="Abrir Ofertas"]'
  );
  return button instanceof HTMLButtonElement ? button : null;
};

const closeSocialHub = (): void => {
  const closeButton = document.querySelector(
    '#profile-social-hub-modal button[aria-label="Fechar meu perfil"]'
  );
  if (closeButton instanceof HTMLButtonElement) closeButton.click();
};

const normalizeSocialEntry = (
  button: HTMLButtonElement,
  active: boolean
): void => {
  button.setAttribute(SOCIAL_ENTRY_ATTRIBUTE, 'true');
  button.setAttribute('aria-label', 'Social');
  button.setAttribute('title', 'Abrir Social');
  button.setAttribute('aria-pressed', String(active));
  button.setAttribute('data-kyrub-social-active', String(active));

  const label = button.querySelector('span');
  if (label instanceof HTMLElement) {
    if (!label.hasAttribute(ORIGINAL_LABEL_ATTRIBUTE)) {
      label.setAttribute(
        ORIGINAL_LABEL_ATTRIBUTE,
        label.textContent?.trim() || 'Notas'
      );
    }
    if (label.textContent !== 'Social') label.textContent = 'Social';
  }
};

export function WorkspacePrimaryNavigationBridge() {
  const [discoveryHost, setDiscoveryHost] = useState<HTMLElement | null>(null);
  const [notesHost, setNotesHost] = useState<HTMLElement | null>(null);
  const [notesActive, setNotesActive] = useState(false);
  const [socialActive, setSocialActive] = useState(false);
  const allowLegacyNotesClick = useRef(false);
  const pendingSocialDestination = useRef<SocialShortcutDestination | null>(null);

  useEffect(() => {
    let cancelled = false;
    let currentDiscoveryHost: HTMLDivElement | null = null;
    let currentNotesHost: HTMLDivElement | null = null;

    const activatePendingSocialDestination = (): void => {
      const pending = pendingSocialDestination.current;
      if (!pending) return;

      if (!document.getElementById('profile-social-hub-modal')) {
        findProfileTrigger()?.click();
        return;
      }

      const target =
        pending === 'praca'
          ? findProfileSquareButton()
          : findProfileMarketplaceButton();
      if (!target) return;

      pendingSocialDestination.current = null;
      target.click();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const synchronize = (): void => {
      if (cancelled) return;

      const header = document.getElementById('app-header');
      const nav = findPrimaryBottomNav();
      const notesButton = findLegacyNotesButton();
      const socialOpen = Boolean(
        document.getElementById('profile-social-hub-modal')
      );

      setSocialActive(socialOpen);
      if (notesButton) normalizeSocialEntry(notesButton, socialOpen);

      if (header instanceof HTMLElement) {
        document.documentElement.style.setProperty(
          '--kyrub-workspace-header-height',
          `${Math.ceil(header.getBoundingClientRect().bottom)}px`
        );
      }

      if (nav instanceof HTMLElement) {
        nav.style.zIndex = '160';
        document.documentElement.style.setProperty(
          '--kyrub-workspace-nav-height',
          `${Math.ceil(window.innerHeight - nav.getBoundingClientRect().top)}px`
        );
      }

      if (!(header instanceof HTMLElement)) {
        currentDiscoveryHost?.remove();
        currentDiscoveryHost = null;
        currentNotesHost?.remove();
        currentNotesHost = null;
        setDiscoveryHost(null);
        setNotesHost(null);
        return;
      }

      if (!currentDiscoveryHost?.isConnected) {
        currentDiscoveryHost = document.createElement('div');
        currentDiscoveryHost.id = 'workspace-discovery-shortcuts-host';
        currentDiscoveryHost.className = 'flex shrink-0 items-center';
        header.appendChild(currentDiscoveryHost);
        setDiscoveryHost(currentDiscoveryHost);
      }

      if (!currentNotesHost?.isConnected) {
        currentNotesHost = document.createElement('div');
        currentNotesHost.id = 'workspace-notes-shortcut-host';
        currentNotesHost.className = 'flex shrink-0 items-center';
        header.appendChild(currentNotesHost);
        setNotesHost(currentNotesHost);
      }

      const notificationHost = document.getElementById(
        'user-notification-center-host'
      );
      if (notificationHost instanceof HTMLElement) {
        notificationHost.style.marginLeft = '0';
        notificationHost.style.paddingLeft = '0';
      }

      activatePendingSocialDestination();
    };

    const handleDocumentClick = (event: MouseEvent): void => {
      const target = event.target as Element | null;
      if (!target) return;

      const socialEntry = target.closest(
        `button[${SOCIAL_ENTRY_ATTRIBUTE}="true"]`
      );
      if (socialEntry instanceof HTMLButtonElement) {
        if (allowLegacyNotesClick.current) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setNotesActive(false);
        setSocialActive(true);
        normalizeSocialEntry(socialEntry, true);

        if (!document.getElementById('profile-social-hub-modal')) {
          findProfileTrigger()?.click();
        }
        return;
      }

      const nav = findPrimaryBottomNav();
      const navButton = target.closest('button');
      if (
        nav &&
        navButton instanceof HTMLButtonElement &&
        navButton.closest('nav') === nav
      ) {
        pendingSocialDestination.current = null;
        closeSocialHub();
        setSocialActive(false);
        const socialButton = findLegacyNotesButton();
        if (socialButton) normalizeSocialEntry(socialButton, false);
        setNotesActive(false);
      }
    };

    synchronize();
    window.addEventListener('resize', synchronize);
    document.addEventListener('click', handleDocumentClick, true);

    const observer = new MutationObserver(synchronize);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelled = true;
      observer.disconnect();
      window.removeEventListener('resize', synchronize);
      document.removeEventListener('click', handleDocumentClick, true);

      const socialButton = findLegacyNotesButton();
      if (socialButton) {
        const label = socialButton.querySelector('span');
        if (label instanceof HTMLElement) {
          label.textContent =
            label.getAttribute(ORIGINAL_LABEL_ATTRIBUTE) || 'Notas';
          label.removeAttribute(ORIGINAL_LABEL_ATTRIBUTE);
        }
        socialButton.removeAttribute(SOCIAL_ENTRY_ATTRIBUTE);
        socialButton.removeAttribute('data-kyrub-social-active');
      }

      findPrimaryBottomNav()?.removeAttribute(PRIMARY_NAV_ATTRIBUTE);
      currentDiscoveryHost?.remove();
      currentNotesHost?.remove();
      document.documentElement.style.removeProperty(
        '--kyrub-workspace-header-height'
      );
      document.documentElement.style.removeProperty(
        '--kyrub-workspace-nav-height'
      );
      setDiscoveryHost(null);
      setNotesHost(null);
    };
  }, []);

  const openNotes = (): void => {
    const notesButton = findLegacyNotesButton();
    if (!notesButton) return;

    pendingSocialDestination.current = null;
    closeSocialHub();
    setSocialActive(false);
    normalizeSocialEntry(notesButton, false);

    allowLegacyNotesClick.current = true;
    try {
      notesButton.click();
      setNotesActive(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      allowLegacyNotesClick.current = false;
    }
  };

  const openSocialDestination = (
    destination: SocialShortcutDestination
  ): void => {
    setNotesActive(false);
    setSocialActive(true);

    const socialButton = findLegacyNotesButton();
    if (socialButton) normalizeSocialEntry(socialButton, true);

    pendingSocialDestination.current = destination;

    if (!document.getElementById('profile-social-hub-modal')) {
      findProfileTrigger()?.click();
      return;
    }

    const target =
      destination === 'praca'
        ? findProfileSquareButton()
        : findProfileMarketplaceButton();
    if (!target) return;

    pendingSocialDestination.current = null;
    target.click();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const compactShortcutClassName =
    'kyrub-header-shortcut flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-slate-400 transition-colors hover:border-orange-500/40 hover:text-orange-300';

  return (
    <>
      {discoveryHost &&
        createPortal(
          <div className="flex items-center gap-2 kyrub-header-discovery-group">
            <button
              type="button"
              onClick={() => openSocialDestination('praca')}
              className={compactShortcutClassName}
              title="Praça"
              aria-label="Abrir Praça"
              id="header-praca-trigger"
            >
              <Compass className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => openSocialDestination('marketplace')}
              className={compactShortcutClassName}
              title="Marketplace"
              aria-label="Abrir Marketplace"
              id="header-marketplace-trigger"
            >
              <StoreIcon className="h-4 w-4" />
            </button>
          </div>,
          discoveryHost
        )}

      {notesHost &&
        createPortal(
          <button
            type="button"
            onClick={openNotes}
            className={`kyrub-header-shortcut flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-slate-900 transition-colors ${
              notesActive
                ? 'border-orange-500/50 text-orange-400'
                : 'border-slate-800 text-slate-400 hover:border-orange-500/40 hover:text-orange-300'
            }`}
            title="Notas"
            aria-label="Abrir Notas"
            aria-pressed={notesActive}
            id="header-notes-trigger"
          >
            <CheckSquare className="h-4 w-4" />
          </button>,
          notesHost
        )}

      <style>{`
        #app-header {
          justify-content: flex-start !important;
          gap: 0.5rem;
          z-index: 160 !important;
        }

        #app-header #header-user-profile-trigger {
          display: none !important;
        }

        #app-header > div:has(#header-wallet-balance) {
          display: contents !important;
        }

        #app-header button[title="Sair"] {
          order: 0;
          width: 2.5rem;
          height: 2.5rem;
          flex: 0 0 2.5rem;
          margin-right: auto;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 !important;
        }

        #app-header button[title="Sair"] > svg {
          transform: scaleX(-1);
        }

        #workspace-discovery-shortcuts-host {
          order: 1;
        }

        #header-wallet-balance {
          order: 2;
          width: 2.5rem;
          height: 2.5rem;
          flex: 0 0 2.5rem;
          justify-content: center;
          padding: 0 !important;
        }

        #header-wallet-balance > button:first-child {
          width: 100%;
          height: 100%;
          justify-content: center;
          padding: 0 !important;
        }

        #header-wallet-balance > button:first-child > span,
        #toggle-balance-visibility-btn {
          display: none !important;
        }

        #workspace-notes-shortcut-host {
          order: 3;
        }

        #user-notification-center-host {
          order: 4;
          margin-left: 0 !important;
          padding-left: 0 !important;
        }

        nav[${PRIMARY_NAV_ATTRIBUTE}="true"] {
          position: fixed !important;
          z-index: 160 !important;
        }

        button[${SOCIAL_ENTRY_ATTRIBUTE}="true"] {
          color: rgb(100 116 139) !important;
        }

        button[${SOCIAL_ENTRY_ATTRIBUTE}="true"][data-kyrub-social-active="true"] {
          color: rgb(249 115 22) !important;
        }

        button[${SOCIAL_ENTRY_ATTRIBUTE}="true"] > svg {
          display: none !important;
        }

        button[${SOCIAL_ENTRY_ATTRIBUTE}="true"]::before {
          content: '';
          width: 1.25rem;
          height: 1.25rem;
          background-color: currentColor;
          -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='none' stroke='black' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m13 10v-2a4 4 0 0 0-3-3.87m-1-11.26a4 4 0 0 1 0 7.75'/%3E%3C/svg%3E") center / contain no-repeat;
          mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='none' stroke='black' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m13 10v-2a4 4 0 0 0-3-3.87m-1-11.26a4 4 0 0 1 0 7.75'/%3E%3C/svg%3E") center / contain no-repeat;
        }

        button[${SOCIAL_ENTRY_ATTRIBUTE}="true"] > span {
          font-size: 10px !important;
        }

        #profile-social-hub-modal {
          position: fixed !important;
          top: var(--kyrub-workspace-header-height, 64px) !important;
          right: 0 !important;
          bottom: var(--kyrub-workspace-nav-height, 72px) !important;
          left: 0 !important;
          width: 100% !important;
          height: auto !important;
          min-height: 0 !important;
          padding: 0 !important;
          align-items: stretch !important;
          justify-content: center !important;
          background: rgb(2 6 23) !important;
          backdrop-filter: none !important;
          z-index: 120 !important;
        }

        #profile-social-hub-modal > section {
          width: 100% !important;
          max-width: 48rem !important;
          height: 100% !important;
          max-height: none !important;
          border-radius: 0 !important;
          border-top: 0 !important;
          border-bottom: 0 !important;
          box-shadow: none !important;
        }

        #profile-social-hub-modal > section > header:first-child,
        #profile-social-hub-modal button[aria-label="Fechar meu perfil"],
        #profile-social-hub-modal button[aria-label="Abrir Ofertas"],
        #profile-social-hub-modal button[aria-label="Abrir Praça"],
        #profile-social-hub-modal button[title="Praça"] {
          display: none !important;
        }

        @media (max-width: 390px) {
          #app-header {
            gap: 0.25rem !important;
            padding-left: 0.5rem !important;
            padding-right: 0.5rem !important;
          }

          #app-header button[title="Sair"],
          #header-wallet-balance,
          .kyrub-header-shortcut,
          #canonical-notification-trigger {
            width: 2.25rem !important;
            height: 2.25rem !important;
            flex-basis: 2.25rem !important;
          }

          .kyrub-header-discovery-group {
            gap: 0.25rem !important;
          }
        }
      `}</style>
    </>
  );
}