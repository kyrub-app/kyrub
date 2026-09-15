import { createHash, randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { send } from '@vercel/queue';
import {
  ingestMercadoLivreNotification,
  parseMercadoLivreNotification,
  type MercadoLivreNotificationEnvelope,
} from './mercadoLivreNotificationInboxService.js';
import { processMercadoLivreOrderNotificationInboxItem } from './mercadoLivreOrderIngressService.js';
import { mercadoLivreOrderIdFromResource } from '../../shared/mercadoLivreOrderIngress.js';
import { adminDb } from '../firebaseAdmin.js';

export const MERCADO_LIVRE_ORDERS_V2_QUEUE_TOPIC = 'mercado_livre_orders_v2';

const ORDER_PROCESSING_LEASE_MS = 120_000;
const ORDER_PROCESSING_HEARTBEAT_MS = 30_000;
const MAX_RETRYABLE_FAILURES = 12;

const queueIdempotencyKey = (notificationId: string): string =>
  `ml-orders-v2-${createHash('sha256').update(notificationId).digest('hex')}`;

const orderLeaseId = (notification: MercadoLivreNotificationEnvelope, externalOrderId: string): string =>
  `mlorder_${createHash('sha256')
    .update(`${notification.externalAccountId}:${externalOrderId}`)
    .digest('hex')}`;

const errorCode = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).split(':')[0].slice(0, 120);

const errorDiagnostic = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim().slice(0, 240);

const terminalEnvelopeErrors = new Set([
  'MERCADO_LIVRE_NOTIFICATION_INVALID',
  'MERCADO_LIVRE_NOTIFICATION_ID_INVALID',
  'MERCADO_LIVRE_NOTIFICATION_RESOURCE_INVALID',
  'MERCADO_LIVRE_NOTIFICATION_ACCOUNT_INVALID',
  'MERCADO_LIVRE_NOTIFICATION_TOPIC_INVALID',
  'MERCADO_LIVRE_NOTIFICATION_APPLICATION_INVALID',
  'MERCADO_LIVRE_NOTIFICATION_SENT_AT_INVALID',
  'MERCADO_LIVRE_NOTIFICATION_ATTEMPTS_INVALID',
  'MERCADO_LIVRE_ORDER_QUEUE_TOPIC_INVALID',
  'MERCADO_LIVRE_ORDER_RESOURCE_UNSUPPORTED',
]);

const terminalProcessingErrors = new Set([
  'MERCADO_LIVRE_ORDER_SELLER_MISMATCH',
  'MERCADO_LIVRE_ORDER_RESPONSE_INVALID',
  'MERCADO_LIVRE_ORDER_ITEMS_INVALID',
  'MERCADO_LIVRE_ORDER_ITEM_INVALID',
]);

const coordinationRetryErrors = new Set([
  'MERCADO_LIVRE_ORDER_PROCESSING_LEASE_BUSY',
  'MERCADO_LIVRE_ORDER_PROCESSING_LEASE_LOST',
]);

export const isMercadoLivreOrderQueueTerminalEnvelopeError = (code: string): boolean =>
  terminalEnvelopeErrors.has(code);

const isMercadoLivreOrderQueueTerminalProcessingError = (code: string): boolean =>
  terminalProcessingErrors.has(code);

const quarantinePendingInbox = async (input: {
  inboxId: string;
  code: string;
}): Promise<void> => {
  const inboxRef = adminDb.doc(`integrationWebhookInbox/${input.inboxId}`);
  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(inboxRef);
    if (!snapshot.exists) return;
    const status = String(snapshot.data()?.processingStatus ?? '').trim();
    if (status !== 'pending') return;
    transaction.update(inboxRef, {
      processingStatus: 'failed',
      processingOutcome: 'quarantined_terminal_error',
      processingErrorCode: input.code,
      processingAuthority: 'provider_api_refetch',
      failedAt: FieldValue.serverTimestamp(),
    });
  });
};

interface RetryableFailureRecordResult {
  exhausted: boolean;
  failureCount: number;
}

