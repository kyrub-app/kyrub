import { useEffect } from 'react';

const PROFILE_NAVIGATION_SELECTOR = 'nav[aria-label="Seções do perfil"]';
const MARKED_TAB_SELECTOR = '[data-kyrub-marked-tab]';
const MARKED_CONTENT_SELECTOR = '[data-kyrub-marked-content-host]';

const findClickedButton = (event: Event): HTMLButtonElement | null =>
  event
    .composedPath()
    .find((target): target is HTMLButtonElement =>
      target instanceof HTMLButtonElement
    ) ?? null;

const findOriginalContent = (
  navigation: HTMLElement
): HTMLElement | null => {
  let candidate = navigation.nextElementSibling;
  if (
    candidate instanceof HTMLElement &&
    candidate.matches(MARKED_CONTENT_SELECTOR)
  ) {
    candidate = candidate.nextElementSibling;
  }
  return candidate instanceof HTMLElement ? candidate : null;
};

const markButtonAsInactive = (navigation: HTMLElement) => {
  const markedButton = navigation.querySelector<HTMLButtonElement>(
    MARKED_TAB_SELECTOR
  );
  if (!markedButton) return;

  if (markedButton.getAttribute('aria-pressed') !== 'false') {
    markedButton.setAttribute('aria-pressed', 'false');
  }

  const activeClasses = ['bg-orange-500', 'text-slate-950'];
  const inactiveClasses = [
    'border',
    'border-slate-800',
    'bg-slate-900',
    'text-slate-400',
  ];

  for (const className of activeClasses) {
    if (markedButton.classList.contains(className)) {
      markedButton.classList.remove(className);
    }
  }
  for (const className of inactiveClasses) {
    if (!markedButton.classList.contains(className)) {
      markedButton.classList.add(className);
    }
  }
};

const restoreNativeProfileContent = (navigation: HTMLElement) => {
  const parent = navigation.parentElement;
  if (!parent) return;

  const markedContent = parent.querySelector<HTMLElement>(
    `:scope > ${MARKED_CONTENT_SELECTOR}`
  );
  if (markedContent && markedContent.style.display !== 'none') {
    markedContent.style.display = 'none';
  }

  const originalContent = findOriginalContent(navigation);
  if (originalContent?.style.display) {
    originalContent.style.removeProperty('display');
  }

  markButtonAsInactive(navigation);
};

export function ProfileMarkedNavigationRecoveryBridge() {
  useEffect(() => {
    let markedModeActive = false;
    let animationFrame = 0;

    const recoverAfterNativeTabClick = (navigation: HTMLElement) => {
      restoreNativeProfileContent(navigation);
      queueMicrotask(() => {
        if (!markedModeActive) restoreNativeProfileContent(navigation);
      });
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        if (!markedModeActive) restoreNativeProfileContent(navigation);
      });
    };

    const handleNavigationClick = (event: Event) => {
      const button = findClickedButton(event);
      const navigation = button?.closest<HTMLElement>(
        PROFILE_NAVIGATION_SELECTOR
      );
      if (!button || !navigation) return;

      if (button.matches(MARKED_TAB_SELECTOR)) {
        markedModeActive = true;
        return;
      }

      markedModeActive = false;
      recoverAfterNativeTabClick(navigation);
    };

    const observer = new MutationObserver(() => {
      if (markedModeActive) return;
      const navigation = document.querySelector<HTMLElement>(
        `#profile-social-hub-modal ${PROFILE_NAVIGATION_SELECTOR}`
      );
      if (navigation) restoreNativeProfileContent(navigation);
    });

    document.addEventListener('click', handleNavigationClick, true);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-pressed'],
    });

    return () => {
      document.removeEventListener('click', handleNavigationClick, true);
      observer.disconnect();
      window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  return null;
}
