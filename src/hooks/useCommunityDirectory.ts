import { useEffect, useMemo, useState } from 'react';
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

  // Guest and signed-in views discover the same public community IDs.
  // Hydrate them with an authenticated, server-forced Firestore read so owner
  // and membership semantics remain canonical and cached listeners cannot
  // silently hide older public communities.
  useEffect(() => {
    if (!user) {
      setPublicReconciled([]);
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
        const payload = await response.json() as {
          communities?: Array<{ id?: unknown }>;
        };
        const ids = Array.from(new Set(
          (Array.isArray(payload.communities) ? payload.communities : [])
            .map(entry => typeof entry?.id === 'string' ? entry.id : '')
            .filter((id): id is string => /^[a-zA-Z0-9_-]{1,128}$/.test(id))
        )).slice(0, 30);
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
      discoverable,
      publicReconciled,
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
    memberships,
    loading,
    error,
    activeCommunities: directory.filter(
      community => community.isOwner || community.isActiveMember
    ),
  };
}