const recordRetryableFailure = async (input: {
  inboxId: string;
  error: unknown;
}): Promise<RetryableFailureRecordResult> => {
  const code = errorCode(input.error);
  if (coordinationRetryErrors.has(code)) {
    return { exhausted: false, failureCount: 0 };
  }

  const inboxRef = adminDb.doc(`integrationWebhookInbox/${input.inboxId}`);
  try {
    return await adminDb.runTransaction(async transaction => {
      const snapshot = await transaction.get(inboxRef);
      if (!snapshot.exists) return { exhausted: false, failureCount: 0 };
      const data = snapshot.data() as Record<string, unknown>;
      const status = String(data.processingStatus ?? '').trim();
      const outcome = String(data.processingOutcome ?? '').trim();
      const existingCount = Number(data.retryableFailureCount ?? 0);
      const failureCount = Number.isFinite(existingCount) && existingCount > 0
        ? Math.trunc(existingCount) + 1
        : 1;

      if (status === 'failed' && outcome === 'retry_exhausted') {
        return { exhausted: true, failureCount: Math.max(failureCount - 1, MAX_RETRYABLE_FAILURES) };
      }
      if (status !== 'pending') return { exhausted: false, failureCount: Math.max(0, failureCount - 1) };

      const exhausted = failureCount >= MAX_RETRYABLE_FAILURES;
      transaction.update(inboxRef, {
        ...(exhausted ? {
          processingStatus: 'failed',
          processingOutcome: 'retry_exhausted',
          processingAuthority: 'manual_review_required',
          resolutionAuthority: 'manual_review_required',
          manualReviewRequired: true,
          retryExhaustedAt: FieldValue.serverTimestamp(),
          failedAt: FieldValue.serverTimestamp(),
        } : {
          processingOutcome: 'retryable_infrastructure_failure',
        }),
        lastRetryableErrorCode: code,
        lastRetryableErrorDiagnostic: errorDiagnostic(input.error),
        retryableFailureCount: failureCount,
        retryableFailureBudget: MAX_RETRYABLE_FAILURES,
        firstRetryableFailureAt: data.firstRetryableFailureAt || FieldValue.serverTimestamp(),
        lastRetryableFailureAt: FieldValue.serverTimestamp(),
      });
      return { exhausted, failureCount };
    });
  } catch (recordError) {
    console.error('[Mercado Livre order Queue retry metadata]', {
      inboxId: input.inboxId,
      error: errorCode(recordError),
    });
    return { exhausted: false, failureCount: 0 };
  }
};

const exhaustedInboxDisposition = async (inboxId: string): Promise<MercadoLivreOrderQueueConsumeResult | null> => {
  const snapshot = await adminDb.doc(`integrationWebhookInbox/${inboxId}`).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() as Record<string, unknown>;
  if (
    String(data.processingStatus ?? '').trim() !== 'failed' ||
    String(data.processingOutcome ?? '').trim() !== 'retry_exhausted'
  ) return null;
  return {
    disposition: 'retry_exhausted',
    inboxId,
    outcome: 'manual_review_required',
    errorCode: String(data.lastRetryableErrorCode ?? '').trim() || undefined,
  };
};

interface OrderProcessingLease {
  leaseId: string;
  holderToken: string;
  notificationId: string;
}

const acquireOrderProcessingLease = async (input: {
  notification: MercadoLivreNotificationEnvelope;
  externalOrderId: string;
  leaseMs?: number;
}): Promise<OrderProcessingLease> => {
  const leaseId = orderLeaseId(input.notification, input.externalOrderId);
  const leaseRef = adminDb.doc(`integrationOrderProcessingLeases/${leaseId}`);
  const now = Date.now();
  const leaseUntil = new Date(now + (input.leaseMs ?? ORDER_PROCESSING_LEASE_MS)).toISOString();
  const holderToken = randomUUID();

  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(leaseRef);
    if (snapshot.exists) {
      const data = snapshot.data() as Record<string, unknown>;
      const currentHolderToken = String(data.holderToken ?? '').trim();
      const currentLeaseUntil = String(data.leaseUntil ?? '').trim();
      if (
        currentHolderToken &&
        Number.isFinite(Date.parse(currentLeaseUntil)) &&
        Date.parse(currentLeaseUntil) > now
      ) {
        throw new Error('MERCADO_LIVRE_ORDER_PROCESSING_LEASE_BUSY');
      }
    }

    transaction.set(leaseRef, {
      provider: 'mercado_livre',
      externalAccountId: input.notification.externalAccountId,
      externalOrderId: input.externalOrderId,
      holderNotificationId: input.notification.notificationId,
      holderToken,
      leaseUntil,
      acquiredAt: FieldValue.serverTimestamp(),
      renewedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  return { leaseId, holderToken, notificationId: input.notification.notificationId };
};

const renewOrderProcessingLease = async (lease: OrderProcessingLease): Promise<void> => {
  const leaseRef = adminDb.doc(`integrationOrderProcessingLeases/${lease.leaseId}`);
  const leaseUntil = new Date(Date.now() + ORDER_PROCESSING_LEASE_MS).toISOString();
  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(leaseRef);
    if (!snapshot.exists) throw new Error('MERCADO_LIVRE_ORDER_PROCESSING_LEASE_LOST');
    const holderToken = String(snapshot.data()?.holderToken ?? '').trim();
    if (holderToken !== lease.holderToken) {
      throw new Error('MERCADO_LIVRE_ORDER_PROCESSING_LEASE_LOST');
    }
    transaction.update(leaseRef, {
      leaseUntil,
      renewedAt: FieldValue.serverTimestamp(),
    });
  });
};

