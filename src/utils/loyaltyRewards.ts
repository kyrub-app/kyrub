import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from './firebase';
import {
  getBuyerLoyaltyBalance,
  getBuyerLoyaltyLedgerEventPath,
  getLoyaltyLedgerEventPath,
  type LoyaltyLedgerEvent,
} from './loyaltyLedger';

export type LoyaltyRewardType = 'discount' | 'free_product' | 'voucher';
export interface LoyaltyReward {
  id: string; storeId: string; title: string; description: string; type: LoyaltyRewardType;
  pointsCost: number; benefitValue: number; productId: string; productName: string;
  active: boolean; startsAt: string; endsAt: string; createdAt: string; updatedAt: string;
}
export type LoyaltyRewardDraft = Pick<LoyaltyReward,
  'title' | 'description' | 'type' | 'pointsCost' | 'benefitValue' | 'productId' | 'productName' | 'active' | 'startsAt' | 'endsAt'>;

const cleanString = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const cleanInteger = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
};

export const getLoyaltyRewardsCollectionPath = (storeId: string): string =>
  `storeLoyaltyRewards/${storeId.trim()}/items`;
export const getLegacyLoyaltyRewardsCollectionPath = (storeId: string): string =>
  `artifacts/${storeId.trim()}/public/data/loyaltyRewards`;
export const getStoreLoyaltyRewardRedemptionsCollectionPath = (storeId: string): string =>
  `storeLoyaltyRewardRedemptions/${storeId.trim()}/redemptions`;
export const getBuyerLoyaltyRewardRedemptionsCollectionPath = (buyerId: string): string =>
  `users/${buyerId.trim()}/loyaltyRewardRedemptions`;

const parseReward = (value: unknown): LoyaltyReward | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = cleanString(record.id); const storeId = cleanString(record.storeId); const title = cleanString(record.title);
  const type = record.type; const pointsCost = cleanInteger(record.pointsCost);
  if (!id || !storeId || !title || pointsCost < 1) return null;
  if (type !== 'discount' && type !== 'free_product' && type !== 'voucher') return null;
  return {
    id, storeId, title, description: cleanString(record.description), type, pointsCost,
    benefitValue: cleanInteger(record.benefitValue), productId: cleanString(record.productId),
    productName: cleanString(record.productName), active: record.active !== false,
    startsAt: cleanString(record.startsAt), endsAt: cleanString(record.endsAt),
    createdAt: cleanString(record.createdAt), updatedAt: cleanString(record.updatedAt),
  };
};

const parseSnapshot = (docs: Array<{ data: () => unknown }>): LoyaltyReward[] =>
  docs.flatMap(item => { const parsed = parseReward(item.data()); return parsed ? [parsed] : []; })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

export const subscribeToLoyaltyRewards = (
  storeId: string, onRewards: (rewards: LoyaltyReward[]) => void, onError?: (error: Error) => void
): Unsubscribe => {
  const normalized = storeId.trim();
  if (!normalized) { onRewards([]); return () => undefined; }

  let unsubscribeLegacy: Unsubscribe | null = null;
  const unsubscribeCanonical = onSnapshot(
    collection(db, getLoyaltyRewardsCollectionPath(normalized)),
    snapshot => {
      const canonical = parseSnapshot(snapshot.docs);
      unsubscribeLegacy?.();
      unsubscribeLegacy = null;
      if (canonical.length > 0) {
        onRewards(canonical);
        return;
      }
      unsubscribeLegacy = onSnapshot(
        collection(db, getLegacyLoyaltyRewardsCollectionPath(normalized)),
        legacySnapshot => onRewards(parseSnapshot(legacySnapshot.docs)),
        error => { onRewards([]); onError?.(error); }
      );
    },
    error => { onRewards([]); onError?.(error); }
  );

  return () => {
    unsubscribeCanonical();
    unsubscribeLegacy?.();
  };
};

export const saveLoyaltyReward = async (user: Pick<User, 'uid'>, draft: LoyaltyRewardDraft, rewardId = ''): Promise<string> => {
  const storeId = user.uid.trim(); const title = draft.title.trim();
  const pointsCost = Math.max(1, Math.trunc(Number(draft.pointsCost) || 1));
  if (!storeId) throw new Error('Loja não identificada.');
  if (!title) throw new Error('Informe o nome da recompensa.');
  if (draft.startsAt && draft.endsAt && draft.endsAt < draft.startsAt) throw new Error('O fim da recompensa não pode ser anterior ao início.');
  if (draft.type === 'free_product' && !draft.productId.trim()) throw new Error('Selecione o produto da recompensa.');
  const reference = rewardId.trim() ? doc(db, getLoyaltyRewardsCollectionPath(storeId), rewardId.trim()) : doc(collection(db, getLoyaltyRewardsCollectionPath(storeId)));
  const now = new Date().toISOString();
  await setDoc(reference, {
    id: reference.id, storeId, title, description: draft.description.trim(), type: draft.type, pointsCost,
    benefitValue: Math.max(0, Math.trunc(Number(draft.benefitValue) || 0)), productId: draft.productId.trim(),
    productName: draft.productName.trim(), active: draft.active, startsAt: draft.startsAt, endsAt: draft.endsAt,
    ...(rewardId.trim() ? {} : { createdAt: now }), updatedAt: now, recordedAt: serverTimestamp(), schemaVersion: 2,
  }, { merge: true });
  return reference.id;
};

