import { processVerifiedPaymentWebhook } from './paymentWebhookProcessor.js';
import {
  isMercadoPagoWebhookRuntimeConfigured,
  verifiedMercadoPagoPaymentEvent,
} from './mercadoPagoPixProvider.js';
import { verifiedStoreScopedMercadoPagoPaymentEvent } from './mercadoPagoStoreScopedProvider.js';
import { settleMarketplaceOperationalOrderAfterPayment } from './marketplaceOrderPaymentSettlementService.js';
import { syncPersistedCustomerOrderIntoCrm } from './storeCrmOrderSyncService.js';
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
}

export interface MercadoPagoWebhookErrorResult {
  status: number;
  body: { error: string };
}

export const processMercadoPagoWebhook = async (input: {
  headers: Record<string, string | string[] | undefined>;
  dataId: string;
}): Promise<MercadoPagoWebhookResult> => {
  if (!(await isMercadoPagoWebhookRuntimeConfigured())) {
    throw new Error('MERCADO_PAGO_WEBHOOK_NOT_CONFIGURED');
  }
  const dataId = input.dataId.trim();
  if (!dataId) throw new Error('MERCADO_PAGO_WEBHOOK_DATA_ID_REQUIRED');

  // New local/direct payments are resolved from a server-owned provider binding
  // before the Mercado Pago payment is fetched. This prevents webhook metadata
  // from selecting another merchant credential. Payments created before this
  // cutover continue through the legacy platform credential path.
  const storeScopedEvent = await verifiedStoreScopedMercadoPagoPaymentEvent({
    headers: input.headers,
    dataId,
  });
  const event = storeScopedEvent ?? await verifiedMercadoPagoPaymentEvent({
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
