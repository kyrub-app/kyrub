import type { DocumentData, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  normalizeStoreChallengeDefinitions,
  type StoreChallengeProgress,
} from '../../shared/storeChallenges.js';
import {
  STORE_POINTS_CURRENCY,
  deriveStorePointBalance,
  type StorePointLedgerEntry,
} from '../../shared/storePoints.js';
import {
  isStoreRewardAvailableAt,
  normalizeStoreRewardDefinition,
  normalizeStoreRewardDefinitions,
  type StoreRewardDefinition,
} from '../../shared/storeRewards.js';
import {
  STORE_RELATIONSHIP_SCHEMA_VERSION,
  deriveStoreRelationshipLevel,
  relationshipProgressPercent,
  type StoreRelationshipChallengeSummary,
  type StoreRelationshipHistoryItem,
  type StoreRelationshipRewardSummary,
  type StoreRelationshipSummary,
  type StoreRelationshipVoucherSummary,
} from '../../shared/storeRelationship.js';
import { listPublicStorePromotions } from './storePromotionService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finiteIso = (value: unknown): string => {
  const normalized = clean(value);
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : '';
};

const ledgerCollectionPath = (storeId: string): string =>
  `stores/${storeId}/storePointLedger`;

const challengeProgressCollectionPath = (storeId: string): string =>
  `stores/${storeId}/challengeProgress`;

const rewardRedemptionCollectionPath = (storeId: string): string =>
  `stores/${storeId}/rewardRedemptions`;

const promotionPath = (storeId: string, promotionId: string): string =>
  `stores/${storeId}/promotions/${promotionId}`;

interface RewardRedemptionRecord {
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
  redeemedAt: string;
  debitEntryId: string;
  rewardSnapshot?: unknown;
}

const parseLedgerEntries = (
  docs: readonly QueryDocumentSnapshot<DocumentData>[],
  storeId: string,
  customerId: string
): StorePointLedgerEntry[] =>
  docs.map(document => {
    const entry = document.data() as Partial<StorePointLedgerEntry>;
    if (
      entry.schemaVersion !== 1 ||
      entry.currency !== STORE_POINTS_CURRENCY ||
      entry.storeId !== storeId ||
      entry.customerId !== customerId ||
      (entry.kind !== 'purchase_base' &&
        entry.kind !== 'bonus' &&
        entry.kind !== 'reversal' &&
        entry.kind !== 'redemption') ||
      !Number.isSafeInteger(entry.amount) ||
      !clean(entry.id) ||
      !finiteIso(entry.occurredAt)
    ) {
      throw new Error('STORE_RELATIONSHIP_LEDGER_INVALID');
    }
    return entry as StorePointLedgerEntry;
  });

const parseRewardRedemptions = (
  docs: readonly QueryDocumentSnapshot<DocumentData>[],
  storeId: string,
  customerId: string
): RewardRedemptionRecord[] =>
  docs.map(document => {
    const value = document.data() as Partial<RewardRedemptionRecord>;
    if (
      value.storeId !== storeId ||
      value.customerId !== customerId ||
      !clean(value.redemptionId) ||
      !clean(value.rewardId) ||
      !clean(value.voucherCode) ||
      !clean(value.voucherPromotionId) ||
      !finiteIso(value.voucherEndsAt) ||
      !Number.isSafeInteger(value.costPoints) ||
      Number(value.costPoints) <= 0
    ) {
      throw new Error('STORE_RELATIONSHIP_REDEMPTION_INVALID');
    }
    return {
      ...value,
      redeemedAt: finiteIso(value.redeemedAt),
      debitEntryId: clean(value.debitEntryId),
    } as RewardRedemptionRecord;
  });

const fullyReversedPurchaseIds = (
  entries: StorePointLedgerEntry[]
): Set<string> => {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const reversed = new Set<string>();
  for (const entry of entries) {
    if (entry.kind !== 'reversal' || !entry.reversalOf) continue;
    const original = byId.get(entry.reversalOf);
    if (
      original?.kind === 'purchase_base' &&
      entry.amount === -Math.abs(original.amount)
    ) {
      reversed.add(original.id);
    }
  }
  return reversed;
};

