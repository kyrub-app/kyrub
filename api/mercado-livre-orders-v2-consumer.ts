import { QueueClient } from '@vercel/queue';
import {
  MERCADO_LIVRE_ORDERS_V2_QUEUE_TOPIC,
  consumeMercadoLivreOrderQueueMessage,
} from '../server/integrations/mercadoLivreOrderQueueService.js';
import {
  MARKETPLACE_PAYMENT_EXPIRY_QUEUE_TOPIC,
  consumeMarketplacePaymentExpiryQueueMessage,
} from '../server/payments/marketplacePaymentExpiryQueueService.js';

const queue = new QueueClient();

export default queue.handleNodeCallback(async (message, metadata) => {
  if (metadata.topicName === MERCADO_LIVRE_ORDERS_V2_QUEUE_TOPIC) {
    const result = await consumeMercadoLivreOrderQueueMessage(message);
    console.info('[Mercado Livre orders_v2 consumed]', JSON.stringify({
      topic: metadata.topicName,
      messageId: metadata.messageId,
      deliveryCount: metadata.deliveryCount,
      disposition: result.disposition,
      inboxId: result.inboxId,
      outcome: result.outcome,
    }));
    return;
  }

  if (metadata.topicName === MARKETPLACE_PAYMENT_EXPIRY_QUEUE_TOPIC) {
    const result = await consumeMarketplacePaymentExpiryQueueMessage(message);
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

  throw new Error('KYRUB_QUEUE_TOPIC_MISMATCH');
});
