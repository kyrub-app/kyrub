from pathlib import Path


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return source.replace(old, new, 1)


app_path = Path("src/App.tsx")
main_path = Path("src/main.tsx")
legacy_menu_path = Path("src/components/MobileErpMenuEnhancer.tsx")
menu_path = Path("src/components/MobileErpMenu.tsx")

app = app_path.read_text(encoding="utf-8")
main = main_path.read_text(encoding="utf-8")

app = replace_once(
    app,
    "import { KyrubTab } from './components/tabs/KyrubTab';\n",
    "import { KyrubTab } from './components/tabs/KyrubTab';\n"
    "import { MobileErpMenu } from './components/MobileErpMenu';\n",
    "MobileErpMenu import",
)

header_anchor = '''          <div className="bg-slate-900 border-b border-slate-800 px-6 py-2.5 flex items-center justify-between gap-4 font-sans shrink-0" id="erp-main-header">\n\n'''
header_with_mobile_menu = header_anchor + '''            <MobileErpMenu
              activeSubTab={activeSubTab}
              isRetailer={gestaoRole === 'retailer'}
              canClosePanel={!isAdminSubdomain}
              onClosePanel={() => setIsGestaoOpen(false)}
              onOpenStoreConfig={() => setIsConfigModalOpen(true)}
              onSelectTab={setActiveSubTab}
            />

'''
app = replace_once(
    app,
    header_anchor,
    header_with_mobile_menu,
    "mobile ERP menu mount",
)

app = replace_once(
    app,
    'className="text-slate-500 hover:text-slate-300 font-bold bg-slate-950 border border-slate-850 w-8 h-8 rounded-full flex items-center justify-center text-sm cursor-pointer shadow-sm shrink-0"',
    'className="hidden sm:flex text-slate-500 hover:text-slate-300 font-bold bg-slate-950 border border-slate-850 w-8 h-8 rounded-full items-center justify-center text-sm cursor-pointer shadow-sm shrink-0"',
    "desktop close button visibility",
)

app = replace_once(
    app,
    'className="flex items-center gap-1.5 overflow-x-auto whitespace-nowrap scrollbar-none flex-1 px-2" id="erp-tab-navigation-header"',
    'className="hidden sm:flex items-center gap-1.5 overflow-x-auto whitespace-nowrap scrollbar-none flex-1 px-2" id="erp-tab-navigation-header"',
    "desktop ERP navigation visibility",
)

main = replace_once(
    main,
    "import {MobileErpMenuEnhancer} from './components/MobileErpMenuEnhancer';\n",
    "",
    "legacy menu import removal",
)
main = replace_once(
    main,
    "    <MobileErpMenuEnhancer />\n",
    "",
    "legacy menu mount removal",
)

menu_path.write_text(
    '''import { useEffect, useState } from 'react';
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
    } else {
      onSelectTab(itemId);
    }

    setIsOpen(false);
  };

  return (
    <div className="sm:hidden flex items-center justify-between w-full">
      {canClosePanel ? (
        <button
          type="button"
          onClick={onClosePanel}
          aria-label="Fechar painel de gestão"
          className="w-8 h-8 rounded-full bg-slate-950 border border-slate-700 text-slate-400 hover:text-white flex items-center justify-center shadow-sm"
        >
          <X className="w-4 h-4" />
        </button>
      ) : (
        <span className="w-8 h-8" aria-hidden="true" />
      )}

      {isRetailer ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label="Abrir menu do painel de gestão"
          aria-controls="mobile-erp-navigation-drawer"
          aria-expanded={isOpen}
          className="w-8 h-8 rounded-full bg-slate-950 border border-slate-700 text-slate-300 hover:text-white hover:border-orange-500/70 transition-colors flex items-center justify-center shadow-lg"
        >
          <Menu className="w-4 h-4" />
        </button>
      ) : (
        <span className="w-8 h-8" aria-hidden="true" />
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
                const isSelected = item.id !== 'loja' && item.id === activeSubTab;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelect(item.id)}
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
    </div>
  );
}
''',
    encoding="utf-8",
)

app_path.write_text(app, encoding="utf-8")
main_path.write_text(main, encoding="utf-8")
legacy_menu_path.unlink(missing_ok=True)
