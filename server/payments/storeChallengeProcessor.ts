import type { Transaction } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type { CanonicalPaymentIntent } from '../../src/utils/canonicalPaymentIntent.js';
import { STORE_CHALLENGE_MAX_DEFINITIONS } from '../../shared/storeChallengeLimits.js';
import {
  STORE_CHALLENGE_SCHEMA_VERSION,
  applyPaidStoreChallengeContribution,
  applyRefundedStoreChallengeContribution,
  isStoreChallengeActiveAt,
  normalizeStoreChallengeDefinitions,
  type StoreChallengeContribution,
  type StoreChallengeDefinition,
  type StoreChallengeProgress,
} from '../../shared/storeChallenges.js';
import type { StorePointLedgerEntry } from '../../shared/storePoints.js';

type ChallengeWrite = {
  ref: ReturnType<typeof adminDb.doc>;
  data: Record<string, unknown>;
};

interface StoreChallengePaymentIndex {
  schemaVersion: typeof STORE_CHALLENGE_SCHEMA_VERSION;
  storeId: string;
  paymentId: string;
  customerId: string;
  orderId: string;
  challenges: StoreChallengeDefinition[];
  occurredAt: string;
}

export interface StoreChallengePaymentPlan {
  writes: ChallengeWrite[];
  contributions: number;
  rewards: number;
  reversals: number;
}

const EMPTY_PLAN = (): StoreChallengePaymentPlan => ({
  writes: [],
  contributions: 0,
  rewards: 0,
  reversals: 0,
});

const token = (value: string): string =>
  Buffer.from(value).toString('base64url');

const progressPath = (
  storeId: string,
  challengeId: string,
  customerId: string
): string =>
  `stores/${storeId}/challengeProgress/${token(`${challengeId}:${customerId}`)}`;

const contributionPath = (
  storeId: string,
  challengeId: string,
  customerId: string,
  paymentId: string
): string =>
  `${progressPath(storeId, challengeId, customerId)}/contributions/${token(paymentId)}`;

const challengePaymentIndexPath = (
  storeId: string,
  paymentId: string
): string =>
  `stores/${storeId}/challengePaymentIndex/${token(paymentId)}`;

const storePointLedgerPath = (storeId: string, entryId: string): string =>
  `stores/${storeId}/storePointLedger/${token(entryId)}`;

const safeProgress = (
  value: unknown,
  challenge: StoreChallengeDefinition,
  customerId: string
): StoreChallengeProgress | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<StoreChallengeProgress>;
  if (
    candidate.schemaVersion !== STORE_CHALLENGE_SCHEMA_VERSION ||
    candidate.storeId !== challenge.storeId ||
    candidate.challengeId !== challenge.id ||
    candidate.customerId !== customerId ||
    candidate.metric !== challenge.metric ||
    candidate.targetSnapshot !== challenge.target ||
    candidate.rewardPointsSnapshot !== challenge.rewardPoints ||
    !Number.isSafeInteger(candidate.progress) ||
    (candidate.progress ?? -1) < 0 ||
    (candidate.status !== 'in_progress' && candidate.status !== 'completed') ||
    typeof candidate.activeRewardEntryId !== 'string' ||
    typeof candidate.completedAt !== 'string' ||
    typeof candidate.updatedAt !== 'string'
  ) {
    return null;
  }
  return candidate as StoreChallengeProgress;
};

const safeContribution = (
  value: unknown,
  challenge: StoreChallengeDefinition,
  customerId: string,
  paymentId: string
): StoreChallengeContribution | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<StoreChallengeContribution>;
  if (
    candidate.schemaVersion !== STORE_CHALLENGE_SCHEMA_VERSION ||
    candidate.storeId !== challenge.storeId ||
    candidate.challengeId !== challenge.id ||
    candidate.customerId !== customerId ||
    candidate.paymentId !== paymentId ||
    typeof candidate.orderId !== 'string' ||
    !candidate.orderId ||
    !Number.isSafeInteger(candidate.metricDelta) ||
    (candidate.metricDelta ?? 0) <= 0 ||
    typeof candidate.occurredAt !== 'string' ||
    typeof candidate.reversedAt !== 'string'
  ) {
    return null;
  }
  return candidate as StoreChallengeContribution;
};

const safeRewardEntry = (
  value: unknown,
  expectedId: string,
  storeId: string,
  customerId: string
): StorePointLedgerEntry | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as StorePointLedgerEntry;
  if (
    candidate.id !== expectedId ||
    candidate.storeId !== storeId ||
    candidate.customerId !== customerId ||
    candidate.kind !== 'bonus' ||
    candidate.amount <= 0
  ) {
    return null;
  }
  return candidate;
};

