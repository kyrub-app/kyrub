import { useEffect } from 'react';

// This bridge owns only the *bottom* navigation and Praça workspace overlay.
// It must not create, move, style, or intercept any app-header control.
const SOCIAL_ENTRY_ATTRIBUTE = 'data-kyrub-social-entry';
const PRIMARY_NAV_ATTRIBUTE = 'data-kyrub-primary-workspace-nav';
const ORIGINAL_LABEL_ATTRIBUTE = 'data-kyrub-original-label';

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


const closeSocialHub = (): void => {
  window.dispatchEvent(new Event('kyrub-personal-page-close-requested'));
};

const activateProfileSquare = (attempt = 0): void => {
  const hub = document.getElementById('profile-social-hub-modal');
  const navigation = hub?.querySelector('nav[aria-label="Seções do perfil"]');
  const squareButton = navigation
    ? Array.from(navigation.querySelectorAll('button')).find(button =>
        (button.textContent ?? '')
          .trim()
          .toLocaleLowerCase('pt-BR')
          .includes('praça')
      )
    : null;

  if (squareButton instanceof HTMLButtonElement) {
    squareButton.click();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  if (attempt >= 24) return;
  window.requestAnimationFrame(() => activateProfileSquare(attempt + 1));
};

const normalizeSocialEntry = (
  button: HTMLButtonElement,
  active: boolean
): void => {
  button.setAttribute(SOCIAL_ENTRY_ATTRIBUTE, 'true');
  button.setAttribute('aria-label', 'Praça');
  button.setAttribute('title', 'Abrir Praça');
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
    if (label.textContent !== 'Praça') label.textContent = 'Praça';
  }
};


export function WorkspacePrimaryNavigationBridge() {
  useEffect(() => {
    let cancelled = false;

    const synchronize = (): void => {
      if (cancelled) return;
      const header = document.getElementById('app-header');
      const nav = findPrimaryBottomNav();
      const socialOpen = Boolean(document.getElementById('profile-social-hub-modal'));
      const socialButton = findLegacyNotesButton();

      if (socialButton) normalizeSocialEntry(socialButton, socialOpen);

      if (header instanceof HTMLElement) {
        document.documentElement.style.setProperty(
          '--kyrub-workspace-header-height',
          `${Math.ceil(header.getBoundingClientRect().bottom)}px`
        );
      }
      if (nav instanceof HTMLElement) {
        document.documentElement.style.setProperty(
          '--kyrub-workspace-nav-height',
          `${Math.ceil(window.innerHeight - nav.getBoundingClientRect().top)}px`
        );
      }
    };

    const handleBottomNavigationClick = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const nav = findPrimaryBottomNav();
      const button = target.closest('button');
      if (
        !(nav instanceof HTMLElement) ||
        !(button instanceof HTMLButtonElement) ||
        button.closest('nav') !== nav
      ) return;

      const squareEntry = findLegacyNotesButton();
      if (button === squareEntry) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        window.dispatchEvent(new Event('kyrub-personal-page-open-requested'));
        window.requestAnimationFrame(() => activateProfileSquare());
        return;
      }

      closeSocialHub();
      if (squareEntry) normalizeSocialEntry(squareEntry, false);
    };

    synchronize();
    window.addEventListener('resize', synchronize);
    document.addEventListener('click', handleBottomNavigationClick, true);
    const observer = new MutationObserver(synchronize);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelled = true;
      observer.disconnect();
      window.removeEventListener('resize', synchronize);
      document.removeEventListener('click', handleBottomNavigationClick, true);
      const squareEntry = findLegacyNotesButton();
      if (squareEntry) {
        const label = squareEntry.querySelector('span');
        if (label instanceof HTMLElement) {
          label.textContent = label.getAttribute(ORIGINAL_LABEL_ATTRIBUTE) || 'Notas';
          label.removeAttribute(ORIGINAL_LABEL_ATTRIBUTE);
        }
        squareEntry.removeAttribute(SOCIAL_ENTRY_ATTRIBUTE);
        squareEntry.removeAttribute('data-kyrub-social-active');
        squareEntry.removeAttribute('aria-pressed');
      }
      findPrimaryBottomNav()?.removeAttribute(PRIMARY_NAV_ATTRIBUTE);
      document.documentElement.style.removeProperty('--kyrub-workspace-header-height');
      document.documentElement.style.removeProperty('--kyrub-workspace-nav-height');
    };
  }, []);

  return null;
}
