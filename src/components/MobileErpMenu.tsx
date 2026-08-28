import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  ClipboardList,
  Crown,
  DollarSign,
  Fingerprint,
  LayoutGrid,
  Menu,
  Store as StoreIcon,
  Users,
  X,
} from 'lucide-react';
import { getPlanCenterUrl } from '../utils/planCenter';

export type ErpSubTab =
  | 'clientes'
  | 'caixa'
  | 'pedidos'
  | 'reservas'
  | 'ponto'
  | 'gerencial';

type MenuItem =
  | {
      id: 'loja' | 'plano';
      label: string;
      icon: typeof StoreIcon;
    }
  | {
      id: ErpSubTab;
      label: string;
      icon: typeof StoreIcon;
    };

const MENU_ITEMS: readonly MenuItem[] = [
  { id: 'loja', label: 'Loja', icon: StoreIcon },
  { id: 'plano', label: 'Plano', icon: Crown },
  { id: 'clientes', label: 'PDV', icon: Users },
  { id: 'caixa', label: 'Caixa', icon: DollarSign },
  { id: 'pedidos', label: 'Pedidos', icon: ClipboardList },
  { id: 'reservas', label: 'Reservas', icon: Calendar },
  { id: 'ponto', label: 'Ponto', icon: Fingerprint },
  { id: 'gerencial', label: 'Gerencial', icon: LayoutGrid },
];

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

  const handleSelect = (itemId: MenuItem['id']) => {
    if (itemId === 'loja') {
      onOpenStoreConfig();
    } else if (itemId === 'plano') {
      window.location.assign(getPlanCenterUrl());
    } else {
      onSelectTab(itemId);
    }

    setIsOpen(false);
  };

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

      {isOpen && isRetailer && (
        <div className="fixed inset-0 z-[90]" role="presentation">
          <button
            type="button"
            aria-label="Fechar menu do painel"
            onClick={() => setIsOpen(false)}
            className="absolute inset-0 bg-slate-950/75 backdrop-blur-sm"
          />

          <aside
            id="mobile-erp-navigation-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Menu do painel de gestão"
            className="absolute inset-y-0 right-0 flex w-[82vw] max-w-sm animate-fade-in flex-col border-l border-slate-800 bg-slate-900 shadow-2xl"
          >
            <div className="flex h-[53px] shrink-0 items-center justify-between border-b border-slate-800 px-5">
              <span className="text-[11px] font-black uppercase tracking-[0.18em] text-orange-400">
                Painel da loja
              </span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Fechar menu"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-700 bg-slate-950 text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <nav className="space-y-2 overflow-y-auto p-4" aria-label="Seções do painel">
              {MENU_ITEMS.map(item => {
                const Icon = item.icon;
                const isSelected = item.id !== 'loja' && item.id !== 'plano' && item.id === activeSubTab;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelect(item.id)}
                    aria-current={isSelected ? 'page' : undefined}
                    className={`flex min-h-12 w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${
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
        </div>
      )}
    </div>
  );
}
