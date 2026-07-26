import { useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../utils/firebase';
import { STORE_RESTART_SESSION_KEY } from '../../utils/storeReset';

const findRendaNavigationButton = (): HTMLButtonElement | null => {
  const navigation = document.querySelector('nav.fixed.bottom-0');
  if (!navigation) return null;

  return (
    Array.from(navigation.querySelectorAll<HTMLButtonElement>('button')).find(
      button => button.textContent?.trim().toLocaleLowerCase('pt-BR') === 'renda'
    ) ?? null
  );
};

export function StoreRestartLandingBridge() {
  useEffect(() => {
    if (sessionStorage.getItem(STORE_RESTART_SESSION_KEY) !== '1') return;

    let observer: MutationObserver | null = null;
    let retryTimer = 0;

    const showCreateStoreCard = (): void => {
      const createStoreCard = document.getElementById('user-store-card');
      if (createStoreCard) {
        sessionStorage.removeItem(STORE_RESTART_SESSION_KEY);
        createStoreCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        observer?.disconnect();
        window.clearTimeout(retryTimer);
        return;
      }

      const rendaButton = findRendaNavigationButton();
      if (rendaButton) rendaButton.click();
      retryTimer = window.setTimeout(showCreateStoreCard, 120);
    };

    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      if (!user) return;
      observer?.disconnect();
      observer = new MutationObserver(showCreateStoreCard);
      observer.observe(document.body, { childList: true, subtree: true });
      window.setTimeout(showCreateStoreCard, 0);
    });

    return () => {
      unsubscribeAuth();
      observer?.disconnect();
      window.clearTimeout(retryTimer);
    };
  }, []);

  return null;
}
