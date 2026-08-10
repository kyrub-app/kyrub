import { useEffect, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import type {
  KyrubActivityEventDomain,
  KyrubActivityEventInput,
} from '../../shared/kyrubActivityEvents';
import { auth } from '../utils/firebase';
import { recordCurrentUserActivityEvent } from './kyrubActivityBrowser';
import {
  enteredSemanticScreens,
  forgetSemanticSelection,
  rememberSemanticSelection,
} from './kyrubActivityTransitions';

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

const domainForPresenceScreen = (screenId: string): KyrubActivityEventDomain => {
  if (screenId === 'communities:directory') return 'community';
  if (screenId === 'erp:panel') return 'store';
  return 'app';
};

export function KyrubActivityObserverBridge() {
  const authenticatedRef = useRef(Boolean(auth.currentUser));
  const presenceRef = useRef(new Set<string>());
  const selectionRef = useRef(new Map<string, string>());

  useEffect(() =>
    onAuthStateChanged(auth, user => {
      authenticatedRef.current = Boolean(user);
      if (!user) {
        presenceRef.current.clear();
        selectionRef.current.clear();
      }
    }), []);

  useEffect(() => {
    const emit = (input: KyrubActivityEventInput) => {
      if (!authenticatedRef.current) return;
      recordCurrentUserActivityEvent(input);
    };

    const emitSelection = (
      scope: string,
      screenId: string,
      domain: KyrubActivityEventDomain
    ) => {
      if (!rememberSemanticSelection(selectionRef.current, scope, screenId)) return;
      emit(eventForScreen(screenId, domain));
    };

    const inspectKnownScreens = () => {
      if (!authenticatedRef.current) return;

      const currentPresence = new Set<string>();
      const pathname = window.location.pathname;
      if (pathname === '/staff' || pathname.endsWith('/staff')) {
        currentPresence.add('staff');
      }

      if (
        document.querySelector(
          '#profile-social-hub-modal [data-kyrub-cloud-communities]'
        )
      ) {
        currentPresence.add('communities:directory');
      }

      if (document.querySelector('#erp-main-header')) {
        currentPresence.add('erp:panel');
      }

      for (const screenId of enteredSemanticScreens(
        presenceRef.current,
        currentPresence
      )) {
        emit(eventForScreen(screenId, domainForPresenceScreen(screenId)));
      }

      if (!currentPresence.has('erp:panel')) {
        forgetSemanticSelection(selectionRef.current, 'erp-tab');
      }
      if (!currentPresence.has('communities:directory')) {
        forgetSemanticSelection(selectionRef.current, 'community-area');
      }

      presenceRef.current = currentPresence;
    };

    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest('button');
      if (!(button instanceof HTMLButtonElement)) return;

      if (button.id === 'header-user-profile-trigger') {
        emitSelection('profile-modal', 'profile:settings', 'app');
        return;
      }

      if (button.id === 'orange-house-config-btn') {
        emitSelection('store-settings', 'store:settings', 'store');
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
          emitSelection('main-tab', screenId, 'app');
          return;
        }
      }

      if (
        button.closest('#erp-tab-navigation-header') ||
        button.closest('#mobile-erp-navigation-drawer')
      ) {
        const screenId = erpScreen(label);
        if (screenId) {
          emitSelection('erp-tab', screenId, 'store');
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
