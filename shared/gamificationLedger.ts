import {
  assertKyrubRewardLedgerEntry,
  type KyrubRewardLedgerEntry,
  type KyrubRewardLedgerEntryType,
} from './gamification.js';

export interface CreateKCoinLedgerEntryInput {
  id: string;
  userId: string;
  type: KyrubRewardLedgerEntryType;
  deltaKCoins: number;
  origin: KyrubRewardLedgerEntry['sourceType'];
  originId: string;
  challengeId?: string;
  reason: string;
  correlationId: string;
  idempotencyKey: string;
  occurredAt: string;
  reversalOfEntryId?: string;
}

export interface AuditableKCoinLedgerEntry extends KyrubRewardLedgerEntry {
  economy: 'k_coin';
  reason: string;
  challengeId?: string;
}

const required = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
};

export const createAuditableKCoinLedgerEntry = (
  input: CreateKCoinLedgerEntryInput
): AuditableKCoinLedgerEntry => {
  const base: KyrubRewardLedgerEntry = {
    id: input.id,
    userId: input.userId,
    type: input.type,
    deltaKCoins: input.deltaKCoins,
    sourceType: input.origin,
    sourceId: input.originId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    occurredAt: input.occurredAt,
    ...(input.reversalOfEntryId
      ? { reversalOfEntryId: input.reversalOfEntryId }
      : {}),
  };
  assertKyrubRewardLedgerEntry(base);

  return {
    ...base,
    economy: 'k_coin',
    reason: required(input.reason, 'ledger.reason'),
    ...(input.challengeId ? { challengeId: required(input.challengeId, 'ledger.challengeId') } : {}),
  };
};

export const assertKCoinLedgerIdempotency = (
  entries: readonly AuditableKCoinLedgerEntry[]
): void => {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.economy !== 'k_coin') throw new Error('REWARD_LEDGER_ECONOMY_MISMATCH');
    required(entry.reason, 'ledger.reason');
    if (seen.has(entry.idempotencyKey)) {
      throw new Error(`REWARD_LEDGER_IDEMPOTENCY_CONFLICT:${entry.idempotencyKey}`);
    }
    seen.add(entry.idempotencyKey);
  }
};
