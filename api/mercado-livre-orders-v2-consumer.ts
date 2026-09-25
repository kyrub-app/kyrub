import { QueueClient } from '@vercel/queue';
import {
  MERCADO_LIVRE_ORDERS_V2_QUEUE_TOPIC,
  consumeMercadoLivreOrderQueueMessage,
} from '../server/integrations/mercadoLivreOrderQueueService.js';
import {
  MARKETPLACE_PAYMENT_EXPIRY_QUEUE_KIND,
  consumeMarketplacePaymentExpiryQueueMessage,
} from '../server/payments/marketplacePaymentExpiryQueueService.js';
import {
  isLegacyMercadoLivreOrdersV2QueuePayload,
  parseKyrubSharedQueueEnvelope,
} from '../server/queue/kyrubSharedQueueEnvelope.js';

const queue = new QueueClient();

const consumeMercadoLivre = async (
  payload: unknown,
  metadata: { topicName: string; messageId: string; deliveryCount: number }
): Promise<void> => {
  const result = await consumeMercadoLivreOrderQueueMessage(payload);
  console.info('[Mercado Livre orders_v2 consumed]', JSON.stringify({
    topic: metadata.topicName,
    messageId: metadata.messageId,
    deliveryCount: metadata.deliveryCount,
    disposition: result.disposition,
    inboxId: result.inboxId,
    outcome: result.outcome,
  }));
};

export default queue.handleNodeCallback(async (message, metadata) => {
  if (metadata.topicName !== MERCADO_LIVRE_ORDERS_V2_QUEUE_TOPIC) {
    throw new Error('KYRUB_QUEUE_TOPIC_MISMATCH');
  }

  // Preserve compatibility with raw Mercado Livre messages that were queued
  // before the shared, versioned envelope was introduced.
  if (isLegacyMercadoLivreOrdersV2QueuePayload(message)) {
    await consumeMercadoLivre(message, metadata);
    return;
  }

  const envelope = parseKyrubSharedQueueEnvelope(message);
  if (!envelope) {
    throw new Error('KYRUB_QUEUE_ENVELOPE_INVALID');
  }

  if (envelope.kind === 'mercado_livre_orders_v2') {
    await consumeMercadoLivre(envelope.payload, metadata);
    return;
  }

  if (envelope.kind === MARKETPLACE_PAYMENT_EXPIRY_QUEUE_KIND) {
    const result = await consumeMarketplacePaymentExpiryQueueMessage(envelope.payload);
    console.info('[Marketplace payment expiry consumed]', JSON.stringify({
      topic: metadata.topicName,
      messageId: metadata.messageId,
      deliveryCount: metadata.deliveryCount,
      storeId: result.storeId,
      orderId: result.orderId,
      paymentIntentId: result.paymentIntentId,
      expiresAt: result.expiresAt,
      scanned: result.scanned,
      paid: result.paid,
      released: result.released,
      deferred: result.deferred,
      failed: result.failed,
    }));
    return;
  }

  throw new Error('KYRUB_QUEUE_KIND_UNSUPPORTED');
});
