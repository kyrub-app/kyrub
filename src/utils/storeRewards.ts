import type { User } from 'firebase/auth';
import {
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  STORE_REWARD_MAX_DEFINITIONS,
  normalizeStoreRewardDefinition,
  normalizeStoreRewardDefinitions,
  type StoreRewardDefinition,
  type StoreRewardStatus,
} from '../../shared/storeRewards';
import { db } from './firebase';

const allowedTransitions: Record<
  StoreRewardStatus,
  ReadonlySet<StoreRewardStatus>
> = {
  draft: new Set(['draft', 'active', 'ended']),
  active: new Set(['active', 'paused', 'ended']),
  paused: new Set(['paused', 'active', 'ended']),
  ended: new Set(['ended']),
};

const structuralReward = (reward: StoreRewardDefinition) => ({
  id: reward.id,
  storeId: reward.storeId,
  title: reward.title,
  description: reward.description,
  costPoints: reward.costPoints,
  discountType: reward.discountType,
  discountValue: reward.discountValue,
  productIds: reward.productIds,
  voucherValidityHours: reward.voucherValidityHours,
  startsAt: reward.startsAt,
  endsAt: reward.endsAt,
  createdAt: reward.createdAt,
});

const assertRewardUpdateAllowed = (
  previous: StoreRewardDefinition,
  next: StoreRewardDefinition
): void => {
  if (!allowedTransitions[previous.status].has(next.status)) {
    throw new Error(
      `Transição de recompensa inválida: ${previous.status} → ${next.status}.`
    );
  }
  if (
    previous.status !== 'draft' &&
    JSON.stringify(structuralReward(previous)) !==
      JSON.stringify(structuralReward(next))
  ) {
    throw new Error(
      'Depois de publicada, a recompensa é imutável. Encerre a atual e crie outra para mudar custo ou benefício.'
    );
  }
};

export const subscribeToStoreRewards = (
  storeId: string,
  onRewards: (rewards: StoreRewardDefinition[]) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  const normalizedStoreId = storeId.trim();
  if (!normalizedStoreId) {
    onRewards([]);
    return () => undefined;
  }
  return onSnapshot(
    doc(db, 'tenants', normalizedStoreId),
    snapshot => {
      onRewards(normalizeStoreRewardDefinitions(snapshot.data()?.storeRewards));
    },
    error => {
      onRewards([]);
      onError?.(error);
    }
  );
};

export const persistStoreReward = async (
  user: Pick<User, 'uid' | 'email'>,
  input: StoreRewardDefinition
): Promise<StoreRewardDefinition> => {
  const reward = normalizeStoreRewardDefinition(input);
  if (reward.storeId !== user.uid) {
    throw new Error('A recompensa não pertence à loja autenticada.');
  }

  const tenantReference = doc(db, 'tenants', user.uid);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(tenantReference);
    const currentData = snapshot.data() as Record<string, unknown> | undefined;
    const rewards = normalizeStoreRewardDefinitions(currentData?.storeRewards);
    const previous = rewards.find(item => item.id === reward.id);
    if (previous) assertRewardUpdateAllowed(previous, reward);
    if (!previous && rewards.length >= STORE_REWARD_MAX_DEFINITIONS) {
      throw new Error(
        `A loja atingiu o limite de ${STORE_REWARD_MAX_DEFINITIONS} recompensas registradas.`
      );
    }

    transaction.set(
      tenantReference,
      {
        id: user.uid,
        ownerId: user.uid,
        email: user.email ?? '',
        storeRewards: [
          reward,
          ...rewards.filter(item => item.id !== reward.id),
        ],
        updatedAt: serverTimestamp(),
        ...(snapshot.exists() ? {} : { createdAt: serverTimestamp() }),
      },
      { merge: true }
    );
  });

  return reward;
};
