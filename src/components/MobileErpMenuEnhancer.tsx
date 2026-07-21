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

type ErpTabId =
  | 'loja'
  | 'clientes'
  | 'caixa'
  | 'pedidos'
  | 'reservas'
  | 'ponto'
  | 'gerencial';

const MENU_ITEMS = [
  { id: 'loja', label: 'Loja', icon: StoreIcon },
  { id: 'clientes', label: 'Clientes', icon: Users },
  { id: 'caixa', label: 'Caixa', icon: DollarSign },
  { id: 'pedidos', label: 'KDS / Vendas', icon: ClipboardList },
  { id: 'reservas', label: 'Reservas', icon: Calendar },
  { id: 'ponto', label: 'Ponto', icon: Fingerprint },
  { id: 'gerencial', label: 'Gerencial', icon: LayoutGrid },
] satisfies ReadonlyArray<{
  id: ErpTabId;
  label: string;
  icon: typeof StoreIcon;
}>;

const normalizeLabel = (value: string): string =>
  value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');

const TAB_LABELS: Record<Exclude<ErpTabId, 'loja'>, string> = {
  clientes: 'clientes',
  caixa: 'caixa',
  pedidos: 'kds/vendas',
  reservas: 'reservas',
  ponto: 'ponto',
  gerencial: 'gerencial',
};

export function MobileErpMenuEnhancer() {
  const [isVisible, setIsVisible] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeItem, setActiveItem] = useState<ErpTabId>('clientes');

  const activeLabel = useMemo(
    () => MENU_ITEMS.find(item => item.id === activeItem)?.label ?? 'Menu',
    [activeItem],
  );

  useEffect(() => {
    const syncFromErpNavigation = () => {
      const header = document.getElementById('erp-main-header');
      const navigation = document.getElementById('erp-tab-navigation-header');
      const nextVisible = Boolean(header && navigation);

      setIsVisible(nextVisible);
      if (!nextVisible) {
        setIsOpen(false);
        return;
      }

      const selectedButton = Array.from(
        navigation?.querySelectorAll<HTMLButtonElement>('button') ?? [],
      ).find(button => button.className.includes('bg-orange-500'));

      const selectedLabel = normalizeLabel(selectedButton?.textContent ?? '');
      const selectedItem = MENU_ITEMS.find(item => {
        if (item.id === 'loja') return false;
        return normalizeLabel(TAB_LABELS[item.id]) === selectedLabel;
      });

      if (selectedItem) setActiveItem(selectedItem.id);
    };

    syncFromErpNavigation();

    const observer = new MutationObserver(syncFromErpNavigation);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => observer.disconnect();
  }, []);

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

  const selectItem = (itemId: ErpTabId) => {
    if (itemId === 'loja') {
      document.getElementById('orange-house-config-btn')?.click();
      setIsOpen(false);
      return;
    }

    const navigation = document.getElementById('erp-tab-navigation-header');
    const targetLabel = normalizeLabel(TAB_LABELS[itemId]);
    const targetButton = Array.from(
      navigation?.querySelectorAll<HTMLButtonElement>('button') ?? [],
    ).find(button => normalizeLabel(button.textContent ?? '') === targetLabel);

    targetButton?.click();
    setActiveItem(itemId);
    setIsOpen(false);
  };

  if (!isVisible || typeof document === 'undefined') return null;

  return createPortal(
    <>
      <style>{`
        @media (max-width: 639px) {
          #erp-tab-navigation-header {
            display: none !important;
          }
        }
      `}</style>

      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={`Abrir menu do painel. Seção atual: ${activeLabel}`}
        aria-controls="mobile-erp-navigation-drawer"
        aria-expanded={isOpen}
        className="sm:hidden fixed top-2.5 right-6 z-[80] w-8 h-8 rounded-full bg-slate-950 border border-slate-700 text-slate-300 hover:text-white hover:border-orange-500/70 transition-colors flex items-center justify-center shadow-lg"
      >
        <Menu className="w-4 h-4" />
      </button>

      {isOpen && (
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
                const isSelected = item.id === activeItem && item.id !== 'loja';

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
        </div>
      )}
    </>,
    document.body,
  );
}
