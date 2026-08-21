import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin';
import type { StoreIntegrationId } from '../../src/utils/storeOperationalSettings';
import {
  calculateOmnichannelRetryDelayMs,
  canReserveOmnichannelWork,
} from '../../src/utils/omnichannelSyncEngine';

const OUTBOX_COLLECTION = 'inventorySyncOutbox';
const DEFAULT_LEASE_MS = 60_000;

export type InventoryWorkerStatus =
  | 'pending'
  | 'processing'
  | 'failed'
  | 'succeeded'
  | 'missing_mapping';

export interface InventoryDispatchPayload {
  storeId: string;
  targetChannel: StoreIntegrationId;
  productId: string;
  externalProductId: string;
  quantity: number;
  idempotencyKey: string;
}

export type InventoryAdapterDispatcher = (
  payload: InventoryDispatchPayload
) => Promise<void>;

interface StoredInventoryJob extends InventoryDispatchPayload {
  id: string;
  status: InventoryWorkerStatus;
  attempts: number;
  leaseExpiresAtMs?: number | null;
  nextAttemptAtMs?: number | null;
}

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const parseJob = (value: unknown): StoredInventoryJob | null => {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const status = row.status as InventoryWorkerStatus;
  if (
    typeof row.id !== 'string' ||
    typeof row.storeId !== 'string' ||
    typeof row.targetChannel !== 'string' ||
    typeof row.productId !== 'string' ||
    typeof row.externalProductId !== 'string' ||
    typeof row.quantity !== 'number' ||
    typeof row.idempotencyKey !== 'string' ||
    !['pending', 'processing', 'failed', 'succeeded', 'missing_mapping'].includes(status)
  ) {
    return null;
  }

  return {
    id: row.id,
    storeId: row.storeId,
    targetChannel: row.targetChannel as StoreIntegrationId,
    productId: row.productId,
    externalProductId: row.externalProductId,
    quantity: row.quantity,
    idempotencyKey: row.idempotencyKey,
    status,
    attempts: Number.isInteger(row.attempts) ? Number(row.attempts) : 0,
    leaseExpiresAtMs: asNumber(row.leaseExpiresAtMs),
    nextAttemptAtMs: asNumber(row.nextAttemptAtMs),
  };
};

const workerStatusToSyncStatus = (
  status: InventoryWorkerStatus
): 'queued' | 'processing' | 'failed' | 'processed' => {
  if (status === 'processing') return 'processing';
  if (status === 'failed') return 'failed';
  if (status === 'succeeded' || status === 'missing_mapping') return 'processed';
  return 'queued';
};

const reserveInventoryJob = async (input: {
  storeId: string;
  jobId: string;
  nowMs: number;
  leaseMs?: number;
}): Promise<StoredInventoryJob | null> => {
  const ref = adminDb.doc(
    `stores/${input.storeId}/${OUTBOX_COLLECTION}/${input.jobId}`
  );
  let reserved: StoredInventoryJob | null = null;

  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return;
    const job = parseJob(snapshot.data());
    if (!job || job.status === 'missing_mapping') return;

    const canReserve = canReserveOmnichannelWork({
      status: workerStatusToSyncStatus(job.status),
      nowMs: input.nowMs,
      leaseExpiresAtMs: job.leaseExpiresAtMs,
      nextAttemptAtMs: job.nextAttemptAtMs,
    });
    if (!canReserve) return;

    const attempts = job.attempts + 1;
    const leaseExpiresAtMs = input.nowMs + (input.leaseMs ?? DEFAULT_LEASE_MS);
    transaction.update(ref, {
      status: 'processing',
      attempts,
      leaseExpiresAtMs,
      nextAttemptAtMs: null,
      lastError: '',
      updatedAt: FieldValue.serverTimestamp(),
    });

    reserved = {
      ...job,
      status: 'processing',
      attempts,
      leaseExpiresAtMs,
      nextAttemptAtMs: null,
    };
  });

  return reserved;
};

const markInventoryJobSucceeded = async (
  job: StoredInventoryJob
): Promise<void> => {
  await adminDb.doc(
    `stores/${job.storeId}/${OUTBOX_COLLECTION}/${job.id}`
  ).update({
    status: 'succeeded',
    leaseExpiresAtMs: null,
    nextAttemptAtMs: null,
    lastError: '',
    processedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
};

const markInventoryJobFailed = async (
  job: StoredInventoryJob,
  error: unknown,
  nowMs: number
): Promise<void> => {
  const delayMs = calculateOmnichannelRetryDelayMs(job.attempts);
  await adminDb.doc(
    `stores/${job.storeId}/${OUTBOX_COLLECTION}/${job.id}`
  ).update({
    status: 'failed',
    leaseExpiresAtMs: null,
    nextAttemptAtMs: nowMs + delayMs,
    lastError: error instanceof Error ? error.message.slice(0, 1000) : 'UNKNOWN_SYNC_ERROR',
    updatedAt: FieldValue.serverTimestamp(),
  });
};

export const processInventoryOutboxJob = async (input: {
  storeId: string;
  jobId: string;
  dispatcher: InventoryAdapterDispatcher;
  nowMs?: number;
}): Promise<'processed' | 'skipped' | 'failed'> => {
  const nowMs = input.nowMs ?? Date.now();
  const job = await reserveInventoryJob({
    storeId: input.storeId,
    jobId: input.jobId,
    nowMs,
  });
  if (!job) return 'skipped';

  try {
    await input.dispatcher({
      storeId: job.storeId,
      targetChannel: job.targetChannel,
      productId: job.productId,
      externalProductId: job.externalProductId,
      quantity: job.quantity,
      idempotencyKey: job.idempotencyKey,
    });
    await markInventoryJobSucceeded(job);
    return 'processed';
  } catch (error) {
    await markInventoryJobFailed(job, error, nowMs);
    return 'failed';
  }
};

export const processInventoryOutboxBatch = async (input: {
  storeId: string;
  dispatcher: InventoryAdapterDispatcher;
  limit?: number;
  nowMs?: number;
}): Promise<{ processed: number; failed: number; skipped: number }> => {
  const limit = Math.max(1, Math.min(input.limit ?? 25, 100));
  const snapshot = await adminDb
    .collection(`stores/${input.storeId}/${OUTBOX_COLLECTION}`)
    .where('status', 'in', ['pending', 'failed', 'processing'])
    .limit(limit)
    .get();

  const counters = { processed: 0, failed: 0, skipped: 0 };
  for (const doc of snapshot.docs) {
    const result = await processInventoryOutboxJob({
      storeId: input.storeId,
      jobId: doc.id,
      dispatcher: input.dispatcher,
      nowMs: input.nowMs,
    });
    counters[result] += 1;
  }
  return counters;
};