export const setLoyaltyRewardActive = async (user: Pick<User, 'uid'>, reward: LoyaltyReward, active: boolean): Promise<void> => {
  if (reward.storeId !== user.uid) throw new Error('Recompensa pertence a outra loja.');
  await setDoc(doc(db, getLoyaltyRewardsCollectionPath(user.uid), reward.id), { active, updatedAt: new Date().toISOString(), recordedAt: serverTimestamp() }, { merge: true });
};
export const deleteLoyaltyReward = async (user: Pick<User, 'uid'>, reward: LoyaltyReward): Promise<void> => {
  if (reward.storeId !== user.uid) throw new Error('Recompensa pertence a outra loja.');
  await deleteDoc(doc(db, getLoyaltyRewardsCollectionPath(user.uid), reward.id));
};
export const isLoyaltyRewardAvailable = (reward: LoyaltyReward, at = new Date()): boolean => {
  if (!reward.active) return false;
  const time = at.getTime();
  const starts = reward.startsAt ? new Date(`${reward.startsAt}T00:00:00`).getTime() : 0;
  const ends = reward.endsAt ? new Date(`${reward.endsAt}T23:59:59.999`).getTime() : 0;
  return !(starts && Number.isFinite(starts) && time < starts) && !(ends && Number.isFinite(ends) && time > ends);
};

export const redeemLoyaltyReward = async (
  user: Pick<User, 'uid' | 'email'>,
  reward: LoyaltyReward,
  ledgerEvents: LoyaltyLedgerEvent[]
): Promise<{ created: boolean; redemptionId: string }> => {
  if (!isLoyaltyRewardAvailable(reward)) throw new Error('Esta recompensa não está disponível agora.');
  const buyerId = user.uid.trim(); const buyerEmail = (user.email ?? '').trim().toLocaleLowerCase('pt-BR');
  if (!buyerId) throw new Error('Cliente não identificado.');
  const balance = getBuyerLoyaltyBalance(ledgerEvents, buyerId, buyerEmail);
  if (balance < reward.pointsCost) throw new Error('Saldo de pontos insuficiente.');

  const customerKey = buyerId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const redemptionId = `reward-${reward.id}-${customerKey}`;
  const storeRedemptionReference = doc(db, getStoreLoyaltyRewardRedemptionsCollectionPath(reward.storeId), redemptionId);
  const buyerRedemptionReference = doc(db, getBuyerLoyaltyRewardRedemptionsCollectionPath(buyerId), redemptionId);
  const storeLedgerReference = doc(db, getLoyaltyLedgerEventPath(reward.storeId, redemptionId));
  const buyerLedgerReference = doc(db, getBuyerLoyaltyLedgerEventPath(buyerId, reward.storeId, redemptionId));
  let created = false;

  await runTransaction(db, async transaction => {
    const existing = await transaction.get(storeRedemptionReference);
    if (existing.exists()) return;
    const createdAt = new Date().toISOString();
    const redemption = {
      id: redemptionId, storeId: reward.storeId, rewardId: reward.id, rewardTitle: reward.title, rewardType: reward.type,
      buyerId, buyerEmail, pointsCost: reward.pointsCost, benefitValue: reward.benefitValue, productId: reward.productId,
      productName: reward.productName, status: 'issued', createdAt, recordedAt: serverTimestamp(), schemaVersion: 2,
    };
    transaction.set(storeRedemptionReference, redemption);
    transaction.set(buyerRedemptionReference, redemption);
    const adjustment = {
      id: redemptionId, storeId: reward.storeId, buyerId, buyerEmail, orderId: '', type: 'adjustment',
      points: -Math.abs(reward.pointsCost), reason: `Resgate: ${reward.title}`, lines: [], sourceEventId: reward.id,
      createdAt, recordedAt: serverTimestamp(), schemaVersion: 2,
    };
    transaction.set(storeLedgerReference, adjustment);
    transaction.set(buyerLedgerReference, adjustment);
    created = true;
  });
  return { created, redemptionId };
};
