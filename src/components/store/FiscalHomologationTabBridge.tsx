import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../../utils/firebase';
import FiscalPreflightWorkspace from './FiscalPreflightWorkspace';

const HUB_ID = 'accounting-fiscal-integrations-hub';
const TAB_ID = 'accounting-fiscal-tab-homologation';
const HOST_ID = 'accounting-fiscal-homologation-bridge-host';
const PANEL_ID = 'accounting-fiscal-homologation';

const ACTIVE_TAB_CLASSES = [
  'border-violet-400/40',
  'bg-violet-500/15',
  'text-violet-100',
];
const INACTIVE_TAB_CLASSES = [
  'border-slate-800',
  'bg-slate-950/50',
  'text-slate-500',
  'hover:text-slate-300',
];

const setNativeTabVisualState = (tab: HTMLElement, active: boolean): void => {
  const remove = active ? INACTIVE_TAB_CLASSES : ACTIVE_TAB_CLASSES;
  const add = active ? ACTIVE_TAB_CLASSES : INACTIVE_TAB_CLASSES;
  tab.classList.remove(...remove);
  tab.classList.add(...add);
  tab.setAttribute('aria-selected', active ? 'true' : 'false');
};

export function FiscalHomologationTabBridge() {
  const [user, setUser] = useState<User | null>(() => auth.currentUser);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  const activateHomologation = useCallback((): void => {
    const hub = document.getElementById(HUB_ID);
    if (!hub) return;

    hub.querySelectorAll<HTMLElement>('[role="tab"]').forEach(tab => {
      setNativeTabVisualState(tab, tab.id === TAB_ID);
    });
    hub.querySelectorAll<HTMLElement>('[role="tabpanel"]').forEach(panel => {
      panel.style.display = panel.id === PANEL_ID ? '' : 'none';
    });
    const bridgeHost = document.getElementById(HOST_ID);
    if (bridgeHost) bridgeHost.style.display = '';
    setActive(true);
  }, []);

  const ensureBridge = useCallback((): void => {
    const hub = document.getElementById(HUB_ID);
    const tabList = hub?.querySelector<HTMLElement>('[role="tablist"]');
    if (!hub || !tabList) {
      setHost(previous => previous && !document.body.contains(previous) ? null : previous);
      return;
    }

    let bridgeHost = document.getElementById(HOST_ID);
    if (!bridgeHost) {
      bridgeHost = document.createElement('div');
      bridgeHost.id = HOST_ID;
      bridgeHost.className = 'mt-4';
      bridgeHost.style.display = active ? '' : 'none';
      tabList.insertAdjacentElement('afterend', bridgeHost);
    }
    if (host !== bridgeHost) setHost(bridgeHost);

    let tab = document.getElementById(TAB_ID) as HTMLButtonElement | null;
    if (!tab) {
      tab = document.createElement('button');
      tab.type = 'button';
      tab.id = TAB_ID;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.textContent = 'Homologação';
      tab.className = 'min-h-10 rounded-xl border px-2 py-2 text-[9px] font-black uppercase tracking-wide transition';
      tab.classList.add(...(active ? ACTIVE_TAB_CLASSES : INACTIVE_TAB_CLASSES));
      tab.addEventListener('click', activateHomologation);
      tabList.appendChild(tab);
    }

    tabList.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(#accounting-fiscal-tab-homologation)').forEach(nativeTab => {
      if (nativeTab.dataset.fiscalHomologationListener === 'true') return;
      nativeTab.dataset.fiscalHomologationListener = 'true';
      nativeTab.addEventListener('click', () => {
        setActive(false);
        const currentHost = document.getElementById(HOST_ID);
        if (currentHost) currentHost.style.display = 'none';
        const currentTab = document.getElementById(TAB_ID);
        if (currentTab) setNativeTabVisualState(currentTab, false);
      });
    });
  }, [activateHomologation, active, host]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    ensureBridge();
    const observer = new MutationObserver(() => ensureBridge());
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [ensureBridge]);

  useEffect(() => {
    const bridgeHost = document.getElementById(HOST_ID);
    if (bridgeHost) bridgeHost.style.display = active ? '' : 'none';
    const tab = document.getElementById(TAB_ID);
    if (tab) setNativeTabVisualState(tab, active);
  }, [active]);

  if (!host || !user) return null;

  return createPortal(
    <>
      <style>{`
        #${HUB_ID} [role="tablist"] {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        @media (min-width: 640px) {
          #${HUB_ID} [role="tablist"] {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
        }
      `}</style>
      <div role="tabpanel" id={PANEL_ID}>
        <FiscalPreflightWorkspace user={user} storeId={user.uid} />
      </div>
    </>,
    host
  );
}
