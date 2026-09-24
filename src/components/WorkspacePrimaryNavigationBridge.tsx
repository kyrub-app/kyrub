import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckSquare } from 'lucide-react';

const SOCIAL_ENTRY_ATTRIBUTE = 'data-kyrub-social-entry';

const findPrimaryBottomNav = (): HTMLElement | null => {
  const navs = Array.from(document.querySelectorAll('nav'));
  return (
    navs.find(nav => {
      const text = nav.textContent ?? '';
      return text.includes('Notas') && text.includes('Renda');
    }) as HTMLElement | undefined
  ) ?? null;
};

const findLegacyNotesButton = (): HTMLButtonElement | null => {
  const nav = findPrimaryBottomNav();
  if (!nav) return null;
  return (
    Array.from(nav.querySelectorAll('button')).find(button =>
      (button.textContent ?? '').trim().toLocaleLowerCase('pt-BR').includes('notas')
    ) as HTMLButtonElement | undefined
  ) ?? null;
};

const findProfileTrigger = (): HTMLButtonElement | null => {
  const trigger = document.getElementById('header-user-profile-trigger');
  return trigger instanceof HTMLButtonElement ? trigger : null;
};

export function WorkspacePrimaryNavigationBridge() {
  const [notesHost, setNotesHost] = useState<HTMLElement | null>(null);
  const [notesActive, setNotesActive] = useState(false);
  const allowLegacyNotesClick = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let currentHost: HTMLDivElement | null = null;

    const synchronize = (): void => {
      if (cancelled) return;

      const header = document.getElementById('app-header');
      const notesButton = findLegacyNotesButton();

      if (notesButton) {
        notesButton.setAttribute(SOCIAL_ENTRY_ATTRIBUTE, 'true');
        notesButton.setAttribute('aria-label', 'Social');
        notesButton.setAttribute('title', 'Abrir Social');
        setNotesActive(notesButton.className.includes('text-orange-500'));
      }

      if (!(header instanceof HTMLElement)) {
        currentHost?.remove();
        currentHost = null;
        setNotesHost(null);
        return;
      }

      if (!currentHost?.isConnected) {
        currentHost = document.createElement('div');
        currentHost.id = 'workspace-notes-shortcut-host';
        currentHost.className = 'flex shrink-0 items-center';

        const wallet = document.getElementById('header-wallet-balance');
        const actionRow = wallet?.parentElement;
        if (actionRow?.parentElement === header) {
          header.insertBefore(currentHost, actionRow);
        } else {
          header.appendChild(currentHost);
        }
        setNotesHost(currentHost);
      }

      const notificationHost = document.getElementById(
        'user-notification-center-host'
      );
      if (notificationHost instanceof HTMLElement) {
        notificationHost.style.marginLeft = '0';
        notificationHost.style.paddingLeft = '0';
      }
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

        // The native social hub already owns the canonical profile trigger.
        // Reuse that authority instead of duplicating profile/social state.
        findProfileTrigger()?.click();
        return;
      }

      const nav = findPrimaryBottomNav();
      if (nav && target.closest('button')?.closest('nav') === nav) {
        setNotesActive(false);
      }
    };

    synchronize();
    document.addEventListener('click', handleDocumentClick, true);

    const observer = new MutationObserver(synchronize);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelled = true;
      observer.disconnect();
      document.removeEventListener('click', handleDocumentClick, true);
      findLegacyNotesButton()?.removeAttribute(SOCIAL_ENTRY_ATTRIBUTE);
      currentHost?.remove();
      setNotesHost(null);
    };
  }, []);

  const openNotes = (): void => {
    const notesButton = findLegacyNotesButton();
    if (!notesButton) return;

    allowLegacyNotesClick.current = true;
    try {
      notesButton.click();
      setNotesActive(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      allowLegacyNotesClick.current = false;
    }
  };

  return (
    <>
      {notesHost &&
        createPortal(
          <button
            type="button"
            onClick={openNotes}
            className={`flex h-10 w-10 items-center justify-center rounded-xl border bg-slate-900 transition-colors ${
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
          justify-content: flex-end !important;
          gap: 0.5rem;
        }

        #app-header #header-user-profile-trigger {
          display: none !important;
        }

        #workspace-notes-shortcut-host {
          order: 1;
        }

        #app-header > div:has(#header-wallet-balance) {
          order: 2;
        }

        #user-notification-center-host {
          order: 3;
          margin-left: 0 !important;
          padding-left: 0 !important;
        }

        button[${SOCIAL_ENTRY_ATTRIBUTE}="true"] {
          color: rgb(100 116 139) !important;
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
          font-size: 0 !important;
        }

        button[${SOCIAL_ENTRY_ATTRIBUTE}="true"] > span::after {
          content: 'Social';
          font-size: 10px;
        }
      `}</style>
    </>
  );
}
