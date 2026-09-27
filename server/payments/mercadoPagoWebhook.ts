import { processVerifiedPaymentWebhook } from './paymentWebhookProcessor.js';
import {
  isMercadoPagoWebhookRuntimeConfigured,
  verifiedMercadoPagoPaymentEvent,
} from './mercadoPagoPixProvider.js';
import { verifiedStoreScopedMercadoPagoPaymentEvent } from './mercadoPagoStoreScopedProvider.js';
import { routeStoreSubscriptionWebhook } from './storeSubscriptionWebhookRouter.js';
import { settleMarketplaceOperationalOrderAfterPayment } from './marketplaceOrderPaymentSettlementService.js';
import { syncPersistedCustomerOrderIntoCrm } from './storeCrmOrderSyncService.js';
import {
  markMarketplaceOrderInventoryReservationPaymentConfirmed,
  releaseMarketplaceReservationForTerminalPayment,
} from '../inventory/marketplaceOrderInventoryReservationService.js';
import {
  attachPreparedCustomerDestinationResolutionToOperationalOrder,
  prepareCustomerDestinationResolutionForPaymentIntent,
} from '../delivery/customerDestinationOrderResolutionService.js';

export interface MercadoPagoWebhookResult {
  accepted: true;
  processed: boolean;
  duplicate: boolean;
  paymentId: string;
  orderId: string;
  orderMaterialized: boolean;
  subscriptionId?: string;
  subscriptionStoreId?: string;
}

export interface MercadoPagoWebhookErrorResult {
  status: number;
  body: { error: string; code?: string };
}

const subscriptionWebhookResult = (
  result: Awaited<ReturnType<typeof routeStoreSubscriptionWebhook>>['result']
): MercadoPagoWebhookResult => ({
  accepted: true,
  processed: result.processed,
  duplicate: false,
  paymentId: '',
  orderId: '',
  orderMaterialized: false,
  subscriptionId: result.subscriptionId,
  subscriptionStoreId: result.storeId,
});

