import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  getCommunity,
  getOwnedCommunitiesFromServer,
  getPublicCommunityFromServer,
  subscribeDiscoverableCommunities,
  subscribeOwnedCommunities,
  subscribeUserMemberships,
  type CloudCommunity,
  type CloudCommunityMembership,
} from '../utils/communityCloud';
import { auth } from '../utils/firebase';

export interface CommunityDirectoryItem extends CloudCommunity {
  membership: CloudCommunityMembership | null;
  isOwner: boolean;
  isActiveMember: boolean;
  isPendingMember: boolean;
}

/** Public discovery metadata only. Does not imply membership, ownership,
 * access to private posts or permission to administer the community. */
export interface PublicDirectoryCommunity {
  id: string;
  name: string;
  description: string;
  category: string;
  coverImage: string;
  visibility: 'public' | 'moderated';
  memberCount: number;
}

const parsePublicDirectoryCommunity = (input: unknown): PublicDirectoryCommunity | null => {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  if (typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.id) ||
      typeof value.name !== 'string' || !value.name.trim() ||
      (value.visibility !== 'public' && value.visibility !== 'moderated')) return null;
  return {
    id: value.id,
    name: value.name.slice(0, 80),
    description: typeof value.description === 'string' ? value.description.slice(0, 500) : '',
    category: typeof value.category === 'string' ? value.category.slice(0, 80) : '',
    coverImage: typeof value.coverImage === 'string' && /^https:\/\//.test(value.coverImage)
      ? value.coverImage.slice(0, 2048) : '',
    visibility: value.visibility,
    memberCount: typeof value.memberCount === 'number' && Number.isInteger(value.memberCount)
      ? Math.max(0, value.memberCount) : 0,
  };
};

const mergeCommunities = (...sources: CloudCommunity[][]): CloudCommunity[] => {
  const byId = new Map<string, CloudCommunity>();
  for (const community of sources.flat()) byId.set(community.id, community);
  return [...byId.values()].sort(
    (left, right) => Date.parse(right.activityAt) - Date.parse(left.activityAt)
  );
};

