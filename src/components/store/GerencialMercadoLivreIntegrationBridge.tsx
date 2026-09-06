import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../../utils/firebase';
import MercadoLivreE2ETestBridge from './MercadoLivreE2ETestBridge';
import StoreConnectionsWorkspace from './StoreConnectionsWorkspace';

type HiddenElementState = {
  element: HTMLElement;
  display: string;
  ariaHidden: string | null;
};

type Notice = {
  message: string;
  type: 'success' | 'error' | 'info';
};

const normalizeText = (value: string | null | undefined): string =>
  value?.trim().toLocaleUpperCase('pt-BR') ?? '';

const findExternalChannelsCard = (): HTMLElement | null => {
  const managementContainer = document.getElementById('erp-gerencial-tab');
  if (!(managementContainer instanceof HTMLElement)) return null;

  const heading = Array.from(managementContainer.querySelectorAll('h4')).find(
    candidate =>
      normalizeText(candidate.textContent) === 'CONFIGURAÇÃO DE CANAIS EXTERNOS'
  );

  return heading?.parentElement instanceof HTMLElement
    ? heading.parentElement
    : null;
};

const findChannelList = (card: HTMLElement): HTMLElement | null =>
  Array.from(card.children).find(
    child =>
      child instanceof HTMLElement &&
      child.classList.contains('space-y-2')
  ) as HTMLElement | null;

const findMercadoLivreLegacyRow = (
  channelList: HTMLElement
): HTMLElement | null =>
  Array.from(channelList.children).find(
    child =>
      child instanceof HTMLElement &&
      normalizeText(child.textContent).includes('MERCADO LIVRE')
  ) as HTMLElement | null;

export function GerencialMercadoLivreIntegrationBridge() {
  const [user, setUser] = useState<User | null>(() => auth.currentUser);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const hiddenLegacyRowRef = useRef<HiddenElementState | null>(null);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    const restoreLegacyRow = (): void => {
      const hidden = hiddenLegacyRowRef.current;
      if (!hidden) return;

      if (hidden.element.isConnected) {
        hidden.element.style.display = hidden.display;
        if (hidden.ariaHidden === null) {
          hidden.element.removeAttribute('aria-hidden');
        } else {
          hidden.element.setAttribute('aria-hidden', hidden.ariaHidden);
        }
      }
      hiddenLegacyRowRef.current = null;
    };

    const teardown = (): void => {
      hostRef.current?.remove();
      hostRef.current = null;
      setHost(null);
      restoreLegacyRow();
    };

    const hideLegacyRow = (row: HTMLElement): void => {
      if (hiddenLegacyRowRef.current?.element === row) {
        row.style.display = 'none';
        row.setAttribute('aria-hidden', 'true');
        return;
      }

      restoreLegacyRow();
      hiddenLegacyRowRef.current = {
        element: row,
        display: row.style.display,
        ariaHidden: row.getAttribute('aria-hidden'),
      };
      row.style.display = 'none';
      row.setAttribute('aria-hidden', 'true');
    };

    const synchronize = (): void => {
      const card = findExternalChannelsCard();
      const channelList = card ? findChannelList(card) : null;
      const mercadoLivreRow = channelList
        ? findMercadoLivreLegacyRow(channelList)
        : null;

      if (!card || !channelList || !mercadoLivreRow) {
        if (hostRef.current || hiddenLegacyRowRef.current) teardown();
        return;
      }

      hideLegacyRow(mercadoLivreRow);

      if (!hostRef.current?.isConnected) {
        const nextHost = document.createElement('div');
        nextHost.id = 'kyrub-gerencial-mercado-livre-integration-host';
        nextHost.className = 'min-w-0';
        card.insertBefore(nextHost, channelList);
        hostRef.current = nextHost;
        setHost(nextHost);
      }
    };

    synchronize();
    const observer = new MutationObserver(synchronize);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      teardown();
    };
  }, []);

  if (!host || !user) return null;

  const notify = (
    message: string,
    type: 'success' | 'error' | 'info' = 'info'
  ): void => {
    setNotice({ message, type });
  };

  return createPortal(
    <div className="space-y-3" id="kyrub-gerencial-mercado-livre-integration">
      {notice && (
        <div
          className={`rounded-2xl border px-4 py-3 text-[10px] leading-relaxed ${
            notice.type === 'success'
              ? 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-100'
              : notice.type === 'error'
                ? 'border-red-500/25 bg-red-500/[0.06] text-red-100'
                : 'border-cyan-500/25 bg-cyan-500/[0.06] text-cyan-100'
          }`}
          role="status"
        >
          {notice.message}
        </div>
      )}
      <StoreConnectionsWorkspace
        user={user}
        storeId={user.uid}
        notify={notify}
      />
      <MercadoLivreE2ETestBridge
        user={user}
        storeId={user.uid}
        notify={notify}
      />
    </div>,
    host
  );
}
