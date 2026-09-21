import { useRef, useState, type MouseEvent } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Briefcase,
  Calendar,
  ClipboardList,
  DollarSign,
  Fingerprint,
  Menu,
  Package,
  Percent,
  Settings,
  Store as StoreIcon,
  UserCheck,
  Users,
  X,
  Zap,
} from 'lucide-react';
import {
  requestErpManagementNavigation,
  type ErpManagementModule,
} from '../utils/erpManagementNavigation';

export type ErpSubTab =
  | 'clientes'
  | 'caixa'
  | 'pedidos'
  | 'reservas'
  | 'ponto'
  | 'gerencial';

export type MobileErpMenuItemId = 'loja' | ErpSubTab | ErpManagementModule;

type MenuItem = {
  id: MobileErpMenuItemId;
  label: string;
  icon: typeof StoreIcon;
  section: 'gestao' | 'operacao';
};

const MENU_ITEMS: readonly MenuItem[] = [
  { id: 'loja', label: 'Loja', icon: StoreIcon, section: 'gestao' },
  { id: 'produtos', label: 'Produtos & Estoque', icon: Package, section: 'gestao' },
  { id: 'vendas', label: 'Vendas & Analytics', icon: BarChart3, section: 'gestao' },
  { id: 'financeiro', label: 'Financeiro Interno', icon: DollarSign, section: 'gestao' },
  { id: 'rh', label: 'Recursos Humanos', icon: Briefcase, section: 'gestao' },
  { id: 'crm', label: 'CRM', icon: UserCheck, section: 'gestao' },
  { id: 'marketing', label: 'Marketing', icon: Zap, section: 'gestao' },
  { id: 'integracoes', label: 'Integrações & Sandbox', icon: Settings, section: 'gestao' },
  { id: 'vouchers', label: 'Cupons & Vouchers', icon: Percent, section: 'gestao' },
  { id: 'clientes', label: 'PDV', icon: Users, section: 'operacao' },
  { id: 'caixa', label: 'Caixa', icon: DollarSign, section: 'operacao' },
  { id: 'pedidos', label: 'Pedidos', icon: ClipboardList, section: 'operacao' },
  { id: 'reservas', label: 'Reservas', icon: Calendar, section: 'operacao' },
  { id: 'ponto', label: 'Ponto', icon: Fingerprint, section: 'operacao' },
];

const MANAGEMENT_MODULES = new Set<ErpManagementModule>([
  'produtos',
  'vendas',
  'financeiro',
  'rh',
  'crm',
  'marketing',
  'integracoes',
  'vouchers',
]);

const isManagementModule = (
  itemId: MobileErpMenuItemId
): itemId is ErpManagementModule =>
  MANAGEMENT_MODULES.has(itemId as ErpManagementModule);

export const commitMobileErpMenuSelection = (
  itemId: MobileErpMenuItemId,
  actions: {
    onOpenStoreConfig: () => void;
    onSelectTab: (tab: ErpSubTab) => void;
    onSelectManagementModule?: (module: ErpManagementModule | null) => void;
  }
): void => {
  const selectManagement =
    actions.onSelectManagementModule ?? requestErpManagementNavigation;

  if (itemId === 'loja') {
    selectManagement(null);
    actions.onOpenStoreConfig();
    return;
  }

  if (isManagementModule(itemId)) {
    selectManagement(itemId);
    return;
  }

  selectManagement(null);
  actions.onSelectTab(itemId);
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
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const pendingSelectionRef = useRef<MobileErpMenuItemId | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const openMenu = (): void => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;

    pendingSelectionRef.current = null;
    dialog.showModal();
    setIsOpen(true);
  };

  const closeMenu = (): void => {
    const dialog = dialogRef.current;
    if (dialog?.open) {
      dialog.close();
      return;
    }
    setIsOpen(false);
  };

  const handleSelect = (itemId: MobileErpMenuItemId): void => {
    pendingSelectionRef.current = itemId;
    closeMenu();
  };

  const handleDialogClose = (): void => {
    setIsOpen(false);

    const itemId = pendingSelectionRef.current;
    pendingSelectionRef.current = null;
    if (!itemId) return;

    commitMobileErpMenuSelection(itemId, {
      onOpenStoreConfig,
      onSelectTab,
    });
  };

  const handleDialogClick = (event: MouseEvent<HTMLDialogElement>): void => {
    if (event.target === event.currentTarget) closeMenu();
  };

  const renderItems = (section: MenuItem['section']) =>
    MENU_ITEMS.filter(item => item.section === section).map(item => {
      const Icon = item.icon;
      const isSelected =
        !isManagementModule(item.id) &&
        item.id !== 'loja' &&
        item.id === activeSubTab;

      return (
        <button
          key={item.id}
          type="button"
          data-kyrub-mobile-menu-item={item.id}
          onClick={() => handleSelect(item.id)}
          aria-current={isSelected ? 'page' : undefined}
          className={`flex min-h-12 w-full touch-manipulation items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${
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
    });

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
        <>
          <button
            type="button"
            onClick={openMenu}
            aria-label="Abrir menu do painel de gestão"
            aria-controls="mobile-erp-navigation-dialog"
            aria-expanded={isOpen}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-700 bg-slate-950 text-slate-300 shadow-lg transition-colors hover:border-orange-500/70 hover:text-white"
          >
            <Menu className="h-4 w-4" />
          </button>

          <dialog
            ref={dialogRef}
            id="mobile-erp-navigation-dialog"
            aria-label="Menu do painel de gestão"
            onClose={handleDialogClose}
            onClick={handleDialogClick}
            className="fixed inset-0 m-0 h-[100dvh] max-h-none w-screen max-w-none overflow-hidden border-0 bg-transparent p-0 text-white"
          >
            <aside
              id="mobile-erp-navigation-drawer"
              aria-label="Seções do painel"
              className="absolute inset-y-0 right-0 flex w-[82vw] max-w-sm flex-col border-l border-slate-800 bg-slate-900 shadow-2xl"
            >
              <div className="flex h-[53px] shrink-0 items-center justify-between border-b border-slate-800 px-5">
                <span className="text-[11px] font-black uppercase tracking-[0.18em] text-orange-400">
                  Painel da loja
                </span>
                <button
                  type="button"
                  onClick={closeMenu}
                  aria-label="Fechar menu"
                  className="flex h-8 w-8 touch-manipulation items-center justify-center rounded-full border border-slate-700 bg-slate-950 text-slate-400 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <nav
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4"
                aria-label="Seções do painel"
                style={{
                  paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 4rem)',
                  scrollPaddingBottom: '5rem',
                }}
              >
                <div className="space-y-2">
                  <p className="px-1 pb-1 font-mono text-[9px] font-black uppercase tracking-[0.16em] text-slate-500">
                    Gestão
                  </p>
                  {renderItems('gestao')}
                </div>

                <div className="mt-5 space-y-2 border-t border-slate-800 pt-4">
                  <p className="px-1 pb-1 font-mono text-[9px] font-black uppercase tracking-[0.16em] text-slate-500">
                    Operação
                  </p>
                  {renderItems('operacao')}
                </div>
              </nav>
            </aside>
          </dialog>

          <style>{`
            #mobile-erp-navigation-dialog::backdrop {
              background: rgb(2 6 23 / 0.75);
              backdrop-filter: blur(4px);
            }
          `}</style>
        </>
      ) : (
        <span className="h-8 w-8" aria-hidden="true" />
      )}
    </div>
  );
}
