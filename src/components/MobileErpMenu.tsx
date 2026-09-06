import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  Calendar,
  ClipboardList,
  DollarSign,
  Fingerprint,
  LayoutGrid,
  Menu,
  Store as StoreIcon,
  Users,
  X,
} from 'lucide-react';

export type ErpSubTab =
  | 'clientes'
  | 'caixa'
  | 'pedidos'
  | 'reservas'
  | 'ponto'
  | 'gerencial';

export type MobileErpMenuItemId = 'loja' | ErpSubTab;

type MenuItem = {
  id: MobileErpMenuItemId;
  label: string;
  icon: typeof StoreIcon;
};

const MENU_ITEMS: readonly MenuItem[] = [
  { id: 'loja', label: 'Loja', icon: StoreIcon },
  { id: 'clientes', label: 'PDV', icon: Users },
  { id: 'caixa', label: 'Caixa', icon: DollarSign },
  { id: 'pedidos', label: 'Pedidos', icon: ClipboardList },
  { id: 'reservas', label: 'Reservas', icon: Calendar },
  { id: 'ponto', label: 'Ponto', icon: Fingerprint },
  { id: 'gerencial', label: 'Gerencial', icon: LayoutGrid },
];

const MENU_ITEM_IDS = new Set<MobileErpMenuItemId>(
  MENU_ITEMS.map(item => item.id)
);

const isMobileErpMenuItemId = (
  value: string | undefined
): value is MobileErpMenuItemId => Boolean(value && MENU_ITEM_IDS.has(value as MobileErpMenuItemId));

export const commitMobileErpMenuSelection = (
  itemId: MobileErpMenuItemId,
  actions: {
    onOpenStoreConfig: () => void;
    onSelectTab: (tab: ErpSubTab) => void;
    onCloseMenu: () => void;
  }
): void => {
  if (itemId === 'loja') {
    actions.onOpenStoreConfig();
  } else {
    actions.onSelectTab(itemId);
  }

  actions.onCloseMenu();
};

interface MobileErpMenuProps {
  activeSubTab: ErpSubTab;
  isRetailer: boolean;
  canClosePanel: boolean;
  onClosePanel: () => void;
  onOpenStoreConfig: () => void;
  onSelectTab: (tab: ErpSubTab) => void;
}

export function MobileErpMenu({
  activeSubTab,
  isRetailer,
  canClosePanel,
  onClosePanel,
  onOpenStoreConfig,
  onSelectTab,
}: MobileErpMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('keydown', handleEscape);
      document.documentElement.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !isRetailer) return;

    const handleCapturedMenuClick = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const menuButton = target.closest<HTMLElement>(
        '[data-kyrub-mobile-erp-item]'
      );
      if (!menuButton) return;

      const portalRoot = menuButton.closest<HTMLElement>(
        '[data-kyrub-mobile-erp-portal="true"]'
      );
      if (!portalRoot) return;

      const itemId = menuButton.dataset.kyrubMobileErpItem;
      if (!isMobileErpMenuItemId(itemId)) return;

      // Capture the native click before React's portal event can bubble back
      // through the legacy management overlay. This keeps touch navigation
      // authoritative even when another overlay intercepts synthetic clicks.
      event.preventDefault();
      event.stopPropagation();

      commitMobileErpMenuSelection(itemId, {
        onOpenStoreConfig,
        onSelectTab,
        onCloseMenu: () => setIsOpen(false),
      });
    };

    window.addEventListener('click', handleCapturedMenuClick, true);
    return () => {
      window.removeEventListener('click', handleCapturedMenuClick, true);
    };
  }, [isOpen, isRetailer, onOpenStoreConfig, onSelectTab]);

  const drawerPortal =
    isOpen && isRetailer && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="pointer-events-auto fixed inset-0 z-[200]"
            role="presentation"
            data-kyrub-skip-top-overlay="true"
            data-kyrub-mobile-erp-portal="true"
          >
            <button
              type="button"
              aria-label="Fechar menu do painel"
              onClick={() => setIsOpen(false)}
              className="pointer-events-auto absolute inset-0 z-0 bg-slate-950/75 backdrop-blur-sm"
            />

            <aside
              id="mobile-erp-navigation-drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Menu do painel de gestão"
              className="pointer-events-auto absolute inset-y-0 right-0 z-10 isolate flex w-[82vw] max-w-sm animate-fade-in flex-col border-l border-slate-800 bg-slate-900 shadow-2xl"
            >
              <div className="relative z-20 flex h-[53px] shrink-0 items-center justify-between border-b border-slate-800 px-5">
                <span className="text-[11px] font-black uppercase tracking-[0.18em] text-orange-400">
                  Painel da loja
                </span>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  aria-label="Fechar menu"
                  className="pointer-events-auto flex h-8 w-8 touch-manipulation items-center justify-center rounded-full border border-slate-700 bg-slate-950 text-slate-400 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <nav
                className="pointer-events-auto relative z-20 space-y-2 overflow-y-auto p-4"
                aria-label="Seções do painel"
              >
                {MENU_ITEMS.map(item => {
                  const Icon = item.icon;
                  const isSelected = item.id !== 'loja' && item.id === activeSubTab;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-kyrub-mobile-erp-item={item.id}
                      aria-current={isSelected ? 'page' : undefined}
                      className={`pointer-events-auto relative z-20 flex min-h-12 w-full touch-manipulation items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${
                        isSelected
                          ? 'border-orange-400 bg-orange-500 text-slate-950 shadow-lg shadow-orange-500/10'
                          : 'border-slate-800 bg-slate-950/70 text-slate-300 hover:border-slate-700 hover:text-white'
                      }`}
                    >
                      <Icon className="h-5 w-5 shrink-0" />
                      <span className="text-sm font-black uppercase tracking-wide">
                        {item.label}
                      </span>
                    </button>
                  );
                })}
              </nav>
            </aside>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="sm:hidden -mx-6 -my-2.5 flex w-screen max-w-none shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900 px-6 py-2.5">
      {canClosePanel ? (
        <button
          type="button"
          onClick={onClosePanel}
          aria-label="Voltar e fechar painel de gestão"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-700 bg-slate-950 text-slate-400 shadow-sm transition-colors hover:border-orange-500/70 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      ) : (
        <span className="h-8 w-8" aria-hidden="true" />
      )}

      {isRetailer ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label="Abrir menu do painel de gestão"
          aria-controls="mobile-erp-navigation-drawer"
          aria-expanded={isOpen}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-700 bg-slate-950 text-slate-300 shadow-lg transition-colors hover:border-orange-500/70 hover:text-white"
        >
          <Menu className="h-4 w-4" />
        </button>
      ) : (
        <span className="h-8 w-8" aria-hidden="true" />
      )}

      {drawerPortal}
    </div>
  );
}