const processVerifiedOrdinaryPayment = async (
  event: Awaited<ReturnType<typeof verifiedStoreScopedMercadoPagoPaymentEvent>> extends infer T
    ? Exclude<T, null>
    : never
): Promise<MercadoPagoWebhookResult> => {
  const preparedDestination = await prepareCustomerDestinationResolutionForPaymentIntent({
    storeId: event.kyrubStoreId,
    paymentIntentId: event.paymentIntentId,
  });

  const result = await processVerifiedPaymentWebhook({
    storeId: event.kyrubStoreId,
    paymentId: event.kyrubPaymentId,
    event,
  });

  if (event.eventType === 'payment.paid' && result.orderId) {
    await settleMarketplaceOperationalOrderAfterPayment({
      storeId: event.kyrubStoreId,
      orderId: result.orderId,
      paymentIntentId: event.paymentIntentId,
      occurredAt: event.occurredAt,
    });
    await markMarketplaceOrderInventoryReservationPaymentConfirmed(
      event.kyrubStoreId,
      result.orderId
    );
  } else if (
    event.eventType === 'payment.failed' ||
    event.eventType === 'payment.expired' ||
    event.eventType === 'payment.cancelled'
  ) {
    await releaseMarketplaceReservationForTerminalPayment({
      storeId: event.kyrubStoreId,
      paymentIntentId: event.paymentIntentId,
      eventType: event.eventType,
    });
  }

  await attachPreparedCustomerDestinationResolutionToOperationalOrder(preparedDestination);

  if (result.orderId) {
    try {
      await syncPersistedCustomerOrderIntoCrm({
        storeId: event.kyrubStoreId,
        orderId: result.orderId,
      });
    } catch (error) {
      console.warn(
        '[Mercado Pago Webhook] Pagamento e pedido confirmados; CRM ficará para a reconciliação.',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  return {
    accepted: true,
    processed: true,
    duplicate: result.duplicate,
    paymentId: result.paymentId,
    orderId: result.orderId,
    orderMaterialized: result.orderMaterialized,
  };
};

export const processMercadoPagoWebhook = async (input: {
  headers: Record<string, string | string[] | undefined>;
  dataId: string;
  eventType?: string;
  userId?: string;
}): Promise<MercadoPagoWebhookResult> => {
  const dataId = input.dataId.trim();
  if (!dataId) throw new Error('MERCADO_PAGO_WEBHOOK_DATA_ID_REQUIRED');
  const eventType = input.eventType?.trim() ?? '';
  const userId = input.userId?.trim() ?? '';

  // Subscription topics never belong to the ordinary payment/order runtime.
  if (
    eventType === 'subscription_preapproval' ||
    eventType === 'subscription_authorized_payment'
  ) {
    const routed = await routeStoreSubscriptionWebhook({
      headers: input.headers,
      dataId,
      eventType,
      userId,
    });
    return subscriptionWebhookResult(routed.result);
  }

  // For shared `payment` notifications, preserve ordinary Kyrub Pix first. A
  // subscription payment only gets a chance when no canonical payment binding
  // exists for this provider payment ID.
  const storeScopedEvent = await verifiedStoreScopedMercadoPagoPaymentEvent({
    headers: input.headers,
    dataId,
  });
  if (storeScopedEvent) {
    return processVerifiedOrdinaryPayment(storeScopedEvent);
  }

  if (eventType === 'payment') {
    const routed = await routeStoreSubscriptionWebhook({
      headers: input.headers,
      dataId,
      eventType,
      userId,
    });
    if (routed.handled) return subscriptionWebhookResult(routed.result);
  }

  if (!(await isMercadoPagoWebhookRuntimeConfigured())) {
    throw new Error('MERCADO_PAGO_WEBHOOK_NOT_CONFIGURED');
  }

  // Payments created before the store-scoped cutover continue through the
  // legacy platform credential path.
  const event = await verifiedMercadoPagoPaymentEvent({
    headers: input.headers,
    dataId,
  });

  if (!event) {
    return {
      accepted: true,
      processed: false,
      duplicate: false,
      paymentId: '',
      orderId: '',
      orderMaterialized: false,
    };
  }

  return processVerifiedOrdinaryPayment(event);
};

export const mapMercadoPagoWebhookError = (
  error: unknown
): MercadoPagoWebhookErrorResult => {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message === 'MERCADO_PAGO_SIGNATURE_MISSING' ||
    message === 'MERCADO_PAGO_SIGNATURE_INVALID'
  ) {
    return { status: 401, body: { error: 'Assinatura de webhook inválida.' } };
  }
  if (message === 'MERCADO_PAGO_WEBHOOK_DATA_ID_REQUIRED') {
    return { status: 400, body: { error: 'Identificador do pagamento ausente.' } };
  }
  if (message === 'MERCADO_PAGO_WEBHOOK_NOT_CONFIGURED') {
    return { status: 503, body: { error: 'Webhook do Mercado Pago não configurado.' } };
  }
  if (message.startsWith('STORE_SUBSCRIPTION_')) {
    console.warn('[Mercado Pago Subscription Webhook]', message);
    return {
      status: 409,
      body: {
        error: 'Notificação de assinatura inconsistente.',
        code: message.split(':', 1)[0],
      },
    };
  }
  if (
    message.startsWith('MERCADO_PAGO_') ||
    message.startsWith('PAYMENT_') ||
    message.startsWith('PROVIDER_') ||
    message.startsWith('CUSTOMER_DESTINATION_')
  ) {
    console.warn('[Mercado Pago Webhook]', message);
    return { status: 409, body: { error: 'Notificação de pagamento inconsistente.' } };
  }
  console.error('[Mercado Pago Webhook]', error);
  return { status: 503, body: { error: 'Não foi possível processar a notificação.' } };
};
