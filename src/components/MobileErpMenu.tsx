import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
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

interface MobileErpMenuProps {
  activeSubTab: ErpSubTab;
  onSelectSubTab: (tab: ErpSubTab) => void;
  onOpenStore: () => void;
}

const MENU_ITEMS = [
  { id: 'loja', label: 'Loja', icon: StoreIcon },
  { id: 'clientes', label: 'Clientes', icon: Users },
  { id: 'caixa', label: 'Caixa', icon: DollarSign },
  { id: 'pedidos', label: 'KDS / Vendas', icon: ClipboardList },
  { id: 'reservas', label: 'Reservas', icon: Calendar },
  { id: 'ponto', label: 'Ponto', icon: Fingerprint },
  { id: 'gerencial', label: 'Gerencial', icon: LayoutGrid },
] as const;

export function MobileErpMenu({
  activeSubTab,
  onSelectSubTab,
  onOpenStore,
}: MobileErpMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  const activeLabel = useMemo(
    () => MENU_ITEMS.find(item => item.id === activeSubTab)?.label ?? 'Menu',
    [activeSubTab],
  );

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

  const selectItem = (itemId: (typeof MENU_ITEMS)[number]['id']) => {
    if (itemId === 'loja') {
      onOpenStore();
    } else {
      onSelectSubTab(itemId);
    }

    setIsOpen(false);
  };

  const drawer = isOpen && typeof document !== 'undefined'
    ? createPortal(
        <div className="sm:hidden fixed inset-0 z-[90]" role="presentation">
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
            className="absolute inset-y-0 right-0 w-[82vw] max-w-sm bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col animate-fade-in"
          >
            <div className="h-[53px] px-5 flex items-center justify-between border-b border-slate-800 shrink-0">
              <span className="text-[11px] font-black uppercase tracking-[0.18em] text-orange-400">
                Painel da loja
              </span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Fechar menu"
                className="w-8 h-8 rounded-full bg-slate-950 border border-slate-700 text-slate-400 hover:text-white flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <nav className="p-4 space-y-2 overflow-y-auto" aria-label="Seções do painel">
              {MENU_ITEMS.map(item => {
                const Icon = item.icon;
                const isSelected = item.id === activeSubTab;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectItem(item.id)}
                    aria-current={isSelected ? 'page' : undefined}
                    className={`w-full min-h-12 px-4 py-3 rounded-2xl flex items-center gap-3 text-left transition-colors border ${
                      isSelected
                        ? 'bg-orange-500 text-slate-950 border-orange-400 shadow-lg shadow-orange-500/10'
                        : 'bg-slate-950/70 text-slate-300 border-slate-800 hover:border-slate-700 hover:text-white'
                    }`}
                  >
                    <Icon className="w-5 h-5 shrink-0" />
                    <span className="text-sm font-black uppercase tracking-wide">
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={`Abrir menu do painel. Seção atual: ${activeLabel}`}
        aria-controls="mobile-erp-navigation-drawer"
        aria-expanded={isOpen}
        className="sm:hidden ml-auto w-8 h-8 rounded-full bg-slate-950 border border-slate-700 text-slate-300 hover:text-white hover:border-orange-500/70 transition-colors flex items-center justify-center shadow-lg"
      >
        <Menu className="w-4 h-4" />
      </button>
      {drawer}
    </>
  );
}
