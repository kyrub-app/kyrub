import { createHash } from 'node:crypto';
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

const queueIdempotencyKey = (notificationId: string): string =>
  `ml-orders-v2-${createHash('sha256').update(notificationId).digest('hex')}`;

const orderLeaseId = (notification: MercadoLivreNotificationEnvelope, externalOrderId: string): string =>
  `mlorder_${createHash('sha256')
    .update(`${notification.externalAccountId}:${externalOrderId}`)
    .digest('hex')}`;

const errorCode = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).split(':')[0].slice(0, 120);

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

const acquireOrderProcessingLease = async (input: {
  notification: MercadoLivreNotificationEnvelope;
  externalOrderId: string;
  leaseMs?: number;
}): Promise<string> => {
  const leaseId = orderLeaseId(input.notification, input.externalOrderId);
  const leaseRef = adminDb.doc(`integrationOrderProcessingLeases/${leaseId}`);
  const now = Date.now();
  const leaseUntil = new Date(now + (input.leaseMs ?? 60_000)).toISOString();

  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(leaseRef);
    if (snapshot.exists) {
      const data = snapshot.data() as Record<string, unknown>;
      const currentHolder = String(data.holderNotificationId ?? '').trim();
      const currentLeaseUntil = String(data.leaseUntil ?? '').trim();
      if (
        currentHolder &&
        currentHolder !== input.notification.notificationId &&
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
      leaseUntil,
      acquiredAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  return leaseId;
};

const releaseOrderProcessingLease = async (input: {
  leaseId: string;
  notificationId: string;
}): Promise<void> => {
  const leaseRef = adminDb.doc(`integrationOrderProcessingLeases/${input.leaseId}`);
  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(leaseRef);
    if (!snapshot.exists) return;
    const holder = String(snapshot.data()?.holderNotificationId ?? '').trim();
    if (holder !== input.notificationId) return;
    transaction.delete(leaseRef);
  });
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

  const leaseId = await acquireOrderProcessingLease({ notification, externalOrderId });
  try {
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
    throw error;
  } finally {
    await releaseOrderProcessingLease({
      leaseId,
      notificationId: notification.notificationId,
    });
  }
};