const qualifiedEarnedPoints = (entries: StorePointLedgerEntry[]): number => {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  let total = 0;
  for (const entry of entries) {
    if (entry.kind === 'purchase_base' || entry.kind === 'bonus') {
      total += entry.amount;
      continue;
    }
    if (entry.kind === 'reversal' && entry.reversalOf) {
      const original = byId.get(entry.reversalOf);
      if (original?.kind === 'purchase_base' || original?.kind === 'bonus') {
        total += entry.amount;
      }
    }
  }
  if (!Number.isSafeInteger(total)) {
    throw new Error('STORE_RELATIONSHIP_EARNED_POINTS_INVALID');
  }
  return Math.max(0, total);
};

const netRedeemedPoints = (entries: StorePointLedgerEntry[]): number => {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  let total = 0;
  for (const entry of entries) {
    if (entry.kind === 'redemption') {
      total += Math.abs(entry.amount);
      continue;
    }
    if (entry.kind === 'reversal' && entry.reversalOf) {
      const original = byId.get(entry.reversalOf);
      if (original?.kind === 'redemption') total -= Math.abs(entry.amount);
    }
  }
  if (!Number.isSafeInteger(total)) {
    throw new Error('STORE_RELATIONSHIP_REDEEMED_POINTS_INVALID');
  }
  return Math.max(0, total);
};

const historyItem = (
  entry: StorePointLedgerEntry,
  byId: Map<string, StorePointLedgerEntry>
): StoreRelationshipHistoryItem => {
  if (entry.kind === 'purchase_base') {
    return {
      id: entry.id,
      kind: 'purchase_points',
      amount: entry.amount,
      label: 'Pontos por compra confirmada',
      occurredAt: entry.occurredAt,
      orderId: entry.orderId,
    };
  }
  if (entry.kind === 'bonus') {
    return {
      id: entry.id,
      kind: 'bonus_points',
      amount: entry.amount,
      label: entry.reason.startsWith('challenge_completed:')
        ? 'Bônus por desafio concluído'
        : 'Bônus de Pontos da Loja',
      occurredAt: entry.occurredAt,
      orderId: entry.orderId,
    };
  }
  if (entry.kind === 'redemption') {
    return {
      id: entry.id,
      kind: 'reward_redemption',
      amount: entry.amount,
      label: 'Resgate de recompensa',
      occurredAt: entry.occurredAt,
      orderId: entry.orderId,
    };
  }

  const original = entry.reversalOf ? byId.get(entry.reversalOf) : undefined;
  let label = 'Ajuste de Pontos da Loja';
  if (original?.kind === 'redemption') label = 'Estorno de resgate';
  else if (entry.reason === 'payment_refunded') label = 'Estorno por reembolso';
  else if (entry.reason.startsWith('challenge_progress_refunded:')) {
    label = 'Ajuste de desafio por reembolso';
  }
  return {
    id: entry.id,
    kind: 'points_reversal',
    amount: entry.amount,
    label,
    occurredAt: entry.occurredAt,
    orderId: entry.orderId,
  };
};

