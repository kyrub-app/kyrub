import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
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
 * Shared Praça directory shell. Both catalogs use the real workspace header,
 * never a copied logo/session toolbar. Only the directory body scrolls.
 */
export function SquareDirectoryLayout({
  ariaLabel, title, subtitle, searchId, searchLabel, searchPlaceholder,
  searchValue, onSearchChange, selectedTab, onTabChange, categories, category,
  onCategoryChange, onClose, children,
}: SquareDirectoryLayoutProps) {
  const [headerBottom, setHeaderBottom] = useState(0);

  useLayoutEffect(() => {
    // The workspace brand is sticky beneath the existing toolbar; measuring
    // it leaves the scroll position intact when returning to the Praça.
    const toolbar = document.getElementById('app-header');
    const brand = document.getElementById('kyrub-workspace-brand');
    const updatePosition = () => {
      const toolbarBottom = toolbar?.getBoundingClientRect().bottom ?? 0;
      const brandBottom = brand?.getBoundingClientRect().bottom ?? toolbarBottom;
      setHeaderBottom(Math.max(toolbarBottom, brandBottom, 0));
    };
    updatePosition();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition);
    if (toolbar) observer?.observe(toolbar);
    if (brand) observer?.observe(brand);
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
      className="fixed inset-x-0 bottom-0 z-[170] bg-slate-950/95 backdrop-blur-md"
      style={{ top: headerBottom }}
      role="dialog"
      aria-modal="false"
      aria-label={ariaLabel}
    >
      <section className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden border-x border-slate-800 bg-slate-950">
        <header className="flex shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-900 p-4">
          <button
            type="button"
            onClick={onClose}
            aria-label="Voltar à Praça"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-700 text-slate-200"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1">
            <span className="text-[11px] font-black uppercase tracking-[0.16em] text-sky-300">Catálogo</span>
            <h2 className="text-lg font-black text-white">{title}</h2>
            <p className="text-xs text-slate-400">{subtitle}</p>
          </div>
        </header>
        <div className="shrink-0 space-y-3 border-b border-slate-800 p-4">
          <label className="block text-xs font-bold text-slate-300" htmlFor={searchId}>
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
                className={`min-h-10 shrink-0 rounded-xl px-4 text-xs font-bold ${
                  selectedTab === id
                    ? 'bg-sky-500/15 text-sky-200'
                    : 'border border-slate-800 bg-slate-900 text-slate-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="flex items-center justify-between gap-3 text-xs text-slate-300">
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
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-12">
          {children}
        </main>
      </section>
    </div>,
    document.body
  );
}
