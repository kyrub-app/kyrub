import type { User } from 'firebase/auth';
import {
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  normalizeStoreChallengeDefinition,
  normalizeStoreChallengeDefinitions,
  type StoreChallengeDefinition,
  type StoreChallengeStatus,
} from '../../shared/storeChallenges';
import { db } from './firebase';

const allowedStatusTransitions: Record<
  StoreChallengeStatus,
  ReadonlySet<StoreChallengeStatus>
> = {
  draft: new Set(['draft', 'active', 'cancelled']),
  active: new Set(['active', 'paused', 'ended', 'cancelled']),
  paused: new Set(['paused', 'active', 'ended', 'cancelled']),
  ended: new Set(['ended']),
  cancelled: new Set(['cancelled']),
};

const structuralChallenge = (challenge: StoreChallengeDefinition) => ({
  id: challenge.id,
  storeId: challenge.storeId,
  title: challenge.title,
  description: challenge.description,
  metric: challenge.metric,
  target: challenge.target,
  rewardPoints: challenge.rewardPoints,
  startsAt: challenge.startsAt,
  endsAt: challenge.endsAt,
  createdAt: challenge.createdAt,
});

const assertChallengeUpdateAllowed = (
  previous: StoreChallengeDefinition,
  next: StoreChallengeDefinition
): void => {
  if (!allowedStatusTransitions[previous.status].has(next.status)) {
    throw new Error(
      `Transição de desafio inválida: ${previous.status} → ${next.status}.`
    );
  }

  if (
    previous.status !== 'draft' &&
    JSON.stringify(structuralChallenge(previous)) !==
      JSON.stringify(structuralChallenge(next))
  ) {
    throw new Error(
      'Depois de publicado, a regra do desafio é imutável. Pause ou encerre o desafio atual e crie outro para mudar meta ou recompensa.'
    );
  }
};

export const subscribeToStoreChallenges = (
  storeId: string,
  onChallenges: (challenges: StoreChallengeDefinition[]) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  const normalizedStoreId = storeId.trim();
  if (!normalizedStoreId) {
    onChallenges([]);
    return () => undefined;
  }

  return onSnapshot(
    doc(db, 'tenants', normalizedStoreId),
    snapshot => {
      onChallenges(
        normalizeStoreChallengeDefinitions(snapshot.data()?.storeChallenges)
      );
    },
    error => {
      onChallenges([]);
      onError?.(error);
    }
  );
};

export const persistStoreChallenge = async (
  user: Pick<User, 'uid' | 'email'>,
  input: StoreChallengeDefinition
): Promise<StoreChallengeDefinition> => {
  const challenge = normalizeStoreChallengeDefinition(input);
  if (challenge.storeId !== user.uid) {
    throw new Error('O desafio não pertence à loja autenticada.');
  }

  const tenantReference = doc(db, 'tenants', user.uid);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(tenantReference);
    const currentData = snapshot.data() as Record<string, unknown> | undefined;
    const currentChallenges = normalizeStoreChallengeDefinitions(
      currentData?.storeChallenges
    );
    const previous = currentChallenges.find(item => item.id === challenge.id);

    if (previous) assertChallengeUpdateAllowed(previous, challenge);
    if (!previous && currentChallenges.length >= 50) {
      throw new Error('A loja atingiu o limite de 50 desafios registrados.');
    }

    const nextChallenges = [
      challenge,
      ...currentChallenges.filter(item => item.id !== challenge.id),
    ];

    transaction.set(
      tenantReference,
      {
        id: user.uid,
        ownerId: user.uid,
        email: user.email ?? '',
        storeChallenges: nextChallenges,
        updatedAt: serverTimestamp(),
        ...(snapshot.exists() ? {} : { createdAt: serverTimestamp() }),
      },
      { merge: true }
    );
  });

  return challenge;
};
