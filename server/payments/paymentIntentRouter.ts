import { Router } from 'express';
import { adminDb } from '../firebaseAdmin.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import {
  normalizeCanonicalPaymentIntent,
  type CanonicalPaymentIntent,
  type MarketplaceCanonicalPaymentIntent,
  type PaymentIntentOrderDraft,
} from '../../src/utils/canonicalPaymentIntent.js';
import {
  normalizeCanonicalPayment,
  type CanonicalPayment,
  type PaymentMethod,
} from '../../src/utils/canonicalPayment.js';
import { materializePendingMarketplaceOrder } from '../../src/utils/paymentOrderMaterialization.js';
import { normalizePromotionCode } from '../../src/utils/storePromotions.js';
import { normalizeStorePointsPerUnit } from '../../shared/storePoints.js';
import { attachMercadoPagoPixToExistingIntent } from './mercadoPagoCheckoutBridge.js';
import {
  mapMercadoPagoWebhookError,
  processMercadoPagoWebhook,
} from './mercadoPagoWebhook.js';
import {
  listPublicStorePromotions,
  resolveStorePromotionForCheckout,
} from './storePromotionService.js';

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
  couponCode: string;
}

interface CatalogProduct {
  id: string;
  name: string;
  price: number;
  image: string;
  isService: boolean;
  storePointsPerUnit: number;
}

export interface MarketplacePaymentIntentResponse {
  paymentIntentId: string;
  paymentId: string;
  orderId: string;
  status: 'pending';
  subtotal: number;
  discountTotal: number;
  couponCode: string;
  amount: number;
  currency: 'BRL';
  method: PaymentMethod;
  expiresAt: string;
  providerReady: false;
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

const operationalOrderPath = (storeId: string, orderId: string): string =>
  `artifacts/${storeId}/public/data/customerOrders/${orderId}`;

const parseCheckoutItems = (value: unknown): MarketplaceCheckoutItemInput[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('CHECKOUT_ITEMS_REQUIRED');
  }
  return value.map(item => {
    const record = item && typeof item === 'object'
      ? item as Record<string, unknown>
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
};

const parseCheckout = (value: unknown): MarketplaceCheckoutInput => {
  const candidate = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const fulfillmentType = candidate.fulfillmentType;
  const method = candidate.method;
  if (fulfillmentType !== 'delivery' && fulfillmentType !== 'pickup') {
    throw new Error('CHECKOUT_FULFILLMENT_INVALID');
  }
  if (method !== 'pix' && method !== 'card') {
    throw new Error('CHECKOUT_PAYMENT_METHOD_INVALID');
  }

  const storeId = clean(candidate.storeId);
  const buyerName = clean(candidate.buyerName);
  const buyerEmail = clean(candidate.buyerEmail);
  const deliveryAddress = clean(candidate.deliveryAddress);
  const idempotencyKey = clean(candidate.idempotencyKey);
  if (!storeId || !buyerName || !buyerEmail || !idempotencyKey) {
    throw new Error('CHECKOUT_REQUIRED_FIELDS_MISSING');
  }
  if (idempotencyKey.length > 180) throw new Error('CHECKOUT_IDEMPOTENCY_KEY_INVALID');
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
    items: parseCheckoutItems(candidate.items),
    method,
    idempotencyKey,
    couponCode: normalizePromotionCode(candidate.couponCode),
  };
};

const catalogProducts = (value: unknown): CatalogProduct[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    const id = clean(record.id);
    const name = clean(record.name);
    const price = typeof record.price === 'number' && Number.isFinite(record.price)
      ? Number(record.price.toFixed(2))
      : -1;
    if (!id || !name || price < 0) return [];
    return [{
      id,
      name,
      price: record.isComplimentary === true ? 0 : price,
      image: clean(record.image),
      isService: record.isService === true,
      storePointsPerUnit: normalizeStorePointsPerUnit(record.storePointsPerUnit),
    }];
  });
};

const loadPublishedCatalog = async (storeId: string): Promise<CatalogProduct[]> => {
  const tenantSnapshot = await adminDb.doc(`tenants/${storeId}`).get();
  const tenant = tenantSnapshot.data() as Record<string, unknown> | undefined;
  if (!tenantSnapshot.exists || tenant?.publicationStatus !== 'published') {
    throw new Error('CHECKOUT_STORE_NOT_AVAILABLE');
  }
  return catalogProducts(tenant?.publicProducts);
};

const buildIntentItems = (
  catalog: CatalogProduct[],
  items: MarketplaceCheckoutItemInput[]
) => {
  const productMap = new Map(catalog.map(product => [product.id, product]));
  return items.map(item => {
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
      storePointsPerUnit: product.storePointsPerUnit,
    };
  });
};

