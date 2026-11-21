import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../utils/firebase';

export interface LiveAuthorIdentity {
  name: string;
  avatar: string;
}

const validAuthorId = (id: string): boolean => /^[A-Za-z0-9_-]{1,128}$/.test(id);

/**
 * A post keeps its immutable authorId and historical name snapshot for
 * provenance. The rendered name/avatar can follow the author's current public
 * identity without rewriting posts, forwarding events, comments or receipts.
 *
 * The users directory is readable to authenticated Kyrub accounts under the
 * existing rules. Failed or unavailable lookups leave the saved post snapshot
 * as the fallback. No email or account data enters the UI.
 */
export function useLiveAuthorIdentities(authorIds: readonly string[]): Record<string, LiveAuthorIdentity> {
  const idsKey = [...new Set(authorIds.filter(validAuthorId))].sort().join('|');
  const [profiles, setProfiles] = useState<Record<string, LiveAuthorIdentity>>({});

  useEffect(() => {
    let active = true;
    const ids = idsKey ? idsKey.split('|') : [];
    const permitted = new Set(ids);
    setProfiles(current => {
      const retained = Object.fromEntries(Object.entries(current).filter(([uid]) => permitted.has(uid)));
      return Object.keys(current).length === Object.keys(retained).length ? current : retained;
    });
    const stops = ids.map(uid => onSnapshot(
      doc(db, 'users', uid),
      snapshot => {
        if (!active) return;
        const data = snapshot.data();
        const name = typeof data?.name === 'string' ? data.name.trim().slice(0, 80) : '';
        const avatar = typeof data?.photoUrl === 'string' ? data.photoUrl.trim() : '';
        setProfiles(current => {
          const existing = current[uid];
          if (!name) {
            if (!existing) return current;
            const next = { ...current };
            delete next[uid];
            return next;
          }
          return existing?.name === name && existing.avatar === avatar
            ? current : { ...current, [uid]: { name, avatar } };
        });
      },
      () => {
        // Missing permission or network access must not erase post attribution.
        if (!active) return;
        setProfiles(current => {
          if (!current[uid]) return current;
          const next = { ...current };
          delete next[uid];
          return next;
        });
      },
    ));
    return () => {
      active = false;
      stops.forEach(stop => stop());
    };
  }, [idsKey]);

  return useMemo(() => {
    const permitted = new Set(idsKey ? idsKey.split('|') : []);
    return Object.fromEntries(Object.entries(profiles).filter(([uid]) => permitted.has(uid)));
  }, [idsKey, profiles]);
}
