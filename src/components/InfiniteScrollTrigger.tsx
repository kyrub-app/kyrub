import { useEffect, useRef } from 'react';

type InfiniteScrollTriggerProps = {
  hasMore: boolean;
  loading: boolean;
  error: string;
  onLoadMore: () => void;
};

/**
 * Passive loading trigger. The scroll root is the existing Praça catalogue
 * overlay, not the whole window; no numbered pages or next/previous buttons.
 */
export function InfiniteScrollTrigger({
  hasMore, loading, error, onLoadMore,
}: InfiniteScrollTriggerProps) {
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore || loading || error || typeof IntersectionObserver === 'undefined') return;
    const root = node.closest('[data-square-directory-scroll]');
    if (!root) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) onLoadMore();
    }, { root, rootMargin: '280px 0px', threshold: 0 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, error, onLoadMore]);
  return (
    <div ref={sentinel} className="min-h-12 py-3 text-center text-xs text-slate-400"
      role="status" aria-live="polite">
      {error ? (
        <button type="button" onClick={onLoadMore}
          className="min-h-11 rounded-xl border border-slate-700 px-4 font-semibold text-slate-200">
          {error} Repetir
        </button>
      ) : loading ? 'Carregando mais comunidades…'
        : hasMore ? 'Mais comunidades ao rolar…'
          : 'Você chegou ao fim das comunidades carregadas.'}
    </div>
  );
}
