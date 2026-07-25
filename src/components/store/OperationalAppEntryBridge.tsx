import { useEffect, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../../utils/firebase';

const findRendaNavigationButton = (): HTMLButtonElement | null => {
  const navigation = document.querySelector('nav.fixed.bottom-0');
  if (!navigation) return null;

  return (
    Array.from(navigation.querySelectorAll<HTMLButtonElement>('button')).find(
      button => button.textContent?.trim().toLocaleLowerCase('pt-BR') === 'renda'
    ) ?? null
  );
};

export function OperationalAppEntryBridge() {
  const openedRef = useRef(false);

  useEffect(() => {
    let observer: MutationObserver | null = null;
    let retryTimer = 0;

    const openOperationalWorkspace = (): void => {
      if (openedRef.current || !auth.currentUser) return;

      const retailerButton = document.getElementById(
        'btn-criar-loja-ofertas'
      ) as HTMLButtonElement | null;

      if (retailerButton && !retailerButton.disabled) {
        openedRef.current = true;
        retailerButton.click();
        observer?.disconnect();
        window.clearTimeout(retryTimer);
        return;
      }

      const rendaButton = findRendaNavigationButton();
      if (rendaButton) rendaButton.click();
      retryTimer = window.setTimeout(openOperationalWorkspace, 120);
    };

    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      if (!user || openedRef.current) return;
      observer?.disconnect();
      observer = new MutationObserver(openOperationalWorkspace);
      observer.observe(document.body, { childList: true, subtree: true });
      window.setTimeout(openOperationalWorkspace, 0);
    });

    return () => {
      unsubscribeAuth();
      observer?.disconnect();
      window.clearTimeout(retryTimer);
    };
  }, []);

  return null;
}
