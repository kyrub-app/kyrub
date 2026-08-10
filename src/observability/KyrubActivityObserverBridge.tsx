import { useEffect, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import type {
  KyrubActivityEventDomain,
  KyrubActivityEventInput,
} from '../../shared/kyrubActivityEvents';
import { auth } from '../utils/firebase';
import { recordCurrentUserActivityEvent } from './kyrubActivityBrowser';

const DUPLICATE_WINDOW_MS = 1_200;

const compactLabel = (button: HTMLButtonElement): string =>
  (button.textContent ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');

const mainTabScreen = (label: string): string => {
  if (label === 'notas') return 'home:perfil';
  if (label === 'renda') return 'home:renda';
  if (label === 'kyrub') return 'home:kyrub';
  return '';
};

const erpScreen = (label: string): string => {
  if (label === 'loja') return 'store:settings';
  if (label === 'clientes' || label === 'pdv') return 'erp:clientes';
  if (label === 'caixa') return 'erp:caixa';
  if (label === 'pedidos' || label === 'kds/vendas') return 'erp:pedidos';
  if (label === 'reservas') return 'erp:reservas';
  if (label === 'ponto') return 'erp:ponto';
  if (label === 'gerencial') return 'erp:gerencial';
  return '';
};

const eventForScreen = (
  screenId: string,
  domain: KyrubActivityEventDomain
): KyrubActivityEventInput => ({
  type: 'navigation.screen_viewed',
  domain,
  source: 'client_observation',
  screenId,
});

export function KyrubActivityObserverBridge() {
  const recentRef = useRef(new Map<string, number>());
  const authenticatedRef = useRef(Boolean(auth.currentUser));

  useEffect(() =>
    onAuthStateChanged(auth, user => {
      authenticatedRef.current = Boolean(user);
      if (!user) recentRef.current.clear();
    }), []);

  useEffect(() => {
    const emit = (input: KyrubActivityEventInput) => {
      if (!authenticatedRef.current) return;
      const signature = [
        input.type,
        input.domain,
        input.screenId ?? '',
        input.actionId ?? '',
        input.entityType ?? '',
        input.entityId ?? '',
      ].join('|');
      const now = Date.now();
      const last = recentRef.current.get(signature) ?? 0;
      if (now - last < DUPLICATE_WINDOW_MS) return;
      recentRef.current.set(signature, now);
      recordCurrentUserActivityEvent(input);
    };

    const inspectKnownScreens = () => {
      if (!authenticatedRef.current) return;

      const pathname = window.location.pathname;
      if (pathname === '/staff' || pathname.endsWith('/staff')) {
        emit(eventForScreen('staff', 'app'));
      }

      if (
        document.querySelector(
          '#profile-social-hub-modal [data-kyrub-cloud-communities]'
        )
      ) {
        emit(eventForScreen('communities:directory', 'community'));
      }

      if (document.querySelector('#erp-main-header')) {
        emit(eventForScreen('erp:panel', 'store'));
      }
    };

    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest('button');
      if (!(button instanceof HTMLButtonElement)) return;

      if (button.id === 'header-user-profile-trigger') {
        emit(eventForScreen('profile:settings', 'app'));
        return;
      }

      if (button.id === 'orange-house-config-btn') {
        emit(eventForScreen('store:settings', 'store'));
        return;
      }

      const label = compactLabel(button);
      const mainNav = button.closest('nav');
      if (
        mainNav &&
        mainNav.classList.contains('fixed') &&
        mainNav.classList.contains('bottom-0')
      ) {
        const screenId = mainTabScreen(label);
        if (screenId) {
          emit(eventForScreen(screenId, 'app'));
          return;
        }
      }

      if (
        button.closest('#erp-tab-navigation-header') ||
        button.closest('#mobile-erp-navigation-drawer')
      ) {
        const screenId = erpScreen(label);
        if (screenId) {
          emit(eventForScreen(screenId, 'store'));
        }
      }
    };

    document.addEventListener('click', handleClick, true);
    const observer = new MutationObserver(inspectKnownScreens);
    observer.observe(document.body, { childList: true, subtree: true });
    const handlePopState = () => inspectKnownScreens();
    window.addEventListener('popstate', handlePopState);
    inspectKnownScreens();

    return () => {
      document.removeEventListener('click', handleClick, true);
      window.removeEventListener('popstate', handlePopState);
      observer.disconnect();
    };
  }, []);

  return null;
}
