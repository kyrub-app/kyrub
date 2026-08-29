import {
  buildStorePointBonusEntry,
  buildStorePointReversalEntry,
  type StorePointLedgerEntry,
} from './storePoints';

export const STORE_CHALLENGE_SCHEMA_VERSION = 1 as const;

export type StoreChallengeMetric = 'purchase_count' | 'spend_minor';
export type StoreChallengeStatus =
  | 'draft'
  | 'active'
  | 'paused'
  | 'ended'
  | 'cancelled';

export interface StoreChallengeDefinition {
  schemaVersion: typeof STORE_CHALLENGE_SCHEMA_VERSION;
  id: string;
  storeId: string;
  title: string;
  description: string;
  metric: StoreChallengeMetric;
  target: number;
  rewardPoints: number;
  startsAt: string;
  endsAt: string;
  status: StoreChallengeStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StoreChallengeProgress {
  schemaVersion: typeof STORE_CHALLENGE_SCHEMA_VERSION;
  storeId: string;
  challengeId: string;
  customerId: string;
  metric: StoreChallengeMetric;
  targetSnapshot: number;
  rewardPointsSnapshot: number;
  progress: number;
  status: 'in_progress' | 'completed';
  activeRewardEntryId: string;
  completedAt: string;
  updatedAt: string;
}

export interface StoreChallengeContribution {
  schemaVersion: typeof STORE_CHALLENGE_SCHEMA_VERSION;
  storeId: string;
  challengeId: string;
  customerId: string;
  paymentId: string;
  orderId: string;
  metricDelta: number;
  occurredAt: string;
  reversedAt: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const required = (value: unknown, code: string): string => {
  const normalized = clean(value);
  if (!normalized) throw new Error(code);
  return normalized;
};

const positiveInteger = (value: unknown, code: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(code);
  }
  return value;
};

const parseIso = (value: unknown, code: string): string => {
  const normalized = required(value, code);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(code);
  return normalized;
};

export const normalizeStoreChallengeDefinition = (
  value: unknown
): StoreChallengeDefinition => {
  if (!value || typeof value !== 'object') {
    throw new Error('STORE_CHALLENGE_INVALID');
  }
  const candidate = value as Record<string, unknown>;
  const metric = candidate.metric;
  const status = candidate.status;
  if (metric !== 'purchase_count' && metric !== 'spend_minor') {
    throw new Error('STORE_CHALLENGE_METRIC_INVALID');
  }
  if (
    status !== 'draft' &&
    status !== 'active' &&
    status !== 'paused' &&
    status !== 'ended' &&
    status !== 'cancelled'
  ) {
    throw new Error('STORE_CHALLENGE_STATUS_INVALID');
  }

  const startsAt = parseIso(candidate.startsAt, 'STORE_CHALLENGE_START_REQUIRED');
  const endsAt = parseIso(candidate.endsAt, 'STORE_CHALLENGE_END_REQUIRED');
  if (Date.parse(startsAt) >= Date.parse(endsAt)) {
    throw new Error('STORE_CHALLENGE_PERIOD_INVALID');
  }

  return {
    schemaVersion: STORE_CHALLENGE_SCHEMA_VERSION,
    id: required(candidate.id, 'STORE_CHALLENGE_ID_REQUIRED'),
    storeId: required(candidate.storeId, 'STORE_CHALLENGE_STORE_REQUIRED'),
    title: required(candidate.title, 'STORE_CHALLENGE_TITLE_REQUIRED'),
    description: clean(candidate.description),
    metric,
    target: positiveInteger(candidate.target, 'STORE_CHALLENGE_TARGET_INVALID'),
    rewardPoints: positiveInteger(
      candidate.rewardPoints,
      'STORE_CHALLENGE_REWARD_INVALID'
    ),
    startsAt,
    endsAt,
    status,
    createdAt: parseIso(candidate.createdAt, 'STORE_CHALLENGE_CREATED_AT_REQUIRED'),
    updatedAt: parseIso(candidate.updatedAt, 'STORE_CHALLENGE_UPDATED_AT_REQUIRED'),
  };
};

export const normalizeStoreChallengeDefinitions = (
  value: unknown
): StoreChallengeDefinition[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap(candidate => {
    try {
      const challenge = normalizeStoreChallengeDefinition(candidate);
      if (seen.has(challenge.id)) return [];
      seen.add(challenge.id);
      return [challenge];
    } catch {
      return [];
    }
  });
};

export const isStoreChallengeActiveAt = (
  challenge: StoreChallengeDefinition,
  occurredAt: string
): boolean => {
  const timestamp = Date.parse(occurredAt);
  return challenge.status === 'active' &&
    Number.isFinite(timestamp) &&
    timestamp >= Date.parse(challenge.startsAt) &&
    timestamp < Date.parse(challenge.endsAt);
};

export const storeChallengeMetricDelta = (
  challenge: StoreChallengeDefinition,
  input: { paidTotalMinor: number }
): number => {
  if (challenge.metric === 'purchase_count') return 1;
  if (
    !Number.isSafeInteger(input.paidTotalMinor) ||
    input.paidTotalMinor <= 0
  ) {
    throw new Error('STORE_CHALLENGE_PAID_TOTAL_INVALID');
  }
  return input.paidTotalMinor;
};

const assertProgressScope = (
  challenge: StoreChallengeDefinition,
  customerId: string,
  progress: StoreChallengeProgress
): void => {
  if (
    progress.storeId !== challenge.storeId ||
    progress.challengeId !== challenge.id ||
    progress.customerId !== customerId ||
    progress.metric !== challenge.metric ||
    progress.targetSnapshot !== challenge.target ||
    progress.rewardPointsSnapshot !== challenge.rewardPoints
  ) {
    throw new Error('STORE_CHALLENGE_PROGRESS_SCOPE_MISMATCH');
  }
};

export const applyPaidStoreChallengeContribution = (input: {
  challenge: StoreChallengeDefinition;
  customerId: string;
  paymentId: string;
  orderId: string;
  paidTotalMinor: number;
  occurredAt: string;
  currentProgress?: StoreChallengeProgress | null;
}): {
  progress: StoreChallengeProgress;
  contribution: StoreChallengeContribution;
  rewardEntry: StorePointLedgerEntry | null;
} => {
  const challenge = normalizeStoreChallengeDefinition(input.challenge);
  const customerId = required(input.customerId, 'STORE_CHALLENGE_CUSTOMER_REQUIRED');
  const paymentId = required(input.paymentId, 'STORE_CHALLENGE_PAYMENT_REQUIRED');
  const orderId = required(input.orderId, 'STORE_CHALLENGE_ORDER_REQUIRED');
  const occurredAt = parseIso(input.occurredAt, 'STORE_CHALLENGE_OCCURRED_AT_REQUIRED');
  if (!isStoreChallengeActiveAt(challenge, occurredAt)) {
    throw new Error('STORE_CHALLENGE_NOT_ACTIVE');
  }

  const current = input.currentProgress ?? null;
  if (current) assertProgressScope(challenge, customerId, current);
  const previousValue = current?.progress ?? 0;
  const delta = storeChallengeMetricDelta(challenge, {
    paidTotalMinor: input.paidTotalMinor,
  });
  const nextValue = previousValue + delta;
  if (!Number.isSafeInteger(nextValue) || nextValue < 0) {
    throw new Error('STORE_CHALLENGE_PROGRESS_INVALID');
  }
  const completedBefore = previousValue >= challenge.target;
  const completedAfter = nextValue >= challenge.target;

  const rewardEntry = !completedBefore && completedAfter
    ? buildStorePointBonusEntry({
        bonusId: `challenge:${challenge.id}:completion:${paymentId}`,
        storeId: challenge.storeId,
        customerId,
        amount: challenge.rewardPoints,
        reason: `challenge_completed:${challenge.id}`,
        correlationId: `challenge:${challenge.id}:customer:${customerId}`,
        occurredAt,
      })
    : null;

  return {
    progress: {
      schemaVersion: STORE_CHALLENGE_SCHEMA_VERSION,
      storeId: challenge.storeId,
      challengeId: challenge.id,
      customerId,
      metric: challenge.metric,
      targetSnapshot: challenge.target,
      rewardPointsSnapshot: challenge.rewardPoints,
      progress: nextValue,
      status: completedAfter ? 'completed' : 'in_progress',
      activeRewardEntryId:
        rewardEntry?.id ?? current?.activeRewardEntryId ?? '',
      completedAt:
        completedAfter
          ? current?.completedAt || occurredAt
          : '',
      updatedAt: occurredAt,
    },
    contribution: {
      schemaVersion: STORE_CHALLENGE_SCHEMA_VERSION,
      storeId: challenge.storeId,
      challengeId: challenge.id,
      customerId,
      paymentId,
      orderId,
      metricDelta: delta,
      occurredAt,
      reversedAt: '',
    },
    rewardEntry,
  };
};

export const applyRefundedStoreChallengeContribution = (input: {
  challenge: StoreChallengeDefinition;
  contribution: StoreChallengeContribution;
  currentProgress: StoreChallengeProgress;
  activeRewardEntry?: StorePointLedgerEntry | null;
  occurredAt: string;
}): {
  progress: StoreChallengeProgress;
  contribution: StoreChallengeContribution;
  rewardReversal: StorePointLedgerEntry | null;
} => {
  const challenge = normalizeStoreChallengeDefinition(input.challenge);
  const occurredAt = parseIso(input.occurredAt, 'STORE_CHALLENGE_OCCURRED_AT_REQUIRED');
  const contribution = input.contribution;
  const current = input.currentProgress;
  assertProgressScope(challenge, contribution.customerId, current);
  if (
    contribution.storeId !== challenge.storeId ||
    contribution.challengeId !== challenge.id ||
    contribution.customerId !== current.customerId ||
    contribution.metricDelta <= 0 ||
    !Number.isSafeInteger(contribution.metricDelta)
  ) {
    throw new Error('STORE_CHALLENGE_CONTRIBUTION_SCOPE_MISMATCH');
  }
  if (contribution.reversedAt) {
    return { progress: current, contribution, rewardReversal: null };
  }

  const nextValue = Math.max(0, current.progress - contribution.metricDelta);
  const completedBefore = current.progress >= current.targetSnapshot;
  const completedAfter = nextValue >= current.targetSnapshot;
  let rewardReversal: StorePointLedgerEntry | null = null;

  if (completedBefore && !completedAfter && current.activeRewardEntryId) {
    const activeReward = input.activeRewardEntry ?? null;
    if (!activeReward || activeReward.id !== current.activeRewardEntryId) {
      throw new Error('STORE_CHALLENGE_ACTIVE_REWARD_REQUIRED');
    }
    rewardReversal = buildStorePointReversalEntry({
      reversalId: `challenge_refund:${challenge.id}:${contribution.paymentId}:${activeReward.id}`,
      original: activeReward,
      reason: `challenge_progress_refunded:${challenge.id}`,
      occurredAt,
    });
  }

  return {
    progress: {
      ...current,
      progress: nextValue,
      status: completedAfter ? 'completed' : 'in_progress',
      activeRewardEntryId: completedAfter ? current.activeRewardEntryId : '',
      completedAt: completedAfter ? current.completedAt : '',
      updatedAt: occurredAt,
    },
    contribution: {
      ...contribution,
      reversedAt: occurredAt,
    },
    rewardReversal,
  };
};