const releaseOrderProcessingLease = async (lease: OrderProcessingLease): Promise<void> => {
  const leaseRef = adminDb.doc(`integrationOrderProcessingLeases/${lease.leaseId}`);
  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(leaseRef);
    if (!snapshot.exists) return;
    const holderToken = String(snapshot.data()?.holderToken ?? '').trim();
    if (holderToken !== lease.holderToken) return;
    transaction.delete(leaseRef);
  });
};

const startOrderProcessingLeaseHeartbeat = (lease: OrderProcessingLease): (() => void) => {
  let renewalInFlight = false;
  const timer = setInterval(() => {
    if (renewalInFlight) return;
    renewalInFlight = true;
    void renewOrderProcessingLease(lease)
      .catch(error => {
        console.error('[Mercado Livre order processing lease heartbeat]', {
          notificationId: lease.notificationId,
          error: errorCode(error),
        });
      })
      .finally(() => {
        renewalInFlight = false;
      });
  }, ORDER_PROCESSING_HEARTBEAT_MS);
  timer.unref?.();
  return () => clearInterval(timer);
};

export interface MercadoLivreOrderQueuePublishResult {
  queued: true;
  messageId: string;
  notificationId: string;
}

export interface MercadoLivreOrderQueueConsumeResult {
  disposition: string;
  inboxId?: string;
  outcome?: string;
  errorCode?: string;
}

export const enqueueMercadoLivreOrderNotification = async (
  input: unknown
): Promise<MercadoLivreOrderQueuePublishResult> => {
  const notification = parseMercadoLivreNotification(input);
  if (notification.topic !== 'orders_v2') {
    throw new Error('MERCADO_LIVRE_ORDER_QUEUE_TOPIC_INVALID');
  }
  mercadoLivreOrderIdFromResource(notification.resource);

  const result = await send(
    MERCADO_LIVRE_ORDERS_V2_QUEUE_TOPIC,
    input,
    {
      idempotencyKey: queueIdempotencyKey(notification.notificationId),
      retentionSeconds: 86_400,
    }
  );

  if (!result?.messageId) {
    throw new Error('MERCADO_LIVRE_ORDER_QUEUE_SEND_FAILED');
  }

  return {
    queued: true,
    messageId: result.messageId,
    notificationId: notification.notificationId,
  };
};

export const consumeMercadoLivreOrderQueueMessage = async (
  input: unknown
): Promise<MercadoLivreOrderQueueConsumeResult> => {
  let notification: MercadoLivreNotificationEnvelope;
  let externalOrderId: string;
  try {
    notification = parseMercadoLivreNotification(input);
    if (notification.topic !== 'orders_v2') {
      throw new Error('MERCADO_LIVRE_ORDER_QUEUE_TOPIC_INVALID');
    }
    externalOrderId = mercadoLivreOrderIdFromResource(notification.resource);
  } catch (error) {
    const code = errorCode(error);
    if (isMercadoLivreOrderQueueTerminalEnvelopeError(code)) {
      return { disposition: 'discarded_invalid_message', errorCode: code };
    }
    throw error;
  }

  const ingested = await ingestMercadoLivreNotification(input);
  if (!ingested.accepted || ingested.disposition !== 'pending_fetch' || !ingested.inboxId) {
    return {
      disposition: ingested.disposition,
      ...(ingested.inboxId ? { inboxId: ingested.inboxId } : {}),
    };
  }

  const alreadyExhausted = await exhaustedInboxDisposition(ingested.inboxId);
  if (alreadyExhausted) return alreadyExhausted;

  let lease: OrderProcessingLease | null = null;
  let stopHeartbeat: (() => void) | null = null;
  try {
    lease = await acquireOrderProcessingLease({ notification, externalOrderId });
    await renewOrderProcessingLease(lease);
    stopHeartbeat = startOrderProcessingLeaseHeartbeat(lease);

    const processed = await processMercadoLivreOrderNotificationInboxItem({
      inboxId: ingested.inboxId,
    });

    return {
      disposition: processed.alreadyProcessed ? 'already_processed' : 'processed',
      inboxId: ingested.inboxId,
      ...(processed.outcome ? { outcome: processed.outcome } : {}),
    };
  } catch (error) {
    const code = errorCode(error);
    if (isMercadoLivreOrderQueueTerminalProcessingError(code)) {
      await quarantinePendingInbox({ inboxId: ingested.inboxId, code });
      return {
        disposition: 'quarantined_terminal_error',
        inboxId: ingested.inboxId,
        errorCode: code,
      };
    }
    const retry = await recordRetryableFailure({ inboxId: ingested.inboxId, error });
    if (retry.exhausted) {
      return {
        disposition: 'retry_exhausted',
        inboxId: ingested.inboxId,
        outcome: 'manual_review_required',
        errorCode: code,
      };
    }
    throw error;
  } finally {
    stopHeartbeat?.();
    if (lease) {
      try {
        await releaseOrderProcessingLease(lease);
      } catch (releaseError) {
        console.error('[Mercado Livre order processing lease release]', {
          notificationId: notification.notificationId,
          error: errorCode(releaseError),
        });
      }
    }
  }
};
