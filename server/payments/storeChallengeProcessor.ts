import type { Transaction } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type { CanonicalPaymentIntent } from '../../src/utils/canonicalPaymentIntent.js';
import {
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
    candidate.schemaVersion !== 1 ||
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
    candidate.schemaVersion !== 1 ||
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

  const tenantSnapshot = await transaction.get(adminDb.doc(`tenants/${storeId}`));
  const challenges = normalizeStoreChallengeDefinitions(
    tenantSnapshot.data()?.storeChallenges
  )
    .filter(challenge => challenge.storeId === storeId)
    .slice(0, 20);
  if (challenges.length === 0) return EMPTY_PLAN();

  const plan = EMPTY_PLAN();
  const customerId = intent.buyerId;

  for (const challenge of challenges) {
    if (
      input.status === 'paid' &&
      !isStoreChallengeActiveAt(challenge, input.occurredAt)
    ) {
      continue;
    }

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
          orderId: intent.orderDraft.draftId,
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
      plan.contributions += 1;

      if (result.rewardEntry) {
        const rewardRef = adminDb.doc(
          storePointLedgerPath(storeId, result.rewardEntry.id)
        );
        const rewardSnapshot = await transaction.get(rewardRef);
        if (!rewardSnapshot.exists) {
          plan.writes.push({
            ref: rewardRef,
            data: result.rewardEntry as unknown as Record<string, unknown>,
          });
          plan.rewards += 1;
        } else if (
          !safeRewardEntry(
            rewardSnapshot.data(),
            result.rewardEntry.id,
            storeId,
            customerId
          )
        ) {
          console.warn('Store challenge reward id conflicts with another ledger entry.', {
            storeId,
            challengeId: challenge.id,
            rewardEntryId: result.rewardEntry.id,
          });
        }
      }
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