const challengeSummaries = (
  definitionsValue: unknown,
  progressDocs: readonly QueryDocumentSnapshot<DocumentData>[],
  storeId: string,
  customerId: string
): StoreRelationshipChallengeSummary[] => {
  const progressByChallenge = new Map<string, StoreChallengeProgress>();
  for (const document of progressDocs) {
    const progress = document.data() as Partial<StoreChallengeProgress>;
    if (
      progress.schemaVersion !== 1 ||
      progress.storeId !== storeId ||
      progress.customerId !== customerId ||
      !clean(progress.challengeId) ||
      !Number.isSafeInteger(progress.progress) ||
      Number(progress.progress) < 0
    ) {
      continue;
    }
    progressByChallenge.set(progress.challengeId!, progress as StoreChallengeProgress);
  }

  return normalizeStoreChallengeDefinitions(definitionsValue)
    .filter(challenge =>
      challenge.storeId === storeId &&
      challenge.status !== 'draft' &&
      challenge.status !== 'cancelled'
    )
    .map(challenge => {
      const progress = progressByChallenge.get(challenge.id);
      const target = progress?.targetSnapshot ?? challenge.target;
      const progressValue = progress?.progress ?? 0;
      const completed = progress?.status === 'completed' || progressValue >= target;
      return {
        id: challenge.id,
        title: challenge.title,
        description: challenge.description,
        metric: challenge.metric,
        target,
        progress: progressValue,
        progressPercent: relationshipProgressPercent(progressValue, target),
        rewardPoints: progress?.rewardPointsSnapshot ?? challenge.rewardPoints,
        status: completed
          ? 'completed'
          : challenge.status === 'paused'
            ? 'paused'
            : challenge.status === 'ended'
              ? 'ended'
              : 'active',
        endsAt: challenge.endsAt,
        completedAt: progress?.completedAt ?? '',
      } satisfies StoreRelationshipChallengeSummary;
    })
    .sort((left, right) => {
      if (left.status === 'active' && right.status !== 'active') return -1;
      if (right.status === 'active' && left.status !== 'active') return 1;
      if (left.status === 'completed' && right.status !== 'completed') return -1;
      if (right.status === 'completed' && left.status !== 'completed') return 1;
      return left.endsAt.localeCompare(right.endsAt);
    });
};

const safeRewardSnapshot = (value: unknown): StoreRewardDefinition | null => {
  try {
    return normalizeStoreRewardDefinition(value);
  } catch {
    return null;
  }
};