const documentToken = (idempotencyKey: string): string =>
  Buffer.from(idempotencyKey).toString('base64url').slice(0, 160);

const paymentIntentResponse = (
  intent: MarketplaceCanonicalPaymentIntent,
  payment: CanonicalPayment,
  duplicate: boolean
): MarketplacePaymentIntentResponse => ({
  paymentIntentId: intent.id,
  paymentId: payment.id,
  orderId: intent.orderDraft.draftId,
  status: 'pending',
  subtotal: intent.orderDraft.subtotal,
  discountTotal: intent.orderDraft.discountTotal ?? 0,
  couponCode: intent.orderDraft.couponCode ?? '',
  amount: intent.amount,
  currency: intent.currency,
  method: intent.method,
  expiresAt: intent.expiresAt,
  providerReady: false,
  duplicate,
});

const resumeApprovedMarketplacePaymentIntent = async (input: {
  storeId: string;
  orderId: string;
  buyerId: string;
}): Promise<MarketplacePaymentIntentHttpResult> => {
  const orderRef = adminDb.doc(operationalOrderPath(input.storeId, input.orderId));
  const orderSnapshot = await orderRef.get();
  if (!orderSnapshot.exists) throw new Error('CHECKOUT_ORDER_NOT_FOUND');
  const order = orderSnapshot.data() as Record<string, unknown>;
  if (
    clean(order.storeId) !== input.storeId ||
    clean(order.id) !== input.orderId ||
    clean(order.buyerId) !== input.buyerId
  ) {
    throw new Error('CHECKOUT_ORDER_NOT_OWNED');
  }
  const status = clean(order.status);
  if (status === 'pending') throw new Error('CHECKOUT_ORDER_APPROVAL_REQUIRED');
  if (status !== 'accepted') throw new Error('CHECKOUT_ORDER_NOT_PAYABLE');
  if (clean(order.paymentStatus) === 'paid') throw new Error('CHECKOUT_ORDER_ALREADY_PAID');

  const paymentIntentId = clean(order.paymentIntentId);
  const paymentId = clean(order.paymentId);
  if (!paymentIntentId || !paymentId) {
    throw new Error('CHECKOUT_PAYMENT_REFERENCE_MISSING');
  }

  const [intentSnapshot, paymentSnapshot] = await Promise.all([
    adminDb.doc(`stores/${input.storeId}/paymentIntents/${paymentIntentId}`).get(),
    adminDb.doc(`stores/${input.storeId}/payments/${paymentId}`).get(),
  ]);
  if (!intentSnapshot.exists || !paymentSnapshot.exists) {
    throw new Error('CHECKOUT_PAYMENT_STATE_MISSING');
  }
  const intent = normalizeCanonicalPaymentIntent(
    intentSnapshot.data() as CanonicalPaymentIntent
  );
  const payment = normalizeCanonicalPayment(
    paymentSnapshot.data() as CanonicalPayment
  );
  if (
    intent.context !== 'marketplace' ||
    intent.storeId !== input.storeId ||
    intent.buyerId !== input.buyerId ||
    intent.target.orderId !== input.orderId ||
    payment.storeId !== input.storeId ||
    payment.buyerId !== input.buyerId ||
    payment.orderId !== input.orderId ||
    payment.status !== 'pending' ||
    intent.status !== 'pending'
  ) {
    throw new Error('CHECKOUT_PAYMENT_STATE_MISMATCH');
  }

  return {
    status: 200,
    body: paymentIntentResponse(intent, payment, true),
  };
};

