import type { KyrubRewardDefinition, KyrubRewardLedgerEntry } from './gamification.js';

export interface KyrubRedemptionPlan {
  redemptionId: string;
  userId: string;
  rewardId: string;
  debitEntry: KyrubRewardLedgerEntry;
  voucherCode: string;
  validUntil: string;
  auditEvent: {
    type: 'reward_redemption_planned';
    correlationId: string;
    idempotencyKey: string;
  };
}

const required = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label}_REQUIRED`);
  return normalized;
};

const safeToken = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, '_');

export const buildKyrubRedemptionPlan = (input: {
  userId: string;
  reward: KyrubRewardDefinition;
  currentBalanceKCoins: number;
  idempotencyKey: string;
  correlationId: string;
  occurredAt: string;
  validUntil: string;
}): KyrubRedemptionPlan => {
  const userId = required(input.userId, 'REDEMPTION_USER');
  const idempotencyKey = required(input.idempotencyKey, 'REDEMPTION_IDEMPOTENCY');
  const correlationId = required(input.correlationId, 'REDEMPTION_CORRELATION');
  if (!Number.isSafeInteger(input.currentBalanceKCoins) || input.currentBalanceKCoins < input.reward.costKCoins) {
    throw new Error('REDEMPTION_INSUFFICIENT_KCOINS');
  }
  if (Date.parse(input.validUntil) <= Date.parse(input.occurredAt)) {
    throw new Error('REDEMPTION_VALIDITY_INVALID');
  }

  const redemptionId = `redemption_${safeToken(userId)}_${safeToken(idempotencyKey)}`;
  const voucherCode = `KRB-${safeToken(input.reward.id).toUpperCase()}-${safeToken(idempotencyKey).toUpperCase()}`;
  const debitEntry: KyrubRewardLedgerEntry = {
    id: `${redemptionId}_debit`,
    userId,
    type: 'redeem',
    deltaKCoins: -input.reward.costKCoins,
    sourceType: 'reward_redemption',
    sourceId: input.reward.id,
    correlationId,
    idempotencyKey: `redeem:${idempotencyKey}`,
    occurredAt: input.occurredAt,
  };

  return {
    redemptionId,
    userId,
    rewardId: input.reward.id,
    debitEntry,
    voucherCode,
    validUntil: input.validUntil,
    auditEvent: {
      type: 'reward_redemption_planned',
      correlationId,
      idempotencyKey,
    },
  };
};
