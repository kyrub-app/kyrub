import { useCallback, useEffect, useState } from 'react';
import { subscribeRewardRefresh } from '../utils/rewardRefresh';
import { auth } from '../utils/firebase';
import type { PlatformChallengeCatalog } from '../../shared/platformChallengeCatalog';

export function usePlatformChallenges(enabled: boolean, expectedViewerId?: string) {
  const [result, setResult] = useState<{uid:string;session:NonNullable<typeof auth.currentUser>;catalog:PlatformChallengeCatalog}|null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    if (!enabled) return;
    const session=auth.currentUser;
    const uid = session?.uid;
    setResult(null);
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const load = async () => {
      try {
        if(!session||auth.currentUser!==session||!uid || (expectedViewerId!==undefined && uid!==expectedViewerId)) throw Error('AUTH_REQUIRED');
        const token = await auth.currentUser?.getIdToken();
        if (!token || auth.currentUser!==session||auth.currentUser?.uid!==uid || controller.signal.aborted) throw Error('AUTH_REQUIRED');
        const response = await fetch('/api/action-execute?transport=global-challenge-catalog', {
          method: 'GET',
          cache: 'no-store',
          credentials:'omit',redirect:'error',
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
        if(auth.currentUser!==session||auth.currentUser?.uid!==uid)throw Error('AUTH_CHANGED');
        if (!controller.signal.aborted) setResult({uid,session,catalog:data as PlatformChallengeCatalog});
      } catch {
        if (!controller.signal.aborted) {
          setResult(null);
          setError('Não foi possível carregar os desafios. Tente novamente.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    const unsubscribe=session?subscribeRewardRefresh(session,()=>!controller.signal.aborted&&auth.currentUser===session,reason=>{if(reason!=='conversion')retry();}):()=>{};
    return () => {controller.abort();unsubscribe();};
  }, [enabled, revision, expectedViewerId,retry]);

  const catalog = enabled && result && result.session===auth.currentUser && result.uid===auth.currentUser?.uid && (expectedViewerId===undefined || result.uid===expectedViewerId) ? result.catalog : null;
  return { catalog, loading, error, retry };
}
