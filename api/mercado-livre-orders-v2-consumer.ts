import { QueueClient } from '@vercel/queue';
import {
  MERCADO_LIVRE_ORDERS_V2_QUEUE_TOPIC,
  consumeMercadoLivreOrderQueueMessage,
} from '../server/integrations/mercadoLivreOrderQueueService.js';

const queue = new QueueClient();

export default queue.handleNodeCallback(async (message, metadata) => {
  if (metadata.topicName !== MERCADO_LIVRE_ORDERS_V2_QUEUE_TOPIC) {
    throw new Error('MERCADO_LIVRE_ORDER_QUEUE_TOPIC_MISMATCH');
  }

  const result = await consumeMercadoLivreOrderQueueMessage(message);
  console.info('[Mercado Livre orders_v2 consumed]', JSON.stringify({
    topic: metadata.topicName,
    messageId: metadata.messageId,
    deliveryCount: metadata.deliveryCount,
    disposition: result.disposition,
    inboxId: result.inboxId,
    outcome: result.outcome,
  }));
});
