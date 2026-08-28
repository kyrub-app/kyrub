import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from './firebase';

export type LoyaltyChallengeMetric = 'paid_orders' | 'points_earned';

export interface LoyaltyChallenge {
  id: string;
  storeId: string;
  title: string;
  description: string;
  metric: LoyaltyChallengeMetric;
  target: number;
  rewardPoints: number;
  startsAt: string;
  endsAt: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type LoyaltyChallengeDraft = Pick<
  LoyaltyChallenge,
  'title' | 'description' | 'metric' | 'target' | 'rewardPoints' | 'startsAt' | 'endsAt' | 'active'
>;

const cleanString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const cleanInteger = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
};

export const getLoyaltyChallengesCollectionPath = (storeId: string): string =>
  `artifacts/${storeId.trim()}/public/data/loyaltyChallenges`;

const parseChallenge = (value: unknown): LoyaltyChallenge | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = cleanString(record.id);
  const storeId = cleanString(record.storeId);
  const title = cleanString(record.title);
  const metric = record.metric;
  const target = cleanInteger(record.target);
  if (!id || !storeId || !title || target < 1) return null;
  if (metric !== 'paid_orders' && metric !== 'points_earned') return null;
  return {
    id,
    storeId,
    title,
    description: cleanString(record.description),
    metric,
    target,
    rewardPoints: cleanInteger(record.rewardPoints),
    startsAt: cleanString(record.startsAt),
    endsAt: cleanString(record.endsAt),
    active: record.active !== false,
    createdAt: cleanString(record.createdAt),
    updatedAt: cleanString(record.updatedAt),
  };
};

export const subscribeToLoyaltyChallenges = (
  storeId: string,
  onChallenges: (challenges: LoyaltyChallenge[]) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  const normalized = storeId.trim();
  if (!normalized) {
    onChallenges([]);
    return () => undefined;
  }
  return onSnapshot(
    collection(db, getLoyaltyChallengesCollectionPath(normalized)),
    snapshot => {
      const challenges = snapshot.docs
        .flatMap(item => {
          const parsed = parseChallenge(item.data());
          return parsed ? [parsed] : [];
        })
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      onChallenges(challenges);
    },
    error => {
      onChallenges([]);
      onError?.(error);
    }
  );
};

export const saveLoyaltyChallenge = async (
  user: Pick<User, 'uid'>,
  draft: LoyaltyChallengeDraft,
  challengeId = ''
): Promise<string> => {
  const storeId = user.uid.trim();
  if (!storeId) throw new Error('Loja não identificada.');
  const title = draft.title.trim();
  const target = Math.max(1, Math.trunc(Number(draft.target) || 1));
  if (!title) throw new Error('Informe o nome do desafio.');
  if (draft.startsAt && draft.endsAt && draft.endsAt < draft.startsAt) {
    throw new Error('O fim do desafio não pode ser anterior ao início.');
  }

  const reference = challengeId.trim()
    ? doc(db, getLoyaltyChallengesCollectionPath(storeId), challengeId.trim())
    : doc(collection(db, getLoyaltyChallengesCollectionPath(storeId)));
  const now = new Date().toISOString();
  await setDoc(reference, {
    id: reference.id,
    storeId,
    title,
    description: draft.description.trim(),
    metric: draft.metric,
    target,
    rewardPoints: Math.max(0, Math.trunc(Number(draft.rewardPoints) || 0)),
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    active: draft.active,
    createdAt: challengeId.trim() ? undefined : now,
    updatedAt: now,
    recordedAt: serverTimestamp(),
    schemaVersion: 1,
  }, { merge: true });
  return reference.id;
};

export const setLoyaltyChallengeActive = async (
  user: Pick<User, 'uid'>,
  challenge: LoyaltyChallenge,
  active: boolean
): Promise<void> => {
  if (challenge.storeId !== user.uid) throw new Error('Desafio pertence a outra loja.');
  await setDoc(
    doc(db, getLoyaltyChallengesCollectionPath(user.uid), challenge.id),
    { active, updatedAt: new Date().toISOString(), recordedAt: serverTimestamp() },
    { merge: true }
  );
};

export const deleteLoyaltyChallenge = async (
  user: Pick<User, 'uid'>,
  challenge: LoyaltyChallenge
): Promise<void> => {
  if (challenge.storeId !== user.uid) throw new Error('Desafio pertence a outra loja.');
  await deleteDoc(doc(db, getLoyaltyChallengesCollectionPath(user.uid), challenge.id));
};

export const isLoyaltyChallengeAvailable = (
  challenge: LoyaltyChallenge,
  at = new Date()
): boolean => {
  if (!challenge.active) return false;
  const time = at.getTime();
  const starts = challenge.startsAt ? new Date(challenge.startsAt).getTime() : 0;
  const ends = challenge.endsAt ? new Date(challenge.endsAt).getTime() : 0;
  if (starts && Number.isFinite(starts) && time < starts) return false;
  if (ends && Number.isFinite(ends) && time > ends) return false;
  return true;
};