export const loadStoreRelationshipSummary = async (input: {
  storeId: string;
  customerId: string;
  now?: Date;
}): Promise<StoreRelationshipSummary> => {
  const storeId = clean(input.storeId);
  const customerId = clean(input.customerId);
  if (!storeId || !customerId) {
    throw new Error('STORE_RELATIONSHIP_REQUIRED');
  }
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('STORE_RELATIONSHIP_NOW_INVALID');
  const generatedAt = now.toISOString();

  const tenantRef = adminDb.doc(`tenants/${storeId}`);
  const ledgerQuery = adminDb
    .collection(ledgerCollectionPath(storeId))
    .where('customerId', '==', customerId);
  const challengeProgressQuery = adminDb
    .collection(challengeProgressCollectionPath(storeId))
    .where('customerId', '==', customerId);
  const rewardRedemptionQuery = adminDb
    .collection(rewardRedemptionCollectionPath(storeId))
    .where('customerId', '==', customerId);

  const [tenantSnapshot, ledgerSnapshot, progressSnapshot, redemptionSnapshot, coupons] =
    await Promise.all([
      tenantRef.get(),
      ledgerQuery.get(),
      challengeProgressQuery.get(),
      rewardRedemptionQuery.get(),
      listPublicStorePromotions(storeId, now),
    ]);

  const entries = parseLedgerEntries(ledgerSnapshot.docs, storeId, customerId);
  const pointsBalance = deriveStorePointBalance(entries);
  const reversedPurchases = fullyReversedPurchaseIds(entries);
  const confirmedPurchases = entries.filter(
    entry => entry.kind === 'purchase_base' && !reversedPurchases.has(entry.id)
  ).length;
  const redemptions = parseRewardRedemptions(
    redemptionSnapshot.docs,
    storeId,
    customerId
  );
  const redemptionByReward = new Map(
    redemptions.map(redemption => [redemption.rewardId, redemption])
  );

  const currentRewards = normalizeStoreRewardDefinitions(
    tenantSnapshot.data()?.storeRewards
  ).filter(reward => reward.storeId === storeId);
  const rewardById = new Map(currentRewards.map(reward => [reward.id, reward]));
  for (const redemption of redemptions) {
    if (rewardById.has(redemption.rewardId)) continue;
    const snapshot = safeRewardSnapshot(redemption.rewardSnapshot);
    if (snapshot?.storeId === storeId) rewardById.set(snapshot.id, snapshot);
  }

  const voucherRefs = redemptions.map(redemption =>
    adminDb.doc(promotionPath(storeId, redemption.voucherPromotionId))
  );
  const voucherSnapshots = voucherRefs.length > 0
    ? await adminDb.getAll(...voucherRefs)
    : [];
  const promotionById = new Map(
    voucherSnapshots
      .filter(snapshot => snapshot.exists)
      .map(snapshot => [snapshot.id, snapshot.data() as Record<string, unknown>])
  );

  const vouchers: StoreRelationshipVoucherSummary[] = redemptions.map(redemption => {
    const promotion = promotionById.get(redemption.voucherPromotionId);
    const endsAt = finiteIso(promotion?.endsAt) || redemption.voucherEndsAt;
    const expired = Date.parse(endsAt) <= now.getTime();
    const redemptionCount = Number(promotion?.redemptionCount ?? 0);
    const active = promotion?.active !== false;
    const status: StoreRelationshipVoucherSummary['status'] = expired
      ? 'expired'
      : redemptionCount > 0
        ? 'used'
        : active
          ? 'available'
          : 'inactive';
    const reward = rewardById.get(redemption.rewardId);
    return {
      redemptionId: redemption.redemptionId,
      rewardId: redemption.rewardId,
      title: reward?.title ?? 'Recompensa resgatada',
      code: redemption.voucherCode,
      promotionId: redemption.voucherPromotionId,
      endsAt,
      status,
    };
  }).sort((left, right) => right.endsAt.localeCompare(left.endsAt));
  const voucherByReward = new Map(vouchers.map(voucher => [voucher.rewardId, voucher]));

  const rewards: StoreRelationshipRewardSummary[] = Array.from(rewardById.values())
    .filter(reward =>
      redemptionByReward.has(reward.id) ||
      isStoreRewardAvailableAt(reward, generatedAt)
    )
    .map(reward => {
      const redemption = redemptionByReward.get(reward.id);
      const voucher = voucherByReward.get(reward.id);
      const available = isStoreRewardAvailableAt(reward, generatedAt);
      return {
        id: reward.id,
        title: reward.title,
        description: reward.description,
        costPoints: reward.costPoints,
        discountType: reward.discountType,
        discountValue: reward.discountValue,
        productIds: reward.productIds,
        endsAt: reward.endsAt,
        redeemed: Boolean(redemption),
        canRedeem: available && !redemption && pointsBalance >= reward.costPoints,
        voucherCode: voucher?.code ?? '',
        voucherEndsAt: voucher?.endsAt ?? '',
      } satisfies StoreRelationshipRewardSummary;
    })
    .sort((left, right) => {
      if (left.canRedeem !== right.canRedeem) return left.canRedeem ? -1 : 1;
      if (left.redeemed !== right.redeemed) return left.redeemed ? 1 : -1;
      return left.costPoints - right.costPoints;
    });

  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const history = [...entries]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, 50)
    .map(entry => historyItem(entry, byId));

  return {
    schemaVersion: STORE_RELATIONSHIP_SCHEMA_VERSION,
    storeId,
    customerId,
    generatedAt,
    points: {
      balance: pointsBalance,
      lifetimeEarned: qualifiedEarnedPoints(entries),
      lifetimeRedeemed: netRedeemedPoints(entries),
    },
    level: deriveStoreRelationshipLevel(confirmedPurchases),
    challenges: challengeSummaries(
      tenantSnapshot.data()?.storeChallenges,
      progressSnapshot.docs,
      storeId,
      customerId
    ),
    rewards,
    coupons: coupons.map(coupon => ({ ...coupon })),
    vouchers,
    history,
  };
};