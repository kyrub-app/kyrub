export type OmnichannelSyncDirection = 'inbound' | 'outbound' | 'reconcile';

export type OmnichannelSyncEntityType =
  | 'store'
  | 'product'
  | 'sku'
  | 'order'
  | 'inventory'
  | 'catalog';

export type OmnichannelReconciliationAction =
  | 'noop'
  | 'push-canonical'
  | 'pull-external'
  | 'conflict';

export interface OmnichannelSyncCursor {
  checkpoint: string;
  observedAtMs: number;
}

export interface OmnichannelVersionState {
  canonicalVersion: string;
  externalVersion: string;
  lastSyncedCanonicalVersion: string;
  lastSyncedExternalVersion: string;
}

const required = (label: string, value: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
};

export const buildOmnichannelIdempotencyKey = (input: {
  storeId: string;
  channelId: string;
  direction: OmnichannelSyncDirection;
  entityType: OmnichannelSyncEntityType;
  externalEventId: string;
}): string => {
  const parts = [
    required('store id', input.storeId),
    required('channel id', input.channelId),
    input.direction,
    input.entityType,
    required('external event id', input.externalEventId),
  ];

  return parts.map(part => encodeURIComponent(part)).join('|');
};

export const calculateOmnichannelRetryDelayMs = (
  attempt: number,
  options: { baseMs?: number; maxMs?: number } = {}
): number => {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error('Sync attempt must be a positive integer.');
  }

  const baseMs = options.baseMs ?? 15_000;
  const maxMs = options.maxMs ?? 15 * 60_000;
  if (baseMs <= 0 || maxMs < baseMs) {
    throw new Error('Invalid sync retry policy.');
  }

  return Math.min(maxMs, baseMs * 2 ** Math.min(20, attempt));
};

export const canReserveOmnichannelWork = (input: {
  status: 'queued' | 'processing' | 'failed' | 'processed';
  nowMs: number;
  leaseExpiresAtMs?: number | null;
  nextAttemptAtMs?: number | null;
}): boolean => {
  if (input.status === 'processed') return false;
  if (
    input.status === 'processing' &&
    typeof input.leaseExpiresAtMs === 'number' &&
    input.leaseExpiresAtMs > input.nowMs
  ) {
    return false;
  }
  if (
    typeof input.nextAttemptAtMs === 'number' &&
    input.nextAttemptAtMs > input.nowMs
  ) {
    return false;
  }
  return true;
};

export const advanceOmnichannelCursor = (
  current: OmnichannelSyncCursor | null,
  next: OmnichannelSyncCursor
): OmnichannelSyncCursor => {
  const checkpoint = required('sync cursor checkpoint', next.checkpoint);
  if (!Number.isFinite(next.observedAtMs) || next.observedAtMs < 0) {
    throw new Error('Sync cursor timestamp is invalid.');
  }
  if (current && next.observedAtMs < current.observedAtMs) {
    throw new Error('Sync cursor cannot move backwards.');
  }

  return { checkpoint, observedAtMs: next.observedAtMs };
};

export const decideOmnichannelReconciliation = (
  state: OmnichannelVersionState
): OmnichannelReconciliationAction => {
  const canonicalChanged =
    state.canonicalVersion !== state.lastSyncedCanonicalVersion;
  const externalChanged =
    state.externalVersion !== state.lastSyncedExternalVersion;

  if (!canonicalChanged && !externalChanged) return 'noop';
  if (canonicalChanged && !externalChanged) return 'push-canonical';
  if (!canonicalChanged && externalChanged) return 'pull-external';
  if (state.canonicalVersion === state.externalVersion) return 'noop';
  return 'conflict';
};