export const mapMarketplaceCheckoutError = (
  error: unknown
): MarketplaceCheckoutErrorResult => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED' || /id-token|expired|revoked/i.test(message)) {
    return { status: 401, body: { error: 'Faça login novamente.' } };
  }
  if (message === 'CHECKOUT_STORE_NOT_AVAILABLE') {
    return { status: 404, body: { error: 'A loja não está disponível para checkout.' } };
  }
  if (message === 'CHECKOUT_PRODUCT_NOT_AVAILABLE') {
    return {
      status: 409,
      body: { error: 'Um item do carrinho não está mais disponível. Revise o carrinho.' },
    };
  }
  if (message === 'CHECKOUT_TOTAL_MUST_BE_POSITIVE') {
    return {
      status: 409,
      body: { error: 'Este checkout ainda não suporta pedidos com total zero.' },
    };
  }
  if (message === 'CHECKOUT_COUPON_NOT_FOUND') {
    return { status: 404, body: { error: 'Cupom não encontrado nesta loja.' } };
  }
  if (message === 'CHECKOUT_COUPON_NOT_AVAILABLE') {
    return { status: 409, body: { error: 'Este cupom não está mais disponível.' } };
  }
  if (message === 'CHECKOUT_COUPON_NOT_ELIGIBLE') {
    return { status: 403, body: { error: 'Este cupom não está disponível para este perfil.' } };
  }
  if (message === 'CHECKOUT_COUPON_BUYER_LIMIT_REACHED') {
    return { status: 409, body: { error: 'Você já utilizou o limite permitido deste cupom.' } };
  }
  if (message === 'PROMOTION_NOT_APPLICABLE') {
    return { status: 409, body: { error: 'O cupom não se aplica aos itens deste carrinho.' } };
  }
  if (message === 'CHECKOUT_ORDER_NOT_FOUND') {
    return { status: 404, body: { error: 'Pedido não encontrado para pagamento.' } };
  }
  if (message === 'CHECKOUT_ORDER_NOT_OWNED') {
    return { status: 403, body: { error: 'Este pedido pertence a outro comprador.' } };
  }
  if (message === 'CHECKOUT_ORDER_APPROVAL_REQUIRED') {
    return { status: 409, body: { error: 'A loja ainda precisa aceitar o pedido antes do pagamento.' } };
  }
  if (message === 'CHECKOUT_ORDER_NOT_PAYABLE') {
    return { status: 409, body: { error: 'Este pedido não está disponível para pagamento.' } };
  }
  if (message === 'CHECKOUT_ORDER_ALREADY_PAID') {
    return { status: 409, body: { error: 'Este pedido já está pago.' } };
  }
  if (/Collector user without key enabled for QR render/i.test(message)) {
    return {
      status: 503,
      body: {
        error: 'O recebimento por Pix ainda não está habilitado na conta Mercado Pago desta loja. Cadastre ou ative uma chave Pix na conta recebedora e tente novamente.',
      },
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

export const createMarketplacePaymentIntent = async (
  authorization: string,
  body: unknown
): Promise<MarketplacePaymentIntentHttpResult> => {
  const token = bearerToken(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const identity = await verifyFirebaseIdToken(token);
  const candidate = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const resumeOrderId = clean(candidate.resumeOrderId);
  const resumeStoreId = clean(candidate.storeId);
  if (resumeOrderId) {
    if (!resumeStoreId) throw new Error('CHECKOUT_REQUIRED_FIELDS_MISSING');
    return resumeApprovedMarketplacePaymentIntent({
      storeId: resumeStoreId,
      orderId: resumeOrderId,
      buyerId: identity.uid,
    });
  }

  const input = parseCheckout(body);
  const catalog = await loadPublishedCatalog(input.storeId);
  const intentItems = buildIntentItems(catalog, input.items);
  const subtotal = Number(
    intentItems.reduce((sum, item) => sum + item.total, 0).toFixed(2)
  );
  if (subtotal <= 0) throw new Error('CHECKOUT_TOTAL_MUST_BE_POSITIVE');

  const resolvedPromotion = input.couponCode
    ? await resolveStorePromotionForCheckout({
        storeId: input.storeId,
        buyerId: identity.uid,
        couponCode: input.couponCode,
        lines: intentItems.map(item => ({
          productId: item.productId,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
        })),
      })
    : null;
  const discountTotal = resolvedPromotion?.quote.discountTotal ?? 0;
  const amount = Number((subtotal - discountTotal).toFixed(2));
  if (amount <= 0) throw new Error('CHECKOUT_TOTAL_MUST_BE_POSITIVE');

  const suffix = documentToken(`${identity.uid}|${input.storeId}|${input.idempotencyKey}`);
  const intentId = `pi_${suffix}`;
  const paymentId = `pay_${suffix}`;
  const orderId = `customer-order-${identity.uid}-${suffix.slice(0, 48)}`;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const orderDraft: PaymentIntentOrderDraft = {
    draftId: orderId,
    storeId: input.storeId,
    buyerId: identity.uid,
    buyerName: input.buyerName,
    buyerEmail: input.buyerEmail,
    fulfillmentType: input.fulfillmentType,
    deliveryAddress: input.fulfillmentType === 'delivery' ? input.deliveryAddress : '',
    customerNote: input.customerNote,
    items: intentItems,
    subtotal,
    discountTotal,
    couponCode: resolvedPromotion?.quote.code ?? '',
    promotionSnapshot: resolvedPromotion ? {
      promotionId: resolvedPromotion.promotion.id,
      code: resolvedPromotion.quote.code,
      title: resolvedPromotion.quote.title,
      badge: resolvedPromotion.quote.badge,
      discountType: resolvedPromotion.quote.discountType,
      discountValue: resolvedPromotion.quote.discountValue,
      eligibleProductIds: resolvedPromotion.quote.eligibleProductIds,
    } : null,
    deliveryFee: 0,
    total: amount,
  };
  const intent = normalizeCanonicalPaymentIntent({
    id: intentId,
    storeId: input.storeId,
    buyerId: identity.uid,
    method: input.method,
    status: 'pending',
    amount,
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
    paymentIntentId: intentId,
    amount,
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
  const pendingOrder = materializePendingMarketplaceOrder({
    intent,
    paymentId,
    now,
  });

  const intentRef = adminDb.doc(`stores/${input.storeId}/paymentIntents/${intentId}`);
  const paymentRef = adminDb.doc(`stores/${input.storeId}/payments/${paymentId}`);
  const orderRef = adminDb.doc(operationalOrderPath(input.storeId, orderId));
  const result = await adminDb.runTransaction(async transaction => {
    const [existingIntent, existingPayment, existingOrder] = await Promise.all([
      transaction.get(intentRef),
      transaction.get(paymentRef),
      transaction.get(orderRef),
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
        savedIntent.context !== 'marketplace' ||
        savedIntent.buyerId !== identity.uid ||
        savedIntent.storeId !== input.storeId ||
        savedIntent.idempotencyKey !== input.idempotencyKey ||
        savedPayment.idempotencyKey !== input.idempotencyKey
      ) {
        throw new Error('CHECKOUT_IDEMPOTENCY_CONFLICT');
      }
      if (!existingOrder.exists && savedIntent.status === 'pending' && savedPayment.status === 'pending') {
        transaction.set(orderRef, materializePendingMarketplaceOrder({
          intent: savedIntent,
          paymentId: savedPayment.id,
          now,
        }));
      }
      return { intent: savedIntent, payment: savedPayment, duplicate: true };
    }
    if (existingOrder.exists) throw new Error('CHECKOUT_IDEMPOTENCY_CONFLICT');
    transaction.set(intentRef, intent);
    transaction.set(paymentRef, payment);
    transaction.set(orderRef, pendingOrder);
    return { intent, payment, duplicate: false };
  });

  return {
    status: result.duplicate ? 200 : 201,
    body: paymentIntentResponse(result.intent, result.payment, result.duplicate),
  };
};

export const createPaymentIntentRouter = (): Router => {
  const router = Router();

  router.get('/promotions', async (request, response) => {
    try {
      const storeId = clean(request.query.storeId);
      if (!storeId) {
        response.status(400).json({ error: 'Loja não identificada.' });
        return;
      }
      await loadPublishedCatalog(storeId);
      response.status(200).json({
        promotions: await listPublicStorePromotions(storeId),
      });
    } catch (error) {
      const mapped = mapMarketplaceCheckoutError(error);
      response.status(mapped.status).json(mapped.body);
    }
  });

  router.post('/coupons/quote', async (request, response) => {
    try {
      const token = bearerToken(request.get('authorization') ?? '');
      if (!token) throw new Error('AUTH_REQUIRED');
      const identity = await verifyFirebaseIdToken(token);
      const body = request.body && typeof request.body === 'object'
        ? request.body as Record<string, unknown>
        : {};
      const storeId = clean(body.storeId);
      const couponCode = normalizePromotionCode(body.couponCode);
      if (!storeId || !couponCode) throw new Error('CHECKOUT_REQUIRED_FIELDS_MISSING');
      const items = parseCheckoutItems(body.items);
      const catalog = await loadPublishedCatalog(storeId);
      const intentItems = buildIntentItems(catalog, items);
      const resolved = await resolveStorePromotionForCheckout({
        storeId,
        buyerId: identity.uid,
        couponCode,
        lines: intentItems.map(item => ({
          productId: item.productId,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
        })),
      });
      response.status(200).json(resolved.quote);
    } catch (error) {
      const mapped = mapMarketplaceCheckoutError(error);
      response.status(mapped.status).json(mapped.body);
    }
  });

  router.post('/intents', async (request, response) => {
    try {
      const result = await createMarketplacePaymentIntent(
        request.get('authorization') ?? '',
        request.body
      );
      const body = request.body && typeof request.body === 'object'
        ? request.body as Record<string, unknown>
        : {};
      const pix = await attachMercadoPagoPixToExistingIntent({
        storeId: clean(body.storeId),
        paymentIntentId: result.body.paymentIntentId,
        paymentId: result.body.paymentId,
        expiresAt: result.body.expiresAt,
      });
      response.status(result.status).json({
        ...result.body,
        ...pix,
      });
    } catch (error) {
      const mapped = mapMarketplaceCheckoutError(error);
      response.status(mapped.status).json(mapped.body);
    }
  });

  router.post('/webhooks/mercado-pago', async (request, response) => {
    try {
      const body = request.body as { data?: { id?: unknown } } | undefined;
      const dataId = clean(request.query['data.id']) || clean(body?.data?.id);
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
