import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { send } from '@vercel/queue';
import { adminDb } from '../firebaseAdmin.js';
import { MERCADO_LIVRE_ORDERS_V2_QUEUE_TOPIC } from './mercadoLivreOrderQueueService.js';
import { parseMercadoLivreNotification } from './mercadoLivreNotificationInboxService.js';
import { mercadoLivreOrderIdFromResource } from '../../shared/mercadoLivreOrderIngress.js';

export type MercadoLivreOrderManualReviewAction =
  | 'retry_now'
  | 'keep_in_review'
  | 'close_non_processable';

const allowedActions = new Set<MercadoLivreOrderManualReviewAction>([
  'retry_now',
  'keep_in_review',
  'close_non_processable',
]);

const clean = (value: unknown, maximum = 500): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const finiteInteger = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
};

const errorCode = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).split(':')[0].slice(0, 120);

const manualRetryIdempotencyKey = (inboxId: string, cycle: number): string =>
  `ml-orders-v2-manual-${createHash('sha256').update(`${inboxId}:${cycle}`).digest('hex')}`;

const assertReviewableInbox = (
  data: Record<string, unknown>,
  storeId: string
): void => {
  if (
    data.provider !== 'mercado_livre' ||
    data.topic !== 'orders_v2' ||
    clean(data.storeId, 160) !== storeId
  ) {
    throw new Error('MERCADO_LIVRE_ORDER_MANUAL_REVIEW_INBOX_MISMATCH');
  }
  if (
    clean(data.processingStatus, 80) !== 'failed' ||
    clean(data.processingOutcome, 120) !== 'retry_exhausted' ||
    data.manualReviewRequired !== true
  ) {
    throw new Error('MERCADO_LIVRE_ORDER_MANUAL_REVIEW_STATE_INVALID');
  }
};

const providerEnvelopeFromInbox = (data: Record<string, unknown>): Record<string, unknown> => {
  const sentAt = clean(data.sentAt, 120);
  const envelope: Record<string, unknown> = {
    _id: clean(data.notificationId, 200),
    resource: clean(data.resource, 500),
    user_id: clean(data.externalAccountId, 80),
    topic: 'orders_v2',
    application_id: clean(data.applicationId, 80),
    attempts: finiteInteger(data.attempts),
    ...(sentAt ? { sent: sentAt } : {}),
  };
  const parsed = parseMercadoLivreNotification(envelope);
  mercadoLivreOrderIdFromResource(parsed.resource);
  return envelope;
};

export interface MercadoLivreOrderManualReviewResult {
  action: MercadoLivreOrderManualReviewAction;
  inboxId: string;
  externalOrderId: string;
  orderId: string;
  status: 'queued' | 'in_review' | 'closed_non_processable';
  manualReviewRequired: boolean;
  manualRetryCycle?: number;
  queueMessageId?: string;
}

