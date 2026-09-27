import { createHash } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import {
  processStoreSubscriptionMercadoPagoWebhook,
  type StoreSubscriptionWebhookResult,
} from './storeSubscriptionService.js';

const ACCOUNT_BINDING_COLLECTION = 'mercadoPagoMerchantAccountBindings';
const clean = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

export interface RoutedStoreSubscriptionWebhook {
  handled: boolean;
  result: StoreSubscriptionWebhookResult;
}

const emptyResult = (): StoreSubscriptionWebhookResult => ({
  accepted: true,
  processed: false,
  storeId: '',
  subscriptionId: '',
});

export const routeStoreSubscriptionWebhook = async (input: {
  headers: Record<string, string | string[] | undefined>;
  dataId: string;
  eventType: string;
  userId: string;
}): Promise<RoutedStoreSubscriptionWebhook> => {
  const eventType = clean(input.eventType);
  if (
    eventType !== 'subscription_preapproval' &&
    eventType !== 'subscription_authorized_payment' &&
    eventType !== 'payment'
  ) {
    return { handled: false, result: emptyResult() };
  }

  if (eventType === 'subscription_preapproval' || eventType === 'subscription_authorized_payment') {
    return {
      handled: true,
      result: await processStoreSubscriptionMercadoPagoWebhook(input),
    };
  }

  // Payment events are shared by ordinary Pix and subscriptions. Only claim the
  // event as subscription-related when user_id belongs to a merchant account
  // that has entered the subscription runtime. Ordinary Kyrub Pix remains on
  // the existing provider-binding path.
  const userId = clean(input.userId);
  if (!userId) return { handled: false, result: emptyResult() };
  const account = await adminDb
    .doc(`${ACCOUNT_BINDING_COLLECTION}/${hash(userId)}`)
    .get();
  if (!account.exists) return { handled: false, result: emptyResult() };

  const result = await processStoreSubscriptionMercadoPagoWebhook(input);
  return { handled: true, result };
};
