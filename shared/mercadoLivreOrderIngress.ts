import type {
  CustomerOrder,
  CustomerOrderPaymentStatus,
} from '../src/utils/customerOrders.js';

const clean = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const finiteNonNegative = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const positiveInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const validIsoOr = (value: unknown, fallback: string): string => {
  const candidate = clean(value, 100);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : fallback;
};

export interface MercadoLivreOrderLineSnapshot {
  externalItemId: string;
  title: string;
  quantity: number;
  unitPrice: number;
}

export interface MercadoLivreOrderSnapshot {
  externalOrderId: string;
  providerStatus: string;
  sellerId: string;
  buyerId: string;
  buyerName: string;
  totalAmount: number;
  paidAmount: number;
  shippingId: string;
  dateCreated: string;
  lastUpdated: string;
  lines: MercadoLivreOrderLineSnapshot[];
}

export interface MercadoLivreResolvedOrderItemBinding {
  externalItemId: string;
  canonicalProductId: string;
  canonicalStoreId: string;
}

export interface MercadoLivreKdsOrder extends CustomerOrder {
  integration: {
    provider: 'mercado_livre';
    externalOrderId: string;
    providerStatus: string;
    authority: 'provider_api_refetch';
    routingTarget: 'KDS';
  };
}

export const mercadoLivreOrderIdFromResource = (resourceInput: string): string => {
  const resource = resourceInput.trim();
  const match = resource.match(/^\/orders\/([^/?#]+)/i);
  const externalOrderId = clean(match?.[1], 100);
  if (!externalOrderId || !/^[A-Za-z0-9_-]{3,100}$/.test(externalOrderId)) {
    throw new Error('MERCADO_LIVRE_ORDER_RESOURCE_UNSUPPORTED');
  }
  return externalOrderId;
};

export const parseMercadoLivreOrderSnapshot = (
  value: unknown,
  expectedExternalOrderId = '',
  fetchedAtInput = new Date().toISOString()
): MercadoLivreOrderSnapshot => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_ORDER_RESPONSE_INVALID');
  }
  const record = value as Record<string, unknown>;
  const externalOrderId = clean(record.id, 100);
  const providerStatus = clean(record.status, 80).toLowerCase();
  if (
    !externalOrderId ||
    (expectedExternalOrderId && externalOrderId !== expectedExternalOrderId) ||
    !providerStatus
  ) {
    throw new Error('MERCADO_LIVRE_ORDER_RESPONSE_INVALID');
  }

  const seller = record.seller && typeof record.seller === 'object' && !Array.isArray(record.seller)
    ? record.seller as Record<string, unknown>
    : {};
  const buyer = record.buyer && typeof record.buyer === 'object' && !Array.isArray(record.buyer)
    ? record.buyer as Record<string, unknown>
    : {};
  const shipping = record.shipping && typeof record.shipping === 'object' && !Array.isArray(record.shipping)
    ? record.shipping as Record<string, unknown>
    : {};

  const rawItems = Array.isArray(record.order_items) ? record.order_items : [];
  if (!rawItems.length) throw new Error('MERCADO_LIVRE_ORDER_ITEMS_INVALID');
  const lines = rawItems.map((rawLine, index): MercadoLivreOrderLineSnapshot => {
    if (!rawLine || typeof rawLine !== 'object' || Array.isArray(rawLine)) {
      throw new Error(`MERCADO_LIVRE_ORDER_ITEM_INVALID:${index}`);
    }
    const line = rawLine as Record<string, unknown>;
    const item = line.item && typeof line.item === 'object' && !Array.isArray(line.item)
      ? line.item as Record<string, unknown>
      : {};
    const externalItemId = clean(item.id, 160);
    const title = clean(item.title, 180);
    const quantity = positiveInteger(line.quantity);
    const unitPrice = finiteNonNegative(line.unit_price);
    if (!externalItemId || !title || quantity === null || unitPrice === null) {
      throw new Error(`MERCADO_LIVRE_ORDER_ITEM_INVALID:${index}`);
    }
    return { externalItemId, title, quantity, unitPrice };
  });

  const fallbackTotal = lines.reduce((total, line) => total + line.unitPrice * line.quantity, 0);
  const totalAmount = finiteNonNegative(record.total_amount) ?? fallbackTotal;
  const paidAmount = finiteNonNegative(record.paid_amount) ?? 0;
  const firstName = clean(buyer.first_name, 100);
  const lastName = clean(buyer.last_name, 100);
  const fullName = clean([firstName, lastName].filter(Boolean).join(' '), 180);
  const buyerName = fullName || clean(buyer.nickname, 180) || 'Comprador Mercado Livre';
  const fetchedAt = validIsoOr(fetchedAtInput, new Date().toISOString());

  return {
    externalOrderId,
    providerStatus,
    sellerId: clean(seller.id, 100),
    buyerId: clean(buyer.id, 100),
    buyerName,
    totalAmount,
    paidAmount,
    shippingId: clean(shipping.id, 120),
    dateCreated: validIsoOr(record.date_created, fetchedAt),
    lastUpdated: validIsoOr(record.last_updated ?? record.date_closed, fetchedAt),
    lines,
  };
};

export const isMercadoLivreCommerciallyConfirmed = (
  snapshot: Pick<MercadoLivreOrderSnapshot, 'providerStatus'>
): boolean => snapshot.providerStatus === 'paid';

export const isMercadoLivreFinalCancellation = (
  snapshot: Pick<MercadoLivreOrderSnapshot, 'providerStatus'>
): boolean => snapshot.providerStatus === 'cancelled' || snapshot.providerStatus === 'invalid';

const paymentStatusFor = (snapshot: MercadoLivreOrderSnapshot): CustomerOrderPaymentStatus => {
  if (
    snapshot.providerStatus === 'paid' ||
    (snapshot.totalAmount > 0 && snapshot.paidAmount >= snapshot.totalAmount)
  ) return 'paid';
  if (snapshot.paidAmount > 0) return 'partial';
  return 'unpaid';
};

export const normalizeMercadoLivrePaidOrderForKds = (input: {
  snapshot: MercadoLivreOrderSnapshot;
  tenantId: string;
  canonicalStoreId: string;
  bindings: MercadoLivreResolvedOrderItemBinding[];
}): MercadoLivreKdsOrder => {
  const tenantId = input.tenantId.trim();
  const canonicalStoreId = input.canonicalStoreId.trim();
  if (!tenantId || !canonicalStoreId) throw new Error('MERCADO_LIVRE_ORDER_STORE_BINDING_REQUIRED');
  if (!isMercadoLivreCommerciallyConfirmed(input.snapshot)) {
    throw new Error('MERCADO_LIVRE_ORDER_NOT_COMMERCIALLY_CONFIRMED');
  }

  const bindings = new Map(input.bindings.map(binding => [binding.externalItemId, binding]));
  const items = input.snapshot.lines.map((line, index) => {
    const binding = bindings.get(line.externalItemId);
    if (
      !binding ||
      !binding.canonicalProductId.trim() ||
      binding.canonicalStoreId.trim() !== canonicalStoreId
    ) {
      throw new Error(`MERCADO_LIVRE_ORDER_PRODUCT_BINDING_REQUIRED:${line.externalItemId}`);
    }
    return {
      lineId: `ml-${input.snapshot.externalOrderId}-${index + 1}`,
      productId: binding.canonicalProductId.trim(),
      name: line.title,
      price: line.unitPrice,
      quantity: line.quantity,
      paidQuantity: line.quantity,
      transferredQuantity: 0,
      note: '',
      image: '',
      isService: false,
    };
  });
  const subtotal = items.reduce((total, item) => total + item.price * item.quantity, 0);
  const buyerIdentity = input.snapshot.buyerId || input.snapshot.externalOrderId;

  return {
    id: `mercado-livre-order-${input.snapshot.externalOrderId}`,
    storeId: tenantId,
    buyerId: `mercado-livre-buyer-${buyerIdentity}`,
    buyerName: input.snapshot.buyerName,
    buyerEmail: '',
    fulfillmentType: input.snapshot.shippingId ? 'delivery' : 'pickup',
    deliveryAddress: '',
    tableCode: '',
    customerNote: '',
    items,
    subtotal,
    total: input.snapshot.totalAmount,
    status: 'pending',
    paymentStatus: paymentStatusFor(input.snapshot),
    source: 'transfer',
    sourceChannel: 'mercado_livre',
    operatorId: '',
    operatorName: '',
    createdAt: input.snapshot.dateCreated,
    updatedAt: input.snapshot.lastUpdated,
    integration: {
      provider: 'mercado_livre',
      externalOrderId: input.snapshot.externalOrderId,
      providerStatus: input.snapshot.providerStatus,
      authority: 'provider_api_refetch',
      routingTarget: 'KDS',
    },
  };
};
