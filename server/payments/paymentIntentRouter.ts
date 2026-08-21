import { Router } from 'express';
import { adminAuth, adminDb } from '../firebaseAdmin';
import {
  normalizeCanonicalPaymentIntent,
  type CanonicalPaymentIntent,
  type PaymentIntentOrderDraft,
} from '../../src/utils/canonicalPaymentIntent';
import {
  normalizeCanonicalPayment,
  type CanonicalPayment,
  type PaymentMethod,
} from '../../src/utils/canonicalPayment';
import {
  createMercadoPagoPixPayment,
  getMercadoPagoPixCheckout,
  isMercadoPagoPixConfigured,
  type MercadoPagoPixCheckout,
} from './mercadoPagoPixProvider';
import {
  mapMercadoPagoWebhookError,
  processMercadoPagoWebhook,
} from './mercadoPagoWebhook';

interface MarketplaceCheckoutItemInput {
  productId: string;
  quantity: number;
  note?: string;
}

interface MarketplaceCheckoutInput {
  storeId: string;
  buyerName: string;
  buyerEmail: string;
  fulfillmentType: 'delivery' | 'pickup';
  deliveryAddress: string;
  customerNote: string;
  items: MarketplaceCheckoutItemInput[];
  method: PaymentMethod;
  idempotencyKey: string;
}

interface CatalogProduct {
  id: string;
  name: string;
  price: number;
  image: string;
  isService: boolean;
}

export interface MarketplacePaymentIntentResponse {
  paymentIntentId: string;
  paymentId: string;
  orderId: string;
  status: 'pending';
  amount: number;
  currency: 'BRL';
  method: PaymentMethod;
  expiresAt: string;
  providerReady: boolean;
  provider: string;
  providerPaymentId: string;
  pixQrCode: string;
  pixQrCodeBase64: string;
  pixTicketUrl: string;
  duplicate: boolean;
}

export interface MarketplacePaymentIntentHttpResult {
  status: 200 | 201;
  body: MarketplacePaymentIntentResponse;
}

export interface MarketplaceCheckoutErrorResult {
  status: number;
  body: { error: string };
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const parseCheckout = (value: unknown): MarketplaceCheckoutInput => {
  const candidate =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  const fulfillmentType = candidate.fulfillmentType;
  const method = candidate.method;
  if (fulfillmentType !== 'delivery' && fulfillmentType !== 'pickup') {
    throw new Error('CHECKOUT_FULFILLMENT_INVALID');
  }
  if (method !== 'pix' && method !== 'card') {
    throw new Error('CHECKOUT_PAYMENT_METHOD_INVALID');
  }
  if (!Array.isArray(candidate.items) || candidate.items.length === 0) {
    throw new Error('CHECKOUT_ITEMS_REQUIRED');
  }

  const items = candidate.items.map(item => {
    const record =
      item && typeof item === 'object'
        ? (item as Record<string, unknown>)
        : {};
    const productId = clean(record.productId);
    const quantity = record.quantity;
    if (!productId || !Number.isInteger(quantity) || Number(quantity) <= 0) {
      throw new Error('CHECKOUT_ITEM_INVALID');
    }
    return {
      productId,
      quantity: Number(quantity),
      note: clean(record.note),
    };
  });

  const storeId = clean(candidate.storeId);
  const buyerName = clean(candidate.buyerName);
  const buyerEmail = clean(candidate.buyerEmail);
  const deliveryAddress = clean(candidate.deliveryAddress);
  const idempotencyKey = clean(candidate.idempotencyKey);
  if (!storeId || !buyerName || !buyerEmail || !idempotencyKey) {
    throw new Error('CHECKOUT_REQUIRED_FIELDS_MISSING');
  }
  if (idempotencyKey.length > 180) {
    throw new Error('CHECKOUT_IDEMPOTENCY_KEY_INVALID');
  }
  if (fulfillmentType === 'delivery' && !deliveryAddress) {
    throw new Error('CHECKOUT_DELIVERY_ADDRESS_REQUIRED');
  }

  return {
    storeId,
    buyerName,
    buyerEmail,
    fulfillmentType,
    deliveryAddress,
    customerNote: clean(candidate.customerNote),
    items,
    method,
    idempotencyKey,
  };
};

const catalogProducts = (value: unknown): CatalogProduct[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    const id = clean(record.id);
    const name = clean(record.name);
    const price =
      typeof record.price === 'number' && Number.isFinite(record.price)
        ? Number(record.price.toFixed(2))
        : -1;
    if (!id || !name || price < 0) return [];
    return [
      {
        id,
        name,
        price: record.isComplimentary === true ? 0 : price,
        image: clean(record.image),
        isService: record.isService === true,
      },
    ];
  });
};

const documentToken = (idempotencyKey: string): string =>
  Buffer.from(idempotencyKey).toString('base64url').slice(0, 160);

