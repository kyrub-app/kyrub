import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { send } from '@vercel/queue';
import {
  ingestMercadoLivreNotification,
  parseMercadoLivreNotification,
} from './mercadoLivreNotificationInboxService.js';
import { processMercadoLivreOrderNotificationInboxItem } from './mercadoLivreOrderIngressService.js';
import { mercadoLivreOrderIdFromResource } from '../../shared/mercadoLivreOrderIngress.js';
import { adminDb } from '../firebaseAdmin.js';

export const MERCADO_LIVRE_ORDERS_V2_QUEUE_TOPIC = 'mercado_livre_orders_v2';

const queueIdempotencyKey = (notificationId: string): string =>
  `ml-orders-v2-${createHash('sha256').update(notificationId).digest('hex')}`;

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
  try {
    const notification = parseMercadoLivreNotification(input);
    if (notification.topic !== 'orders_v2') {
      throw new Error('MERCADO_LIVRE_ORDER_QUEUE_TOPIC_INVALID');
    }
    mercadoLivreOrderIdFromResource(notification.resource);
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
  }
};
