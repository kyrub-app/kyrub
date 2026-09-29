import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Boxes, ShoppingCart, Store } from 'lucide-react';

export type ProductModalWorkspace = 'product' | 'stock' | 'purchases';

interface ProductModalWorkspaceTabsProps {
  active: ProductModalWorkspace;
  onChange: (workspace: ProductModalWorkspace) => void;
  disabled?: boolean;
}

const WORKSPACES: Array<{
  id: ProductModalWorkspace;
  label: string;
  description: string;
  icon: typeof Store;
}> = [
  {
    id: 'product',
    label: 'Produto',
    description: 'Dados, venda e composição',
    icon: Store,
  },
  {
    id: 'stock',
    label: 'Estoque',
    description: 'Itens físicos e movimentação',
    icon: Boxes,
  },
  {
    id: 'purchases',
    label: 'Compras',
    description: 'Reposição e fornecedores',
    icon: ShoppingCart,
  },
];

export function ProductModalWorkspaceTabs({
  active,
  onChange,
  disabled = false,
}: ProductModalWorkspaceTabsProps) {
  return (
    <nav
      className="grid grid-cols-3 gap-2"
      aria-label="Produto, estoque e compras"
      id="product-modal-workspace-tabs"
    >
      {WORKSPACES.map(workspace => {
        const Icon = workspace.icon;
        const selected = active === workspace.id;
        return (
          <button
            key={workspace.id}
            type="button"
            onClick={() => onChange(workspace.id)}
            disabled={disabled}
            aria-pressed={selected}
            className={`min-w-0 rounded-2xl border px-2 py-3 text-left transition-colors sm:px-4 ${
              selected
                ? 'border-orange-500/45 bg-orange-500/10'
                : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
            } disabled:opacity-40`}
          >
            <span className="flex items-center gap-1.5 text-[9px] font-black uppercase text-white">
              <Icon
                className={`h-3.5 w-3.5 shrink-0 ${
                  selected ? 'text-orange-300' : 'text-slate-500'
                }`}
              />
              <span className="truncate">{workspace.label}</span>
            </span>
            <span className="mt-1 hidden text-[8px] text-slate-500 sm:block">
              {workspace.description}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

interface ProductModalWorkspaceTabsBridgeProps
  extends ProductModalWorkspaceTabsProps {
  isOpen: boolean;
}

export function ProductModalWorkspaceTabsBridge({
  isOpen,
  active,
  onChange,
  disabled = false,
}: ProductModalWorkspaceTabsBridgeProps) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setHost(null);
      return;
    }

    let frame = 0;
    let currentHost: HTMLDivElement | null = null;

    const synchronize = (): void => {
      frame = 0;
      const legacyTabs = document.getElementById('unified-product-modal-tabs');
      if (!(legacyTabs instanceof HTMLElement)) return;

      let nextHost = document.getElementById(
        'product-modal-workspace-tabs-host'
      ) as HTMLDivElement | null;
      if (!nextHost) {
        nextHost = document.createElement('div');
        nextHost.id = 'product-modal-workspace-tabs-host';
        nextHost.className = 'mt-5';
        legacyTabs.insertAdjacentElement('afterend', nextHost);
      }

      currentHost = nextHost;
      setHost(previous => (previous === nextHost ? previous : nextHost));
    };

    const schedule = (): void => {
      if (frame) return;
      frame = window.requestAnimationFrame(synchronize);
    };

    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      currentHost?.remove();
      setHost(null);
    };
  }, [isOpen]);

  if (!host) return null;

  return createPortal(
    <ProductModalWorkspaceTabs
      active={active}
      onChange={onChange}
      disabled={disabled}
    />,
    host
  );
}
