import { adminDb } from '../firebaseAdmin.js';
import { processVerifiedPaymentWebhook } from './paymentWebhookProcessor.js';
import {
  isMercadoPagoWebhookRuntimeConfigured,
  verifiedMercadoPagoPaymentEvent,
} from './mercadoPagoPixProvider.js';
import { verifiedStoreScopedMercadoPagoPaymentEvent } from './mercadoPagoStoreScopedProvider.js';
import { settleMarketplaceOperationalOrderAfterPayment } from './marketplaceOrderPaymentSettlementService.js';
import { syncPersistedCustomerOrderIntoCrm } from './storeCrmOrderSyncService.js';
import { writeOperationalOrderRefundState } from './orderRefundStateService.js';
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
}

export interface MercadoPagoWebhookErrorResult {
  status: number;
  body: { error: string };
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const projectRefundConfirmation = async (input: {
  storeId: string;
  paymentId: string;
  provider: string;
  amount: number;
  occurredAt: string;
  eventId: string;
}): Promise<string> => {
  const paymentRef = adminDb.doc(
    `stores/${input.storeId}/payments/${input.paymentId}`
  );
  const paymentSnapshot = await paymentRef.get();
  if (!paymentSnapshot.exists) return '';
  const payment = paymentSnapshot.data() as Record<string, unknown>;
  const orderId = clean(payment.orderId);
  if (!orderId) return '';

  await writeOperationalOrderRefundState({
    storeId: input.storeId,
    orderId,
    paymentId: input.paymentId,
    provider: input.provider,
    amount: input.amount,
    status: 'refunded',
    refundedAt: input.occurredAt,
  });

  const refundRef = adminDb.doc(
    `stores/${input.storeId}/paymentRefunds/${input.paymentId}`
  );
  const refundSnapshot = await refundRef.get();
  if (refundSnapshot.exists) {
    await refundRef.set({
      status: 'refunded',
      providerEventId: input.eventId,
      refundedAt: input.occurredAt,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  }
  return orderId;
};

const syncWebhookOrderIntoCrm = async (
  storeId: string,
  orderId: string
): Promise<void> => {
  try {
    await syncPersistedCustomerOrderIntoCrm({ storeId, orderId });
  } catch (error) {
    console.warn(
      '[Mercado Pago Webhook] Pagamento e pedido confirmados; CRM ficará para a reconciliação.',
      error instanceof Error ? error.message : String(error)
    );
  }
};

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

  let effectiveOrderId = result.orderId;
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
  } else if (event.eventType === 'refund.succeeded') {
    effectiveOrderId = await projectRefundConfirmation({
      storeId: event.kyrubStoreId,
      paymentId: event.kyrubPaymentId,
      provider: event.provider,
      amount: event.amount,
      occurredAt: event.occurredAt,
      eventId: event.eventId,
    });
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
    await syncWebhookOrderIntoCrm(event.kyrubStoreId, result.orderId);
  } else if (effectiveOrderId) {
    await syncWebhookOrderIntoCrm(event.kyrubStoreId, effectiveOrderId);
  }

  return {
    accepted: true,
    processed: true,
    duplicate: result.duplicate,
    paymentId: result.paymentId,
    orderId: effectiveOrderId,
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
