import { useEffect, useLayoutEffect, useState, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Search } from 'lucide-react';

export type SquareDirectoryTab = 'participating' | 'favorites' | 'trending';

type SquareDirectoryLayoutProps = {
  ariaLabel: string;
  title: string;
  subtitle: string;
  searchId: string;
  searchLabel: string;
  searchPlaceholder: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  selectedTab: SquareDirectoryTab;
  onTabChange: (tab: SquareDirectoryTab) => void;
  categories: readonly string[];
  category: string;
  onCategoryChange: (value: string) => void;
  onClose: () => void;
  children: ReactNode;
};

const DIRECTORY_TABS: ReadonlyArray<{ id: SquareDirectoryTab; label: string }> = [
  { id: 'participating', label: 'Participante' },
  { id: 'favorites', label: 'Favoritos' },
  { id: 'trending', label: 'Em alta' },
];

/**
 * Shared Praça directory shell. Both catalogs keep the fixed navigation bar
 * visible; the brand/login row belongs to scrollable page content, not the overlay.
 */
export function SquareDirectoryLayout({
  ariaLabel, title, subtitle, searchId, searchLabel, searchPlaceholder,
  searchValue, onSearchChange, selectedTab, onTabChange, categories, category,
  onCategoryChange, onClose, children,
}: SquareDirectoryLayoutProps) {
  const [headerBottom, setHeaderBottom] = useState(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    // Because the real header remains interactive, navigating to another
    // workspace or opening the profile must dismiss the catalog.
    const initialTab = document.getElementById('kyrub-workspace-main')?.dataset.kyrubWorkspace;
    const profileInitiallyOpen = Boolean(document.getElementById('profile-social-hub-modal'));
    const onWorkspaceChange = () => {
      const workspace = document.getElementById('kyrub-workspace-main');
      if (
        !workspace ||
        workspace.dataset.kyrubWorkspace !== initialTab ||
        document.getElementById('modal-user-profile') ||
        (!profileInitiallyOpen && document.getElementById('profile-social-hub-modal'))
      ) {
        onCloseRef.current();
      }
    };
    const observer = new MutationObserver(onWorkspaceChange);
    observer.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['data-kyrub-workspace'],
    });
    return () => observer.disconnect();
  }, []);


  useLayoutEffect(() => {
    // Only the icon navigation is sticky. Never reserve a permanent gap
    // for the Kyrub logo/session row, which scrolls with the page.
    const toolbar = document.getElementById('app-header');
    const updatePosition = () => {
      const toolbarBottom = toolbar?.getBoundingClientRect().bottom ?? 0;
      setHeaderBottom(Math.max(toolbarBottom, 0));
    };
    updatePosition();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition);
    if (toolbar) observer?.observe(toolbar);
    window.addEventListener('resize', updatePosition);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updatePosition);
    };
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  return createPortal(
    <div
      data-kyrub-font-scope="true"
      className="fixed inset-x-0 bottom-0 z-[170] bg-slate-950/95 backdrop-blur-md"
      style={{ top: headerBottom }}
      role="dialog"
      aria-modal="false"
      aria-label={ariaLabel}
    >
      <section className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden border-x border-slate-800 bg-slate-950">
        <main data-square-directory-scroll="true" className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-12">
          <header className="flex items-center gap-3 border-b border-slate-800 bg-slate-900 p-4">
            <button
              type="button"
              onClick={onClose}
              aria-label="Voltar à Praça"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-700 text-slate-200"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <div className="min-w-0 flex-1">
              <span className="text-xs font-black uppercase tracking-[0.16em] text-sky-300">Catálogo</span>
              <h2 className="text-xl font-black text-white">{title}</h2>
              <p className="text-sm text-slate-400">{subtitle}</p>
            </div>
          </header>
          <div className="space-y-3 border-b border-slate-800 p-4">
            <label className="block text-sm font-bold text-slate-300" htmlFor={searchId}>
              {searchLabel}
            </label>
            <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3">
              <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <input
                id={searchId}
                type="search"
                value={searchValue}
                onChange={event => onSearchChange(event.target.value)}
                placeholder={searchPlaceholder}
                className="min-h-11 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
              />
            </div>
            <div role="group" aria-label={`Filtros de ${searchLabel.toLocaleLowerCase('pt-BR')}`}
              className="flex gap-2 overflow-x-auto">
              {DIRECTORY_TABS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={selectedTab === id}
                  onClick={() => onTabChange(id)}
                  className={`min-h-11 shrink-0 rounded-xl px-3.5 text-sm font-bold ${
                    selectedTab === id
                      ? 'bg-sky-500/15 text-sky-200'
                      : 'border border-slate-800 bg-slate-900 text-slate-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="flex items-center justify-between gap-3 text-sm text-slate-300">
              Categoria
              <select
                value={category}
                onChange={event => onCategoryChange(event.target.value)}
                aria-label="Filtrar por categoria"
                className="min-h-10 min-w-0 max-w-[70%] rounded-xl border border-slate-700 bg-slate-900 px-3 text-sm text-white"
              >
                <option value="all">Todas as categorias</option>
                {categories.map(item => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          </div>
          <div className="p-4">
            {children}
          </div>
        </main>
      </section>
    </div>,
    document.body
  );
}
