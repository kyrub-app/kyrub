import { createHash } from 'node:crypto';
import { send } from '@vercel/queue';
import { expireDueMarketplacePixReservations } from './marketplacePaymentExpiryService.js';
import {
  KYRUB_SHARED_QUEUE_TOPIC,
  createKyrubSharedQueueEnvelope,
} from '../queue/kyrubSharedQueueEnvelope.js';

export const MARKETPLACE_PAYMENT_EXPIRY_QUEUE_KIND = 'marketplace_payment_expiry' as const;

export interface MarketplacePaymentExpiryQueueMessage {
  storeId: string;
  orderId: string;
  paymentIntentId: string;
  expiresAt: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const parseMessage = (input: unknown): MarketplacePaymentExpiryQueueMessage => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('MARKETPLACE_PAYMENT_EXPIRY_QUEUE_MESSAGE_INVALID');
  }
  const raw = input as Record<string, unknown>;
  const storeId = clean(raw.storeId);
  const orderId = clean(raw.orderId);
  const paymentIntentId = clean(raw.paymentIntentId);
  const expiresAt = clean(raw.expiresAt);
  if (
    !storeId ||
    !orderId ||
    !paymentIntentId ||
    !expiresAt ||
    Number.isNaN(Date.parse(expiresAt))
  ) {
    throw new Error('MARKETPLACE_PAYMENT_EXPIRY_QUEUE_MESSAGE_INVALID');
  }
  return { storeId, orderId, paymentIntentId, expiresAt };
};

const idempotencyKey = (message: MarketplacePaymentExpiryQueueMessage): string =>
  `marketplace-payment-expiry-${createHash('sha256')
    .update(`${message.storeId}:${message.orderId}:${message.paymentIntentId}:${message.expiresAt}`)
    .digest('hex')}`;

const delayUntilExpirySeconds = (expiresAt: string): number =>
  Math.max(1, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1_000) + 1);

export const enqueueMarketplacePaymentExpiry = async (
  input: MarketplacePaymentExpiryQueueMessage
): Promise<{ queued: true; messageId: string; delaySeconds: number }> => {
  const message = parseMessage(input);
  const delaySeconds = delayUntilExpirySeconds(message.expiresAt);
  const result = await send(
    KYRUB_SHARED_QUEUE_TOPIC,
    createKyrubSharedQueueEnvelope(MARKETPLACE_PAYMENT_EXPIRY_QUEUE_KIND, message),
    {
      delaySeconds,
      retentionSeconds: Math.max(3_600, delaySeconds + 3_600),
      idempotencyKey: idempotencyKey(message),
    }
  );
  if (!result?.messageId) {
    throw new Error('MARKETPLACE_PAYMENT_EXPIRY_QUEUE_SEND_FAILED');
  }
  return {
    queued: true,
    messageId: result.messageId,
    delaySeconds,
  };
};

export const consumeMarketplacePaymentExpiryQueueMessage = async (
  input: unknown
): Promise<{
  storeId: string;
  orderId: string;
  paymentIntentId: string;
  expiresAt: string;
  scanned: number;
  paid: number;
  released: number;
  deferred: number;
  failed: number;
}> => {
  const message = parseMessage(input);
  if (Date.now() < Date.parse(message.expiresAt)) {
    throw new Error('MARKETPLACE_PAYMENT_EXPIRY_QUEUE_EARLY_DELIVERY');
  }
  const result = await expireDueMarketplacePixReservations(100);
  return {
    ...message,
    ...result,
  };
};