export const mapMarketplaceCheckoutError = (
  error: unknown
): MarketplaceCheckoutErrorResult => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED' || /id-token|expired|revoked/i.test(message)) {
    return { status: 401, body: { error: 'Faça login novamente.' } };
  }
  if (message === 'CHECKOUT_STORE_NOT_AVAILABLE') {
    return {
      status: 404,
      body: { error: 'A loja não está disponível para checkout.' },
    };
  }
  if (message === 'CHECKOUT_PRODUCT_NOT_AVAILABLE') {
    return {
      status: 409,
      body: {
        error: 'Um item do carrinho não está mais disponível. Revise o carrinho.',
      },
    };
  }
  if (message === 'CHECKOUT_TOTAL_MUST_BE_POSITIVE') {
    return {
      status: 409,
      body: { error: 'Este checkout ainda não suporta pedidos com total zero.' },
    };
  }
  if (message.startsWith('MERCADO_PAGO_API_ERROR:')) {
    console.error('[Marketplace Checkout] Mercado Pago', message);
    return {
      status: 502,
      body: { error: 'O Mercado Pago não conseguiu gerar o Pix agora.' },
    };
  }
  if (/^CHECKOUT_/.test(message)) {
    return {
      status: 400,
      body: { error: 'Revise os dados do checkout antes de continuar.' },
    };
  }
  console.error('[Marketplace Checkout]', error);
  return {
    status: 503,
    body: { error: 'Não foi possível iniciar o pagamento agora.' },
  };
};

const attachMercadoPagoPix = async (input: {
  intent: CanonicalPaymentIntent;
  payment: CanonicalPayment;
}): Promise<MercadoPagoPixCheckout | null> => {
  if (input.intent.method !== 'pix' || !isMercadoPagoPixConfigured()) {
    return null;
  }

  const pix = input.intent.providerIntentId
    ? await getMercadoPagoPixCheckout(input.intent.providerIntentId)
    : await createMercadoPagoPixPayment({
        intent: input.intent,
        paymentId: input.payment.id,
      });

  const intentRef = adminDb.doc(
    `stores/${input.intent.storeId}/paymentIntents/${input.intent.id}`
  );
  const paymentRef = adminDb.doc(
    `stores/${input.payment.storeId}/payments/${input.payment.id}`
  );
  await adminDb.runTransaction(async transaction => {
    const [intentSnapshot, paymentSnapshot] = await Promise.all([
      transaction.get(intentRef),
      transaction.get(paymentRef),
    ]);
    if (!intentSnapshot.exists || !paymentSnapshot.exists) {
      throw new Error('CHECKOUT_PAYMENT_STATE_MISSING');
    }
    const currentIntent = normalizeCanonicalPaymentIntent(
      intentSnapshot.data() as CanonicalPaymentIntent
    );
    const currentPayment = normalizeCanonicalPayment(
      paymentSnapshot.data() as CanonicalPayment
    );
    if (
      currentIntent.providerIntentId &&
      currentIntent.providerIntentId !== pix.providerPaymentId
    ) {
      throw new Error('CHECKOUT_PROVIDER_PAYMENT_CONFLICT');
    }
    if (
      currentPayment.providerPaymentId &&
      currentPayment.providerPaymentId !== pix.providerPaymentId
    ) {
      throw new Error('CHECKOUT_PROVIDER_PAYMENT_CONFLICT');
    }
    transaction.update(intentRef, {
      provider: pix.provider,
      providerIntentId: pix.providerPaymentId,
      updatedAt: new Date().toISOString(),
    });
    transaction.update(paymentRef, {
      provider: pix.provider,
      providerPaymentId: pix.providerPaymentId,
      updatedAt: new Date().toISOString(),
    });
  });

  return pix;
};

