import { adminDb } from '../firebaseAdmin.js';
import {
  isStoreRewardAvailableAt,
  normalizeStoreRewardDefinitions,
  storeRewardVoucherEndsAt,
  type StoreRewardDefinition,
} from '../../shared/storeRewards.js';
import {
  STORE_POINTS_CURRENCY,
  buildStorePointRedemptionEntry,
  deriveStorePointBalance,
  type StorePointLedgerEntry,
} from '../../shared/storePoints.js';
import {
  normalizeStorePromotion,
  type StorePromotion,
} from '../../src/utils/storePromotions.js';

export interface PublicStoreReward {
  id: string;
  title: string;
  description: string;
  costPoints: number;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  productIds: string[];
  endsAt: string;
}

export interface StoreRewardRedemptionResult {
  redemptionId: string;
  rewardId: string;
  storeId: string;
  customerId: string;
  costPoints: number;
  balanceBefore: number;
  balanceAfter: number;
  voucherCode: string;
  voucherPromotionId: string;
  voucherEndsAt: string;
  duplicate: boolean;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const token = (value: string): string =>
  Buffer.from(value).toString('base64url');

const ledgerCollectionPath = (storeId: string): string =>
  `stores/${storeId}/storePointLedger`;

const ledgerPath = (storeId: string, entryId: string): string =>
  `${ledgerCollectionPath(storeId)}/${token(entryId)}`;

const redemptionId = (rewardId: string, customerId: string): string =>
  `reward:${rewardId}:customer:${customerId}`;

const redemptionPath = (storeId: string, id: string): string =>
  `stores/${storeId}/rewardRedemptions/${token(id)}`;

const promotionPath = (storeId: string, id: string): string =>
  `stores/${storeId}/promotions/${token(id)}`;

const rewardVoucherCode = (rewardId: string, customerId: string): string =>
  `RWD-${token(`${rewardId}:${customerId}`).slice(0, 32).toUpperCase()}`;

const readRewardFromTenant = (
  value: unknown,
  storeId: string,
  rewardId: string
): StoreRewardDefinition | null =>
  normalizeStoreRewardDefinitions(value).find(
    reward => reward.storeId === storeId && reward.id === rewardId
  ) ?? null;

const readLedgerEntries = (
  storeId: string,
  customerId: string,
  docs: Array<{ data(): FirebaseFirestore.DocumentData }>
): Pick<StorePointLedgerEntry, 'amount'>[] =>
  docs.map(document => {
    const data = document.data() as Partial<StorePointLedgerEntry>;
    if (
      data.storeId !== storeId ||
      data.customerId !== customerId ||
      data.currency !== STORE_POINTS_CURRENCY ||
      !Number.isSafeInteger(data.amount)
    ) {
      throw new Error('STORE_REWARD_LEDGER_INVALID');
    }
    return { amount: data.amount as number };
  });

const buildVoucherPromotion = (input: {
  reward: StoreRewardDefinition;
  customerId: string;
  redemptionId: string;
  redeemedAt: string;
}): StorePromotion => {
  const endsAt = storeRewardVoucherEndsAt(input.reward, input.redeemedAt);
  return normalizeStorePromotion({
    id: `reward-voucher:${input.redemptionId}`,
    storeId: input.reward.storeId,
    code: rewardVoucherCode(input.reward.id, input.customerId),
    title: input.reward.title,
    badge:
      input.reward.discountType === 'percentage'
        ? `${input.reward.discountValue}% OFF`
        : 'RECOMPENSA',
    discountType: input.reward.discountType,
    discountValue: input.reward.discountValue,
    productIds: input.reward.productIds,
    eligibility: {
      mode: 'specific_user',
      userIds: [input.customerId],
    },
    active: true,
    startsAt: input.redeemedAt,
    endsAt,
    maxRedemptions: 1,
    maxRedemptionsPerBuyer: 1,
    redemptionCount: 0,
    createdBy: input.customerId,
    createdVia: 'api',
    actionId: input.redemptionId,
    createdAt: input.redeemedAt,
    updatedAt: input.redeemedAt,
  });
};

export const listAvailableStoreRewards = async (
  storeIdInput: string,
  now = new Date()
): Promise<PublicStoreReward[]> => {
  const storeId = clean(storeIdInput);
  if (!storeId) return [];
  const snapshot = await adminDb.doc(`tenants/${storeId}`).get();
  const occurredAt = now.toISOString();
  return normalizeStoreRewardDefinitions(snapshot.data()?.storeRewards).flatMap(
    reward =>
      reward.storeId === storeId && isStoreRewardAvailableAt(reward, occurredAt)
        ? [{
            id: reward.id,
            title: reward.title,
            description: reward.description,
            costPoints: reward.costPoints,
            discountType: reward.discountType,
            discountValue: reward.discountValue,
            productIds: reward.productIds,
            endsAt: reward.endsAt,
          } satisfies PublicStoreReward]
        : []
  );
};

export const redeemStoreReward = async (input: {
  storeId: string;
  rewardId: string;
  customerId: string;
  occurredAt?: string;
}): Promise<StoreRewardRedemptionResult> => {
  const storeId = clean(input.storeId);
  const rewardId = clean(input.rewardId);
  const customerId = clean(input.customerId);
  if (!storeId || !rewardId || !customerId) {
    throw new Error('STORE_REWARD_REDEMPTION_REQUIRED');
  }
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(occurredAt))) {
    throw new Error('STORE_REWARD_REDEEMED_AT_INVALID');
  }

  const id = redemptionId(rewardId, customerId);
  const redemptionRef = adminDb.doc(redemptionPath(storeId, id));
  const tenantRef = adminDb.doc(`tenants/${storeId}`);

  return adminDb.runTransaction(async transaction => {
    const [existingRedemption, tenantSnapshot] = await Promise.all([
      transaction.get(redemptionRef),
      transaction.get(tenantRef),
    ]);

    if (existingRedemption.exists) {
      const data = existingRedemption.data() as StoreRewardRedemptionResult;
      if (
        data.redemptionId !== id ||
        data.rewardId !== rewardId ||
        data.storeId !== storeId ||
        data.customerId !== customerId
      ) {
        throw new Error('STORE_REWARD_REDEMPTION_CONFLICT');
      }
      return { ...data, duplicate: true };
    }

    const reward = readRewardFromTenant(
      tenantSnapshot.data()?.storeRewards,
      storeId,
      rewardId
    );
    if (!reward) throw new Error('STORE_REWARD_NOT_FOUND');
    if (!isStoreRewardAvailableAt(reward, occurredAt)) {
      throw new Error('STORE_REWARD_NOT_AVAILABLE');
    }

    const ledgerQuery = adminDb
      .collection(ledgerCollectionPath(storeId))
      .where('customerId', '==', customerId);
    const ledgerSnapshot = await transaction.get(ledgerQuery);
    const entries = readLedgerEntries(
      storeId,
      customerId,
      ledgerSnapshot.docs
    );
    const balanceBefore = deriveStorePointBalance(entries);
    if (balanceBefore < reward.costPoints) {
      throw new Error('STORE_REWARD_INSUFFICIENT_POINTS');
    }

    const debitEntry = buildStorePointRedemptionEntry({
      redemptionId: id,
      rewardId: reward.id,
      storeId,
      customerId,
      costPoints: reward.costPoints,
      occurredAt,
    });
    const debitRef = adminDb.doc(ledgerPath(storeId, debitEntry.id));
    const voucher = buildVoucherPromotion({
      reward,
      customerId,
      redemptionId: id,
      redeemedAt: occurredAt,
    });
    const voucherRef = adminDb.doc(promotionPath(storeId, voucher.id));
    const [debitSnapshot, voucherSnapshot] = await Promise.all([
      transaction.get(debitRef),
      transaction.get(voucherRef),
    ]);
    if (debitSnapshot.exists || voucherSnapshot.exists) {
      throw new Error('STORE_REWARD_REDEMPTION_CONFLICT');
    }

    const result: StoreRewardRedemptionResult = {
      redemptionId: id,
      rewardId: reward.id,
      storeId,
      customerId,
      costPoints: reward.costPoints,
      balanceBefore,
      balanceAfter: balanceBefore - reward.costPoints,
      voucherCode: voucher.code,
      voucherPromotionId: voucher.id,
      voucherEndsAt: voucher.endsAt,
      duplicate: false,
    };

    transaction.set(debitRef, debitEntry);
    transaction.set(voucherRef, voucher);
    transaction.set(redemptionRef, {
      ...result,
      rewardSnapshot: reward,
      redeemedAt: occurredAt,
      debitEntryId: debitEntry.id,
    });
    return result;
  });
};
