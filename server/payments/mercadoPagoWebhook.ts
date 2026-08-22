import { processVerifiedPaymentWebhook } from './paymentWebhookProcessor';
import {
  isMercadoPagoWebhookRuntimeConfigured,
  verifiedMercadoPagoPaymentEvent,
} from './mercadoPagoPixProvider';

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

  const result = await processVerifiedPaymentWebhook({
    storeId: event.kyrubStoreId,
    paymentId: event.kyrubPaymentId,
    event,
  });

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
    message.startsWith('PROVIDER_')
  ) {
    console.warn('[Mercado Pago Webhook]', message);
    return { status: 409, body: { error: 'Notificação de pagamento inconsistente.' } };
  }
  console.error('[Mercado Pago Webhook]', error);
  return { status: 503, body: { error: 'Não foi possível processar a notificação.' } };
};