const safePaymentIndex = (
  value: unknown,
  input: {
    storeId: string;
    paymentId: string;
    customerId: string;
    orderId: string;
  }
): StoreChallengePaymentIndex | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<StoreChallengePaymentIndex>;
  const challenges = normalizeStoreChallengeDefinitions(candidate.challenges);
  if (
    candidate.schemaVersion !== STORE_CHALLENGE_SCHEMA_VERSION ||
    candidate.storeId !== input.storeId ||
    candidate.paymentId !== input.paymentId ||
    candidate.customerId !== input.customerId ||
    candidate.orderId !== input.orderId ||
    typeof candidate.occurredAt !== 'string' ||
    !candidate.occurredAt ||
    !Array.isArray(candidate.challenges) ||
    challenges.length !== candidate.challenges.length ||
    challenges.length > STORE_CHALLENGE_MAX_DEFINITIONS ||
    challenges.some(challenge => challenge.storeId !== input.storeId)
  ) {
    return null;
  }
  return {
    schemaVersion: STORE_CHALLENGE_SCHEMA_VERSION,
    storeId: input.storeId,
    paymentId: input.paymentId,
    customerId: input.customerId,
    orderId: input.orderId,
    challenges,
    occurredAt: candidate.occurredAt,
  };
};

const paidTotalMinor = (intent: CanonicalPaymentIntent): number => {
  const minor = Math.round(intent.orderDraft.total * 100);
  if (!Number.isSafeInteger(minor) || minor <= 0) {
    throw new Error('STORE_CHALLENGE_PAYMENT_TOTAL_INVALID');
  }
  return minor;
};

