import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { processMercadoLivreOrderNotificationInboxItem } from './mercadoLivreOrderIngressService.js';

const WORKER_LEASE_MS = 55_000;
const MAX_WORKER_ATTEMPTS = 10;

const clean = (value: unknown, maximum = 1_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const queueDocumentIdIsValid = (value: string): boolean =>
  /^mercado_livre__[a-f0-9]{64}$/.test(value);

const errorCode = (error: unknown): string =>
  clean(error instanceof Error ? error.message : String(error), 300).split(':')[0] || 'UNKNOWN';

interface QueueClaim {
  claimed: boolean;
  exhausted: boolean;
  attempt: number;
}

const claimQueueItem = async (queueId: string): Promise<QueueClaim> => {
  const reference = adminDb.doc(`mercadoLivreOrderIngressQueue/${queueId}`);
  return adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) return { claimed: false, exhausted: false, attempt: 0 };
    const data = snapshot.data() as Record<string, unknown>;
    if (
      data.provider !== 'mercado_livre' ||
      data.topic !== 'orders_v2' ||
      clean(data.inboxId, 160) !== queueId ||
      data.authority !== 'durable_webhook_queue' ||
      data.status !== 'pending'
    ) {
      return { claimed: false, exhausted: false, attempt: 0 };
    }

    const lease = data.leaseExpiresAt;
    if (lease instanceof Timestamp && lease.toMillis() > Date.now()) {
      return { claimed: false, exhausted: false, attempt: Number(data.attempts) || 0 };
    }

    const currentAttempts = Number(data.attempts);
    const attempt = (Number.isSafeInteger(currentAttempts) && currentAttempts >= 0 ? currentAttempts : 0) + 1;
    if (attempt > MAX_WORKER_ATTEMPTS) {
      transaction.set(reference, {
        status: 'failed',
        failedReason: 'worker_attempts_exhausted',
        failedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        leaseExpiresAt: FieldValue.delete(),
      }, { merge: true });
      return { claimed: false, exhausted: true, attempt };
    }

    transaction.set(reference, {
      attempts: attempt,
      lastAttemptAt: FieldValue.serverTimestamp(),
      leaseExpiresAt: Timestamp.fromMillis(Date.now() + WORKER_LEASE_MS),
      updatedAt: FieldValue.serverTimestamp(),
      lastError: FieldValue.delete(),
    }, { merge: true });
    return { claimed: true, exhausted: false, attempt };
  });
};

const completeQueueItem = async (
  queueId: string,
  result: Awaited<ReturnType<typeof processMercadoLivreOrderNotificationInboxItem>>
): Promise<void> => {
  await adminDb.doc(`mercadoLivreOrderIngressQueue/${queueId}`).set({
    status: 'processed',
    result: {
      alreadyProcessed: result.alreadyProcessed,
      externalOrderId: result.externalOrderId ?? '',
      orderId: result.orderId ?? '',
      outcome: result.outcome ?? '',
      missingExternalItemIds: result.missingExternalItemIds ?? [],
    },
    processedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    leaseExpiresAt: FieldValue.delete(),
    lastError: FieldValue.delete(),
  }, { merge: true });
};

const failQueueAttempt = async (
  queueId: string,
  attempt: number,
  error: unknown
): Promise<boolean> => {
  const exhausted = attempt >= MAX_WORKER_ATTEMPTS;
  const code = errorCode(error);
  const queueReference = adminDb.doc(`mercadoLivreOrderIngressQueue/${queueId}`);
  const inboxReference = adminDb.doc(`integrationWebhookInbox/${queueId}`);
  const batch = adminDb.batch();
  batch.set(queueReference, {
    status: exhausted ? 'failed' : 'pending',
    lastError: code,
    lastFailureAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    leaseExpiresAt: FieldValue.delete(),
    ...(exhausted ? { failedAt: FieldValue.serverTimestamp() } : {}),
  }, { merge: true });
  if (exhausted) {
    batch.set(inboxReference, {
      processingStatus: 'failed',
      processingError: code,
      processingFailedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  await batch.commit();
  return exhausted;
};

export interface MercadoLivreOrderIngressWorkerResult {
  scanned: number;
  claimed: number;
  processed: number;
  failedAttempts: number;
  exhausted: number;
  skipped: number;
}

export const processPendingMercadoLivreOrderIngressBatch = async (input: {
  limit?: number;
} = {}): Promise<MercadoLivreOrderIngressWorkerResult> => {
  const requestedLimit = Number(input.limit ?? 10);
  const limit = Number.isSafeInteger(requestedLimit)
    ? Math.max(1, Math.min(25, requestedLimit))
    : 10;
  const snapshot = await adminDb
    .collection('mercadoLivreOrderIngressQueue')
    .where('status', '==', 'pending')
    .limit(limit)
    .get();

  const result: MercadoLivreOrderIngressWorkerResult = {
    scanned: snapshot.size,
    claimed: 0,
    processed: 0,
    failedAttempts: 0,
    exhausted: 0,
    skipped: 0,
  };

  for (const document of snapshot.docs) {
    const queueId = document.id;
    if (!queueDocumentIdIsValid(queueId)) {
      result.skipped += 1;
      continue;
    }
    const claim = await claimQueueItem(queueId);
    if (claim.exhausted) {
      result.exhausted += 1;
      continue;
    }
    if (!claim.claimed) {
      result.skipped += 1;
      continue;
    }
    result.claimed += 1;

    try {
      const processed = await processMercadoLivreOrderNotificationInboxItem({
        inboxId: queueId,
      });
      await completeQueueItem(queueId, processed);
      result.processed += 1;
    } catch (error) {
      result.failedAttempts += 1;
      if (await failQueueAttempt(queueId, claim.attempt, error)) {
        result.exhausted += 1;
      }
    }
  }

  return result;
};
