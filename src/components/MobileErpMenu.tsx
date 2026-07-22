import { useEffect, useRef, useState } from 'react';
import {
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

type MenuItem =
  | {
      id: 'loja';
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
  { id: 'clientes', label: 'Clientes', icon: Users },
  { id: 'caixa', label: 'Caixa', icon: DollarSign },
  { id: 'pedidos', label: 'KDS / Vendas', icon: ClipboardList },
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
  const drawerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    const focusFrame = window.requestAnimationFrame(() => {
      drawerRef.current?.focus();
    });

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    window.addEventListener('keydown', handleEscape);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', handleEscape);
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [isOpen]);

  const handleSelect = (itemId: MenuItem['id']) => {
    if (itemId === 'loja') {
      onOpenStoreConfig();
    } else {
      onSelectTab(itemId);
    }

    setIsOpen(false);
  };

  return (
    <div className="flex min-h-11 w-full items-center justify-between sm:hidden">
      {canClosePanel ? (
        <button
          type="button"
          onClick={onClosePanel}
          aria-label="Fechar painel de gestão"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-700 bg-slate-950 text-slate-400 shadow-sm transition-colors hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      ) : (
        <span className="h-11 w-11" aria-hidden="true" />
      )}

      <span className="min-w-0 px-2 text-center text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
        Painel da loja
      </span>

      {isRetailer ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label="Abrir menu do painel de gestão"
          aria-controls="mobile-erp-navigation-drawer"
          aria-expanded={isOpen}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-700 bg-slate-950 text-slate-300 shadow-lg transition-colors hover:border-orange-500/70 hover:text-white"
        >
          <Menu className="h-5 w-5" />
        </button>
      ) : (
        <span className="h-11 w-11" aria-hidden="true" />
      )}

      {isOpen && isRetailer && (
        <div className="fixed inset-0 z-[90]" role="presentation">
          <button
            type="button"
            aria-label="Fechar menu do painel"
            onClick={() => setIsOpen(false)}
            className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
          />

          <aside
            ref={drawerRef}
            id="mobile-erp-navigation-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-erp-navigation-title"
            tabIndex={-1}
            className="absolute inset-y-0 right-0 flex h-[100dvh] w-[min(88vw,24rem)] flex-col border-l border-slate-800 bg-slate-900 shadow-2xl outline-none animate-fade-in"
          >
            <div className="flex min-h-16 shrink-0 items-center justify-between border-b border-slate-800 px-4">
              <span
                id="mobile-erp-navigation-title"
                className="text-[11px] font-black uppercase tracking-[0.18em] text-orange-400"
              >
                Painel da loja
              </span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Fechar menu"
                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-700 bg-slate-950 text-slate-400 transition-colors hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <nav
              className="kyrub-modal-scroll flex-1 space-y-2 overflow-y-auto p-4"
              aria-label="Seções do painel"
            >
              {MENU_ITEMS.map(item => {
                const Icon = item.icon;
                const isSelected = item.id !== 'loja' && item.id === activeSubTab;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelect(item.id)}
                    aria-current={isSelected ? 'page' : undefined}
                    className={`flex min-h-14 w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${
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