export function useCommunityDirectory(enabled = true) {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [discoverable, setDiscoverable] = useState<CloudCommunity[]>([]);
  const [publicReconciled, setPublicReconciled] = useState<CloudCommunity[]>([]);
  const [publicCommunities, setPublicCommunities] = useState<PublicDirectoryCommunity[]>([]);
  const knownPublicIdsRef = useRef<Set<string>>(new Set());
  const [owned, setOwned] = useState<CloudCommunity[]>([]);
  // A successful batch.commit() is authoritative even if the listener misses
  // its first snapshot; keep its result visible until the next login.
  const [committedCreated, setCommittedCreated] = useState<CloudCommunity[]>([]);
  const [ownedReconciled, setOwnedReconciled] = useState<CloudCommunity[]>([]);
  const [privateMembershipCommunities, setPrivateMembershipCommunities] =
    useState<CloudCommunity[]>([]);
  const [memberships, setMemberships] = useState<
    CloudCommunityMembership[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() =>
    onAuthStateChanged(auth, currentUser => {
      setUser(currentUser);
      setDiscoverable([]);
      setPublicReconciled([]);
      setPublicCommunities([]);
      setOwned([]);
      setCommittedCreated([]);
      setOwnedReconciled([]);
      setPrivateMembershipCommunities([]);
      setMemberships([]);
      setError('');
      setLoading(Boolean(currentUser));
    }), []);

  useEffect(() => {
    if (!user || !enabled) {
      setLoading(false);
      setDiscoverable([]);
      setOwned([]);
      setMemberships([]);
      setError('');
      return;
    }

    let active = true;
    const isCurrent = () => active && auth.currentUser === user;
    setLoading(true);
    let discoverableReady = false;
    let ownedReady = false;
    let membershipsReady = false;
    const updateLoading = () =>
      { if (isCurrent()) setLoading(!(discoverableReady && ownedReady && membershipsReady)); };
    const reportError = (value: Error) => {
      if (!isCurrent()) return;
      console.warn('Não foi possível sincronizar as comunidades.', value);
      setError('Não foi possível sincronizar todas as comunidades agora.');
    };

    const unsubscribeDiscoverable = subscribeDiscoverableCommunities(
      communities => {
        if (!isCurrent()) return;
        discoverableReady = true;
        setDiscoverable(communities);
        updateLoading();
      },
      errorValue => {
        if (!isCurrent()) return;
        discoverableReady = true;
        reportError(errorValue);
        updateLoading();
      }
    );
    const unsubscribeOwned = subscribeOwnedCommunities(
      user.uid,
      communities => {
        if (!isCurrent()) return;
        ownedReady = true;
        setOwned(communities);
        updateLoading();
      },
      errorValue => {
        if (!isCurrent()) return;
        ownedReady = true;
        reportError(errorValue);
        updateLoading();
      }
    );
    const unsubscribeMemberships = subscribeUserMemberships(
      user.uid,
      values => {
        if (!isCurrent()) return;
        membershipsReady = true;
        setMemberships(values);
        updateLoading();
      },
      errorValue => {
        if (!isCurrent()) return;
        membershipsReady = true;
        reportError(errorValue);
        updateLoading();
      }
    );

    return () => {
      active = false;
      unsubscribeDiscoverable();
      unsubscribeOwned();
      unsubscribeMemberships();
    };
  }, [user, enabled]);

  useEffect(() => {
    knownPublicIdsRef.current = new Set(
      [...discoverable, ...owned].map(community => community.id)
    );
  }, [discoverable, owned]);

  // Registration uses only a successfully committed community, never a
  // speculative optimistic write. No second document or mutation is created.
  const registerCommittedCommunity = useCallback((community: CloudCommunity) => {
    if (!auth.currentUser || auth.currentUser.uid !== community.ownerId) return;
    setCommittedCreated(previous =>
      [...previous.filter(item => item.id !== community.id), community]
    );
  }, []);

  // The SDK's persistent multi-tab listener once omitted a valid old public
  // community. Recover *owned* IDs directly via Lite on login, focus and a
  // bounded refresh, including private communities absent from the Praça API.
  // This never clears IndexedDB or changes offline behavior.
  useEffect(() => {
    if (!user || !enabled) {
      setOwnedReconciled([]);
      return;
    }
    let active = true;
    let running = false;
    const refreshOwned = async () => {
      if (running || !active || auth.currentUser !== user || document.visibilityState === 'hidden') return;
      running = true;
      try {
        const values = await getOwnedCommunitiesFromServer(user);
        if (active && auth.currentUser === user) setOwnedReconciled(values);
      } catch {
        // Preserve existing entries when temporarily offline.
      } finally {
        running = false;
      }
    };
    void refreshOwned();
    const onFocus = () => { void refreshOwned(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    const interval = window.setInterval(onFocus, 5 * 60 * 1000);
    return () => {
      active = false;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      window.clearInterval(interval);
    };
  }, [user, enabled]);



  // Guests and signed-in users discover the same public community IDs.
  // Recover missing public records with the authenticated Firestore Lite reader
  // (no persistent listener cache). Full SDK listeners remain responsible for
  // membership, private communities, and mutations; permissions are unchanged.
  useEffect(() => {
    if (!user || !enabled) {
      setPublicReconciled([]);
      setPublicCommunities([]);
      return;
    }
    let active = true;
    let running = false;
    const controller = new AbortController();
    const refreshPublic = async () => {
      if (running || !active || auth.currentUser !== user || document.visibilityState === 'hidden') return;
      running = true;
      try {
        const response = await fetch('/api/square/public', {
          cache: 'no-store',
          headers: { accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) throw Error('PUBLIC_COMMUNITY_DISCOVERY_UNAVAILABLE');
        const payload = await response.json() as { communities?: unknown };
        // The public API is the canonical source of discoverable card IDs for
        // both sessions. A missing authenticated Firestore record may still be
        // shown as public, read-only metadata instead of silently disappearing.
        const cards = (Array.isArray(payload.communities) ? payload.communities : [])
          .map(parsePublicDirectoryCommunity)
          .filter((item): item is PublicDirectoryCommunity => item !== null)
          .slice(0, 30);
        if (!active || auth.currentUser !== user) return;
        setPublicCommunities(cards);
        const ids = [...new Set(cards.map(item => item.id))]
          .filter(id => !knownPublicIdsRef.current.has(id));
        const settled = await Promise.allSettled(
          ids.map(id => getPublicCommunityFromServer(id))
        );
        if (!active || auth.currentUser !== user) return;
        setPublicReconciled(settled.flatMap(item =>
          item.status === 'fulfilled' && item.value ? [item.value] : []
        ));
        if (settled.some(item => item.status === 'rejected')) {
          console.warn('Algumas comunidades públicas não puderam ser sincronizadas com o Firestore.');
        }
      } catch (cause) {
        if (active && !controller.signal.aborted) {
          console.warn('Reconciliação de comunidades públicas indisponível; consulta autenticada preservada.', cause);
        }
      } finally {
        running = false;
      }
    };
    void refreshPublic();
    const onVisible = () => { void refreshPublic(); };
    document.addEventListener('visibilitychange', onVisible);
    const interval = window.setInterval(onVisible, 5 * 60 * 1000);
    return () => {
      active = false;
      controller.abort();
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(interval);
    };
  }, [user, enabled]);

  useEffect(() => {
    if (!enabled || !user || memberships.length === 0) {
      setPrivateMembershipCommunities([]);
      return;
    }
    const visibleIds = new Set(
      [...discoverable, ...owned].map(community => community.id)
    );
    const missingIds = Array.from(
      new Set(
        memberships
          .map(membership => membership.communityId)
          .filter(communityId => !visibleIds.has(communityId))
      )
    );
    if (missingIds.length === 0) {
      setPrivateMembershipCommunities([]);
      return;
    }

    let cancelled = false;
    Promise.all(missingIds.map(getCommunity))
      .then(values => {
        if (cancelled || auth.currentUser !== user) return;
        setPrivateMembershipCommunities(
          values.filter((value): value is CloudCommunity => Boolean(value))
        );
      })
      .catch(value => {
        if (cancelled || auth.currentUser !== user) return;
        console.warn('Não foi possível carregar comunidades privadas.', value);
      });
    return () => {
      cancelled = true;
    };
  }, [discoverable, memberships, owned, user, enabled]);

  const directory = useMemo<CommunityDirectoryItem[]>(() => {
    const membershipByCommunity = new Map(
      memberships.map(membership => [membership.communityId, membership])
    );
    // Lite repairs missing records, but a live SDK snapshot takes priority
    // for edits and membership-triggered updates already visible in the UI.
    return mergeCommunities(
      committedCreated,
      ownedReconciled,
      publicReconciled,
      discoverable,
      owned,
      privateMembershipCommunities
    ).map(community => {
      const membership = membershipByCommunity.get(community.id) ?? null;
      return {
        ...community,
        membership,
        isOwner: community.ownerId === user?.uid,
        isActiveMember: membership?.status === 'active',
        isPendingMember: membership?.status === 'pending',
      };
    });
  }, [committedCreated, discoverable, publicReconciled, memberships, owned, ownedReconciled, privateMembershipCommunities, user]);

  return {
    user,
    communities: directory,
    registerCommittedCommunity,
    publicCommunities,
    memberships,
    loading,
    error,
    activeCommunities: (enabled && user === auth.currentUser ? directory : []).filter(
      community => community.isOwner || community.isActiveMember
    ),
  };
}