export const prepareStoreChallengePaymentPlan = async (input: {
  transaction: Transaction;
  storeId: string;
  paymentId: string;
  status: 'paid' | 'refunded';
  intent: CanonicalPaymentIntent;
  occurredAt: string;
}): Promise<StoreChallengePaymentPlan> => {
  const { transaction, intent } = input;
  const storeId = input.storeId.trim();
  const paymentId = input.paymentId.trim();
  if (!storeId || !paymentId) return EMPTY_PLAN();

  const customerId = intent.buyerId;
  const orderId = intent.orderDraft.draftId;
  const paymentIndexRef = adminDb.doc(
    challengePaymentIndexPath(storeId, paymentId)
  );
  const paymentIndexSnapshot = await transaction.get(paymentIndexRef);
  let challenges: StoreChallengeDefinition[] = [];

  if (input.status === 'paid') {
    if (paymentIndexSnapshot.exists) {
      const existingIndex = safePaymentIndex(paymentIndexSnapshot.data(), {
        storeId,
        paymentId,
        customerId,
        orderId,
      });
      if (!existingIndex) {
        console.warn('Store challenge payment index is malformed.', {
          storeId,
          paymentId,
        });
      }
      return EMPTY_PLAN();
    }

    const tenantSnapshot = await transaction.get(
      adminDb.doc(`tenants/${storeId}`)
    );
    challenges = normalizeStoreChallengeDefinitions(
      tenantSnapshot.data()?.storeChallenges
    )
      .filter(
        challenge =>
          challenge.storeId === storeId &&
          isStoreChallengeActiveAt(challenge, input.occurredAt)
      )
      .slice(0, STORE_CHALLENGE_MAX_DEFINITIONS);
  } else {
    if (!paymentIndexSnapshot.exists) return EMPTY_PLAN();
    const index = safePaymentIndex(paymentIndexSnapshot.data(), {
      storeId,
      paymentId,
      customerId,
      orderId,
    });
    if (!index) {
      console.warn('Skipping malformed store challenge payment index on refund.', {
        storeId,
        paymentId,
      });
      return EMPTY_PLAN();
    }
    challenges = index.challenges;
  }

  if (challenges.length === 0) return EMPTY_PLAN();

  const plan = EMPTY_PLAN();
  const contributedChallenges: StoreChallengeDefinition[] = [];

  for (const challenge of challenges) {
    const progressRef = adminDb.doc(
      progressPath(storeId, challenge.id, customerId)
    );
    const contributionRef = adminDb.doc(
      contributionPath(storeId, challenge.id, customerId, paymentId)
    );
    const [progressSnapshot, contributionSnapshot] = await Promise.all([
      transaction.get(progressRef),
      transaction.get(contributionRef),
    ]);

    if (input.status === 'paid') {
      if (contributionSnapshot.exists) continue;
      const currentProgress = progressSnapshot.exists
        ? safeProgress(progressSnapshot.data(), challenge, customerId)
        : null;
      if (progressSnapshot.exists && !currentProgress) {
        console.warn('Skipping malformed store challenge progress.', {
          storeId,
          challengeId: challenge.id,
          customerId,
        });
        continue;
      }

      let result;
      try {
        result = applyPaidStoreChallengeContribution({
          challenge,
          customerId,
          paymentId,
          orderId,
          paidTotalMinor: paidTotalMinor(intent),
          occurredAt: input.occurredAt,
          currentProgress,
        });
      } catch (error) {
        console.warn('Skipping invalid store challenge contribution.', {
          storeId,
          challengeId: challenge.id,
          error,
        });
        continue;
      }

      if (result.rewardEntry) {
        const rewardRef = adminDb.doc(
          storePointLedgerPath(storeId, result.rewardEntry.id)
        );
        const rewardSnapshot = await transaction.get(rewardRef);
        if (rewardSnapshot.exists) {
          const existingReward = safeRewardEntry(
            rewardSnapshot.data(),
            result.rewardEntry.id,
            storeId,
            customerId
          );
          if (!existingReward) {
            console.warn('Store challenge reward id conflicts with another ledger entry.', {
              storeId,
              challengeId: challenge.id,
              rewardEntryId: result.rewardEntry.id,
            });
            continue;
          }
        } else {
          plan.writes.push({
            ref: rewardRef,
            data: result.rewardEntry as unknown as Record<string, unknown>,
          });
          plan.rewards += 1;
        }
      }

      plan.writes.push(
        {
          ref: progressRef,
          data: result.progress as unknown as Record<string, unknown>,
        },
        {
          ref: contributionRef,
          data: result.contribution as unknown as Record<string, unknown>,
        }
      );
      contributedChallenges.push(challenge);
      plan.contributions += 1;
      continue;
    }

    if (!progressSnapshot.exists || !contributionSnapshot.exists) continue;
    const currentProgress = safeProgress(
      progressSnapshot.data(),
      challenge,
      customerId
    );
    const contribution = safeContribution(
      contributionSnapshot.data(),
      challenge,
      customerId,
      paymentId
    );
    if (!currentProgress || !contribution || contribution.reversedAt) continue;

    const nextValue = Math.max(
      0,
      currentProgress.progress - contribution.metricDelta
    );
    const dropsBelowTarget =
      currentProgress.progress >= currentProgress.targetSnapshot &&
      nextValue < currentProgress.targetSnapshot &&
      Boolean(currentProgress.activeRewardEntryId);
    let activeRewardEntry: StorePointLedgerEntry | null = null;

    if (dropsBelowTarget) {
      const activeRewardRef = adminDb.doc(
        storePointLedgerPath(storeId, currentProgress.activeRewardEntryId)
      );
      const activeRewardSnapshot = await transaction.get(activeRewardRef);
      activeRewardEntry = activeRewardSnapshot.exists
        ? safeRewardEntry(
            activeRewardSnapshot.data(),
            currentProgress.activeRewardEntryId,
            storeId,
            customerId
          )
        : null;
      if (!activeRewardEntry) {
        console.warn('Store challenge active reward could not be validated on refund.', {
          storeId,
          challengeId: challenge.id,
          rewardEntryId: currentProgress.activeRewardEntryId,
        });
        continue;
      }
    }

    let result;
    try {
      result = applyRefundedStoreChallengeContribution({
        challenge,
        contribution,
        currentProgress,
        activeRewardEntry,
        occurredAt: input.occurredAt,
      });
    } catch (error) {
      console.warn('Skipping invalid store challenge refund contribution.', {
        storeId,
        challengeId: challenge.id,
        error,
      });
      continue;
    }

    if (result.rewardReversal) {
      const reversalRef = adminDb.doc(
        storePointLedgerPath(storeId, result.rewardReversal.id)
      );
      const reversalSnapshot = await transaction.get(reversalRef);
      if (!reversalSnapshot.exists) {
        plan.writes.push({
          ref: reversalRef,
          data: result.rewardReversal as unknown as Record<string, unknown>,
        });
        plan.reversals += 1;
      }
    }

    plan.writes.push(
      {
        ref: progressRef,
        data: result.progress as unknown as Record<string, unknown>,
      },
      {
        ref: contributionRef,
        data: result.contribution as unknown as Record<string, unknown>,
      }
    );
  }

  if (input.status === 'paid' && contributedChallenges.length > 0) {
    plan.writes.push({
      ref: paymentIndexRef,
      data: {
        schemaVersion: STORE_CHALLENGE_SCHEMA_VERSION,
        storeId,
        paymentId,
        customerId,
        orderId,
        challenges: contributedChallenges,
        occurredAt: input.occurredAt,
      } satisfies StoreChallengePaymentIndex as unknown as Record<string, unknown>,
    });
  }

  return plan;
};

export const applyStoreChallengePaymentPlan = (
  transaction: Transaction,
  plan: StoreChallengePaymentPlan
): void => {
  for (const write of plan.writes) {
    transaction.set(write.ref, write.data);
  }
};
