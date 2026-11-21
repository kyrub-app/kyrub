import { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  getCommunity,
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

export function useCommunityDirectory() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [discoverable, setDiscoverable] = useState<CloudCommunity[]>([]);
  const [publicReconciled, setPublicReconciled] = useState<CloudCommunity[]>([]);
  const [publicCommunities, setPublicCommunities] = useState<PublicDirectoryCommunity[]>([]);
  const knownPublicIdsRef = useRef<Set<string>>(new Set());
  const [owned, setOwned] = useState<CloudCommunity[]>([]);
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
      setPrivateMembershipCommunities([]);
      setMemberships([]);
      setError('');
      setLoading(Boolean(currentUser));
    }), []);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    let discoverableReady = false;
    let ownedReady = false;
    let membershipsReady = false;
    const updateLoading = () =>
      setLoading(!(discoverableReady && ownedReady && membershipsReady));
    const reportError = (value: Error) => {
      console.warn('Não foi possível sincronizar as comunidades.', value);
      setError('Não foi possível sincronizar todas as comunidades agora.');
    };

    const unsubscribeDiscoverable = subscribeDiscoverableCommunities(
      communities => {
        discoverableReady = true;
        setDiscoverable(communities);
        updateLoading();
      },
      errorValue => {
        discoverableReady = true;
        reportError(errorValue);
        updateLoading();
      }
    );
    const unsubscribeOwned = subscribeOwnedCommunities(
      user.uid,
      communities => {
        ownedReady = true;
        setOwned(communities);
        updateLoading();
      },
      errorValue => {
        ownedReady = true;
        reportError(errorValue);
        updateLoading();
      }
    );
    const unsubscribeMemberships = subscribeUserMemberships(
      user.uid,
      values => {
        membershipsReady = true;
        setMemberships(values);
        updateLoading();
      },
      errorValue => {
        membershipsReady = true;
        reportError(errorValue);
        updateLoading();
      }
    );

    return () => {
      unsubscribeDiscoverable();
      unsubscribeOwned();
      unsubscribeMemberships();
    };
  }, [user]);

  useEffect(() => {
    knownPublicIdsRef.current = new Set(
      [...discoverable, ...owned].map(community => community.id)
    );
  }, [discoverable, owned]);

  // Guests and signed-in users discover the same public community IDs.
  // Recover missing public records with the authenticated Firestore Lite reader
  // (no persistent listener cache). Full SDK listeners remain responsible for
  // membership, private communities, and mutations; permissions are unchanged.
  useEffect(() => {
    if (!user) {
      setPublicReconciled([]);
      setPublicCommunities([]);
      return;
    }
    let active = true;
    let running = false;
    const controller = new AbortController();
    const refreshPublic = async () => {
      if (running) return;
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
        if (active) setPublicCommunities(cards);
        const ids = [...new Set(cards.map(item => item.id))]
          .filter(id => !knownPublicIdsRef.current.has(id));
        const settled = await Promise.allSettled(
          ids.map(id => getPublicCommunityFromServer(id))
        );
        if (!active) return;
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
    const interval = window.setInterval(() => void refreshPublic(), 5 * 60 * 1000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [user]);

  useEffect(() => {
    if (!user || memberships.length === 0) {
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
        if (cancelled) return;
        setPrivateMembershipCommunities(
          values.filter((value): value is CloudCommunity => Boolean(value))
        );
      })
      .catch(value => {
        if (cancelled) return;
        console.warn('Não foi possível carregar comunidades privadas.', value);
      });
    return () => {
      cancelled = true;
    };
  }, [discoverable, memberships, owned, user]);

  const directory = useMemo<CommunityDirectoryItem[]>(() => {
    const membershipByCommunity = new Map(
      memberships.map(membership => [membership.communityId, membership])
    );
    return mergeCommunities(
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
  }, [discoverable, publicReconciled, memberships, owned, privateMembershipCommunities, user]);

  return {
    user,
    communities: directory,
    publicCommunities,
    memberships,
    loading,
    error,
    activeCommunities: directory.filter(
      community => community.isOwner || community.isActiveMember
    ),
  };
}
