import { createHash } from 'node:crypto';
import { send } from '@vercel/queue';
import {
  ingestMercadoLivreNotification,
  parseMercadoLivreNotification,
} from './mercadoLivreNotificationInboxService.js';
import { processMercadoLivreOrderNotificationInboxItem } from './mercadoLivreOrderIngressService.js';
import {
  KYRUB_SHARED_QUEUE_TOPIC,
  createKyrubSharedQueueEnvelope,
} from '../queue/kyrubSharedQueueEnvelope.js';

export const MERCADO_LIVRE_ORDERS_V2_QUEUE_TOPIC = KYRUB_SHARED_QUEUE_TOPIC;

const queueIdempotencyKey = (notificationId: string): string =>
  `ml-orders-v2-${createHash('sha256').update(notificationId).digest('hex')}`;

export interface MercadoLivreOrderQueuePublishResult {
  queued: true;
  messageId: string;
  notificationId: string;
}

export const enqueueMercadoLivreOrderNotification = async (
  input: unknown
): Promise<MercadoLivreOrderQueuePublishResult> => {
  const notification = parseMercadoLivreNotification(input);
  if (notification.topic !== 'orders_v2') {
    throw new Error('MERCADO_LIVRE_ORDER_QUEUE_TOPIC_INVALID');
  }

  const result = await send(
    MERCADO_LIVRE_ORDERS_V2_QUEUE_TOPIC,
    createKyrubSharedQueueEnvelope('mercado_livre_orders_v2', input),
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
): Promise<{
  disposition: string;
  inboxId?: string;
  outcome?: string;
}> => {
  const notification = parseMercadoLivreNotification(input);
  if (notification.topic !== 'orders_v2') {
    throw new Error('MERCADO_LIVRE_ORDER_QUEUE_TOPIC_INVALID');
  }

  const ingested = await ingestMercadoLivreNotification(input);
  if (!ingested.accepted || ingested.disposition !== 'pending_fetch' || !ingested.inboxId) {
    return {
      disposition: ingested.disposition,
      ...(ingested.inboxId ? { inboxId: ingested.inboxId } : {}),
    };
  }

  const processed = await processMercadoLivreOrderNotificationInboxItem({
    inboxId: ingested.inboxId,
  });

  return {
    disposition: processed.alreadyProcessed ? 'already_processed' : 'processed',
    inboxId: ingested.inboxId,
    ...(processed.outcome ? { outcome: processed.outcome } : {}),
  };
};
