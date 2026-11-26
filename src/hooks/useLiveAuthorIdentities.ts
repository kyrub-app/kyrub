import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../utils/firebase';
import type { AuthorDisplayIdentity } from '../utils/authorDisplayIdentity';

export type LiveAuthorIdentity = AuthorDisplayIdentity;

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
  const [session,setSession]=useState(()=>auth.currentUser);
  const [state,setState]=useState<{session:typeof auth.currentUser;profiles:Record<string,LiveAuthorIdentity>}>(()=>({session:auth.currentUser,profiles:{}}));
  const profiles=state.session===session?state.profiles:{};
  useEffect(()=>auth.onAuthStateChanged(next=>{
    setSession(next);
    setState(previous=>previous.session===next?previous:{session:next,profiles:{}});
  }),[]);

  useEffect(() => {
    if(!session||auth.currentUser!==session)return;
    let active = true;
    const setProfiles=(update:(current:Record<string,LiveAuthorIdentity>)=>Record<string,LiveAuthorIdentity>)=>{
      if(!active||auth.currentUser!==session)return;
      setState(previous=>previous.session===session?{session,profiles:update(previous.profiles)}:previous);
    };
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
        const avatar = data?.isProfileVisible !== true ? ''
          : typeof data?.photoUrl === 'string' ? data.photoUrl.trim() : '';
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
  }, [idsKey,session]);

  return useMemo(() => {
    if(!session||auth.currentUser!==session)return {};
    const permitted = new Set(idsKey ? idsKey.split('|') : []);
    return Object.fromEntries(Object.entries(profiles).filter(([uid]) => permitted.has(uid)));
  }, [idsKey, profiles,session]);
}
