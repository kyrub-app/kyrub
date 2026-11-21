import { useCallback, useEffect, useState } from 'react';
import { auth } from '../utils/firebase';
import type { PlatformChallengeCatalog } from '../../shared/platformChallengeCatalog';

export function usePlatformChallenges(enabled: boolean) {
  const [catalog, setCatalog] = useState<PlatformChallengeCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const load = async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw Error('AUTH_REQUIRED');
        const response = await fetch('/api/action-execute?transport=global-challenge-catalog', {
          method: 'GET',
          cache: 'no-store',
          headers: { authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!response.ok) throw Error('CATALOG_UNAVAILABLE');
        const data: unknown = await response.json();
        if (!data || typeof data !== 'object' ||
            !('challenges' in data) || !Array.isArray(data.challenges) ||
            !('availableCount' in data) || typeof data.availableCount !== 'number' ||
            !('completedCount' in data) || typeof data.completedCount !== 'number') {
          throw Error('CATALOG_INVALID');
        }
        if (!controller.signal.aborted) setCatalog(data as PlatformChallengeCatalog);
      } catch {
        if (!controller.signal.aborted) {
          setCatalog(null);
          setError('Não foi possível carregar os desafios. Tente novamente.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [enabled, revision]);

  return { catalog, loading, error, retry };
}
