import { useCallback, useEffect, useRef, useState } from 'react';

export type CursorPage<T> = { items: T[]; nextCursor: string | null };

export const appendUniqueById = <T extends { id: string }>(
  previous: readonly T[], incoming: readonly T[],
): T[] => {
  const seen = new Set(previous.map(item => item.id));
  return [...previous, ...incoming.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  })];
};

/**
 * Shared read-only pagination controller. Every catalogue supplies its own
 * authorization, cursor query and card type; none share an underlying cache.
 */
export const useInfiniteCursor = <T extends { id: string }>(
  enabled: boolean,
  key: string,
  readPage: (cursor: string | null, signal: AbortSignal) => Promise<CursorPage<T>>,
) => {
  const [items, setItems] = useState<T[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const cursorRef = useRef<string | null>(null);
  const enabledRef = useRef(enabled);
  const moreRef = useRef(true);
  const loadingRef = useRef(false);
  const versionRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const readPageRef = useRef(readPage);
  readPageRef.current = readPage;

  const loadMore = useCallback(async () => {
    if (!enabledRef.current || !moreRef.current || loadingRef.current) return;
    const version = versionRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    loadingRef.current = true;
    setLoading(true);
    setError('');
    try {
      const page = await readPageRef.current(cursorRef.current, controller.signal);
      if (controller.signal.aborted || version !== versionRef.current) return;
      setItems(current => appendUniqueById(current, page.items));
      if (page.nextCursor === cursorRef.current && page.nextCursor !== null) {
        throw Error('INVALID_PAGINATION_CURSOR');
      }
      cursorRef.current = page.nextCursor;
      moreRef.current = Boolean(page.nextCursor);
      setHasMore(moreRef.current);
    } catch {
      if (!controller.signal.aborted && version === versionRef.current) {
        setError('Não foi possível carregar mais itens. Tente novamente.');
      }
    } finally {
      if (version === versionRef.current) {
        loadingRef.current = false;
        controllerRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    versionRef.current += 1;
    controllerRef.current?.abort();
    enabledRef.current = enabled;
    cursorRef.current = null;
    moreRef.current = true;
    loadingRef.current = false;
    setItems([]);
    setHasMore(true);
    setLoading(false);
    setError('');
    if (enabled) void loadMore();
    return () => {
      versionRef.current += 1;
      enabledRef.current = false;
      controllerRef.current?.abort();
    };
  }, [enabled, key, loadMore]);

  return { items, loading, hasMore, error, loadMore };
};