export const createMarketplacePaymentIntent = async (
  authorization: string,
  body: unknown
): Promise<MarketplacePaymentIntentHttpResult> => {
  const token = bearerToken(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const identity = await adminAuth.verifyIdToken(token, true);
  const input = parseCheckout(body);
  const tenantRef = adminDb.doc(`tenants/${input.storeId}`);
  const tenantSnapshot = await tenantRef.get();
  const tenant = tenantSnapshot.data() as Record<string, unknown> | undefined;
  if (!tenantSnapshot.exists || tenant?.publicationStatus !== 'published') {
    throw new Error('CHECKOUT_STORE_NOT_AVAILABLE');
  }

  const catalog = catalogProducts(tenant?.publicProducts);
  const productMap = new Map(catalog.map(product => [product.id, product]));
  const intentItems = input.items.map(item => {
    const product = productMap.get(item.productId);
    if (!product) throw new Error('CHECKOUT_PRODUCT_NOT_AVAILABLE');
    const total = Number((product.price * item.quantity).toFixed(2));
    return {
      productId: product.id,
      name: product.name,
      quantity: item.quantity,
      unitPrice: product.price,
      total,
      note: item.note ?? '',
      image: product.image,
      isService: product.isService,
    };
  });
  const subtotal = Number(
    intentItems.reduce((sum, item) => sum + item.total, 0).toFixed(2)
  );
  if (subtotal <= 0) throw new Error('CHECKOUT_TOTAL_MUST_BE_POSITIVE');

  const suffix = documentToken(
    `${identity.uid}|${input.storeId}|${input.idempotencyKey}`
  );
  const intentId = `pi_${suffix}`;
  const paymentId = `pay_${suffix}`;
  const orderId = `customer-order-${identity.uid}-${suffix.slice(0, 48)}`;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const orderDraft: PaymentIntentOrderDraft = {
    draftId: orderId,
    storeId: input.storeId,
    buyerId: identity.uid,
    buyerName: input.buyerName,
    buyerEmail: input.buyerEmail,
    fulfillmentType: input.fulfillmentType,
    deliveryAddress:
      input.fulfillmentType === 'delivery' ? input.deliveryAddress : '',
    customerNote: input.customerNote,
    items: intentItems,
    subtotal,
    deliveryFee: 0,
    total: subtotal,
  };
  const intent = normalizeCanonicalPaymentIntent({
    id: intentId,
    storeId: input.storeId,
    buyerId: identity.uid,
    method: input.method,
    status: 'pending',
    amount: subtotal,
    currency: 'BRL',
    provider: '',
    providerIntentId: '',
    idempotencyKey: input.idempotencyKey,
    orderDraft,
    createdAt: now,
    updatedAt: now,
    expiresAt,
  });
  const payment = normalizeCanonicalPayment({
    id: paymentId,
    storeId: input.storeId,
    orderId,
    buyerId: identity.uid,
    amount: subtotal,
    currency: 'BRL',
    method: input.method,
    context: 'marketplace',
    status: 'pending',
    provider: '',
    providerPaymentId: '',
    idempotencyKey: input.idempotencyKey,
    createdAt: now,
    updatedAt: now,
    paidAt: '',
    refundedAt: '',
  });

  const intentRef = adminDb.doc(
    `stores/${input.storeId}/paymentIntents/${intentId}`
  );
  const paymentRef = adminDb.doc(`stores/${input.storeId}/payments/${paymentId}`);
  const result = await adminDb.runTransaction(async transaction => {
    const [existingIntent, existingPayment] = await Promise.all([
      transaction.get(intentRef),
      transaction.get(paymentRef),
    ]);
    if (existingIntent.exists || existingPayment.exists) {
      if (!existingIntent.exists || !existingPayment.exists) {
        throw new Error('CHECKOUT_IDEMPOTENCY_CONFLICT');
      }
      const savedIntent = normalizeCanonicalPaymentIntent(
        existingIntent.data() as CanonicalPaymentIntent
      );
      const savedPayment = normalizeCanonicalPayment(
        existingPayment.data() as CanonicalPayment
      );
      if (
        savedIntent.buyerId !== identity.uid ||
        savedIntent.storeId !== input.storeId ||
        savedIntent.idempotencyKey !== input.idempotencyKey ||
        savedPayment.idempotencyKey !== input.idempotencyKey
      ) {
        throw new Error('CHECKOUT_IDEMPOTENCY_CONFLICT');
      }
      return {
        intent: savedIntent,
        payment: savedPayment,
        duplicate: true,
      };
    }
    transaction.set(intentRef, intent);
    transaction.set(paymentRef, payment);
    return { intent, payment, duplicate: false };
  });

  const pix = await attachMercadoPagoPix({
    intent: result.intent,
    payment: result.payment,
  });

  return {
    status: result.duplicate ? 200 : 201,
    body: {
      paymentIntentId: result.intent.id,
      paymentId: result.payment.id,
      orderId: result.intent.orderDraft.draftId,
      status: 'pending',
      amount: result.intent.amount,
      currency: result.intent.currency,
      method: result.intent.method,
      expiresAt: pix?.expiresAt || result.intent.expiresAt,
      providerReady: Boolean(pix && (pix.qrCode || pix.ticketUrl)),
      provider: pix?.provider ?? '',
      providerPaymentId: pix?.providerPaymentId ?? '',
      pixQrCode: pix?.qrCode ?? '',
      pixQrCodeBase64: pix?.qrCodeBase64 ?? '',
      pixTicketUrl: pix?.ticketUrl ?? '',
      duplicate: result.duplicate,
    },
  };
};

export const createPaymentIntentRouter = (): Router => {
  const router = Router();

  router.post('/intents', async (request, response) => {
    try {
      const result = await createMarketplacePaymentIntent(
        request.get('authorization') ?? '',
        request.body
      );
      response.status(result.status).json(result.body);
    } catch (error) {
      const mapped = mapMarketplaceCheckoutError(error);
      response.status(mapped.status).json(mapped.body);
    }
  });

  router.post('/webhooks/mercado-pago', async (request, response) => {
    try {
      const dataId = clean(request.query['data.id']) ||
        clean((request.body as { data?: { id?: unknown } } | undefined)?.data?.id);
      const result = await processMercadoPagoWebhook({
        headers: request.headers,
        dataId,
      });
      response.status(200).json(result);
    } catch (error) {
      const mapped = mapMercadoPagoWebhookError(error);
      response.status(mapped.status).json(mapped.body);
    }
  });

  return router;
};