export const resolveMercadoLivreOrderManualReview = async (input: {
  storeId: string;
  inboxId: string;
  requestedByUserId: string;
  action: unknown;
  reason?: unknown;
}): Promise<MercadoLivreOrderManualReviewResult> => {
  const storeId = clean(input.storeId, 160);
  const inboxId = clean(input.inboxId, 220);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  const action = clean(input.action, 80) as MercadoLivreOrderManualReviewAction;
  const reason = clean(input.reason, 500);

  if (!storeId || !requestedByUserId || storeId !== requestedByUserId) {
    throw new Error('STORE_CONNECTION_FORBIDDEN');
  }
  if (!/^mercado_livre__[a-f0-9]{64}$/.test(inboxId)) {
    throw new Error('MERCADO_LIVRE_ORDER_MANUAL_REVIEW_INBOX_INVALID');
  }
  if (!allowedActions.has(action)) {
    throw new Error('MERCADO_LIVRE_ORDER_MANUAL_REVIEW_ACTION_INVALID');
  }
  if (action === 'close_non_processable' && !reason) {
    throw new Error('MERCADO_LIVRE_ORDER_MANUAL_REVIEW_REASON_REQUIRED');
  }

  const inboxRef = adminDb.doc(`integrationWebhookInbox/${inboxId}`);
  let externalOrderId = '';
  let envelope: Record<string, unknown> | null = null;
  let manualRetryCycle = 0;

  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(inboxRef);
    if (!snapshot.exists) {
      throw new Error('MERCADO_LIVRE_ORDER_MANUAL_REVIEW_NOT_FOUND');
    }
    const data = snapshot.data() as Record<string, unknown>;
    assertReviewableInbox(data, storeId);
    const parsedEnvelope = parseMercadoLivreNotification(providerEnvelopeFromInbox(data));
    externalOrderId = mercadoLivreOrderIdFromResource(parsedEnvelope.resource);

    if (action === 'keep_in_review') {
      transaction.update(inboxRef, {
        manualReviewRequired: true,
        manualReviewDisposition: 'keep_in_review',
        resolutionAuthority: 'manual_review_required',
        manualReviewReason: reason || FieldValue.delete(),
        manualReviewUpdatedByUserId: requestedByUserId,
        manualReviewUpdatedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    if (action === 'close_non_processable') {
      transaction.update(inboxRef, {
        processingStatus: 'failed',
        processingOutcome: 'manual_review_closed_non_processable',
        processingAuthority: 'store_owner_manual_review',
        resolutionAuthority: 'store_owner_manual_review',
        manualReviewRequired: false,
        manualReviewDisposition: 'non_processable',
        manualReviewReason: reason,
        manualReviewClosedByUserId: requestedByUserId,
        manualReviewClosedAt: FieldValue.serverTimestamp(),
        manualReviewUpdatedByUserId: requestedByUserId,
        manualReviewUpdatedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    manualRetryCycle = Math.max(0, finiteInteger(data.manualRetryCycle)) + 1;
    envelope = providerEnvelopeFromInbox(data);
    transaction.update(inboxRef, {
      processingStatus: 'pending',
      processingOutcome: 'manual_retry_requested',
      processingAuthority: 'store_owner_manual_review',
      resolutionAuthority: 'provider_api_refetch_required',
      manualReviewRequired: false,
      manualReviewDisposition: 'retry_now',
      manualReviewReason: reason || FieldValue.delete(),
      manualReviewUpdatedByUserId: requestedByUserId,
      manualReviewUpdatedAt: FieldValue.serverTimestamp(),
      manualRetryCycle,
      manualRetryRequestedAt: FieldValue.serverTimestamp(),
      retryableFailureCount: 0,
      previousRetryCycleFailureCount: finiteInteger(data.retryableFailureCount),
      previousRetryCycleFirstFailureAt: data.firstRetryableFailureAt ?? null,
      previousRetryCycleLastFailureAt: data.lastRetryableFailureAt ?? null,
      previousRetryCycleLastErrorCode: clean(data.lastRetryableErrorCode, 120) || null,
      previousRetryCycleLastErrorDiagnostic: clean(data.lastRetryableErrorDiagnostic, 240) || null,
      lastRetryExhaustedAt: data.retryExhaustedAt ?? data.failedAt ?? null,
      firstRetryableFailureAt: FieldValue.delete(),
      lastRetryableFailureAt: FieldValue.delete(),
      lastRetryableErrorCode: FieldValue.delete(),
      lastRetryableErrorDiagnostic: FieldValue.delete(),
      retryExhaustedAt: FieldValue.delete(),
      failedAt: FieldValue.delete(),
    });
  });

  const orderId = `mercado-livre-order-${externalOrderId}`;
  if (action === 'keep_in_review') {
    return {
      action,
      inboxId,
      externalOrderId,
      orderId,
      status: 'in_review',
      manualReviewRequired: true,
    };
  }
  if (action === 'close_non_processable') {
    return {
      action,
      inboxId,
      externalOrderId,
      orderId,
      status: 'closed_non_processable',
      manualReviewRequired: false,
    };
  }

  if (!envelope || manualRetryCycle < 1) {
    throw new Error('MERCADO_LIVRE_ORDER_MANUAL_RETRY_STATE_INVALID');
  }

  try {
    const queued = await send(
      MERCADO_LIVRE_ORDERS_V2_QUEUE_TOPIC,
      envelope,
      {
        idempotencyKey: manualRetryIdempotencyKey(inboxId, manualRetryCycle),
        retentionSeconds: 86_400,
      }
    );
    if (!queued?.messageId) {
      throw new Error('MERCADO_LIVRE_ORDER_MANUAL_RETRY_QUEUE_FAILED');
    }
    return {
      action,
      inboxId,
      externalOrderId,
      orderId,
      status: 'queued',
      manualReviewRequired: false,
      manualRetryCycle,
      queueMessageId: queued.messageId,
    };
  } catch (error) {
    await adminDb.runTransaction(async transaction => {
      const snapshot = await transaction.get(inboxRef);
      if (!snapshot.exists) return;
      const data = snapshot.data() as Record<string, unknown>;
      if (
        clean(data.processingStatus, 80) !== 'pending' ||
        clean(data.processingOutcome, 120) !== 'manual_retry_requested' ||
        finiteInteger(data.manualRetryCycle) !== manualRetryCycle
      ) return;
      transaction.update(inboxRef, {
        processingStatus: 'failed',
        processingOutcome: 'retry_exhausted',
        processingAuthority: 'manual_review_required',
        resolutionAuthority: 'manual_review_required',
        manualReviewRequired: true,
        manualReviewDisposition: 'retry_enqueue_failed',
        manualReviewLastActionErrorCode: errorCode(error),
        retryExhaustedAt: FieldValue.serverTimestamp(),
        failedAt: FieldValue.serverTimestamp(),
        manualReviewUpdatedAt: FieldValue.serverTimestamp(),
      });
    });
    throw new Error(`MERCADO_LIVRE_ORDER_MANUAL_RETRY_QUEUE_FAILED:${errorCode(error)}`);
  }
};
