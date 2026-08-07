import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  getCommunity,
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
  }, [discoverable, memberships, owned, privateMembershipCommunities, user]);

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
