import { URL } from 'node:url';
import type { CanonicalSourceChannel } from '../../src/utils/sourceChannel';

export const OPEN_DELIVERY_VERSION = '1.7.0';

export type OpenDeliveryEventType =
  | 'CREATED'
  | 'CONFIRMED'
  | 'PREPARATION_REQUESTED'
  | 'PREPARING'
  | 'DISPATCHED'
  | 'READY_FOR_PICKUP'
  | 'PICKUP_AREA_ASSIGNED'
  | 'PICKED_UP'
  | 'DELIVERED'
  | 'CONCLUDED'
  | 'CANCELLATION_REQUESTED'
  | 'CANCELLATION_REQUEST_DENIED'
  | 'CANCELLED'
  | 'ORDER_CANCELLATION_REQUEST'
  | 'CANCELLED_DENIED';

export interface OpenDeliveryEvent {
  eventId: string;
  eventType: OpenDeliveryEventType;
  orderId: string;
  orderURL: string;
  createdAt: string;
  sourceAppId: string;
  virtualBrand: string;
}

export interface OpenDeliveryCredentials {
  clientId: string;
  clientSecret: string;
}

export interface OpenDeliveryConnectionRuntime {
  connectionId: string;
  tenantId: string;
  externalStoreId: string;
  baseUrl: string;
  tokenUrl: string;
  routingTarget: string;
  credentials: OpenDeliveryCredentials;
}

export interface OpenDeliveryToken {
  accessToken: string;
  expiresAt: number;
}

export interface NormalizedIntegrationOrderItem {
  lineId: string;
  productId: string;
  name: string;
  price: number;
  quantity: number;
  paidQuantity: number;
  transferredQuantity: number;
  note: string;
  image: string;
  isService: boolean;
}

export interface NormalizedIntegrationOrder {
  id: string;
  storeId: string;
  buyerId: string;
  buyerName: string;
  buyerEmail: string;
  fulfillmentType: 'delivery' | 'pickup' | 'dine_in';
  deliveryAddress: string;
  tableCode: string;
  customerNote: string;
  items: NormalizedIntegrationOrderItem[];
  subtotal: number;
  total: number;
  status:
    | 'pending'
    | 'accepted'
    | 'preparing'
    | 'ready'
    | 'out_for_delivery'
    | 'completed'
    | 'rejected'
    | 'cancelled';
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  source: 'transfer';
  sourceChannel: CanonicalSourceChannel;
  operatorId: string;
  operatorName: string;
  createdAt: string;
  updatedAt: string;
  integration: {
    provider: '99food';
    protocol: 'open-delivery';
    protocolVersion: string;
    externalOrderId: string;
    displayId: string;
    sourceAppId: string;
    routingTarget: string;
    lastEvent: string;
  };
}

export interface OpenDeliveryActionRequest {
  path: string;
  body?: Record<string, unknown>;
}

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};

const cleanString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const positiveInteger = (value: unknown): number | null => {
  const parsed = finiteNumber(value);
  return parsed !== null && Number.isInteger(parsed) && parsed > 0
    ? parsed
    : null;
};

const priceValue = (value: unknown): number | null => {
  const direct = finiteNumber(value);
  if (direct !== null) return direct;
  return finiteNumber(asRecord(value).value);
};

const firstNonEmpty = (...values: unknown[]): string => {
  for (const value of values) {
    const normalized = cleanString(value);
    if (normalized) return normalized;
  }
  return '';
};

const firstPrice = (...values: unknown[]): number | null => {
  for (const value of values) {
    const normalized = priceValue(value);
    if (normalized !== null) return normalized;
  }
  return null;
};

const EVENT_TYPES = new Set<OpenDeliveryEventType>([
  'CREATED',
  'CONFIRMED',
  'PREPARATION_REQUESTED',
  'PREPARING',
  'DISPATCHED',
  'READY_FOR_PICKUP',
  'PICKUP_AREA_ASSIGNED',
  'PICKED_UP',
  'DELIVERED',
  'CONCLUDED',
  'CANCELLATION_REQUESTED',
  'CANCELLATION_REQUEST_DENIED',
  'CANCELLED',
  'ORDER_CANCELLATION_REQUEST',
  'CANCELLED_DENIED',
]);

export const parseOpenDeliveryEvent = (value: unknown): OpenDeliveryEvent => {
  const candidate = asRecord(value);
  const eventId = firstNonEmpty(candidate.eventId, candidate.id);
  const eventType = cleanString(candidate.eventType) as OpenDeliveryEventType;
  const orderId = cleanString(candidate.orderId);

  if (!eventId || !orderId || !EVENT_TYPES.has(eventType)) {
    throw new Error('Evento Open Delivery inválido ou incompleto.');
  }

  return {
    eventId,
    eventType,
    orderId,
    orderURL: cleanString(candidate.orderURL),
    createdAt: cleanString(candidate.createdAt) || new Date().toISOString(),
    sourceAppId: cleanString(candidate.sourceAppId),
    virtualBrand: cleanString(candidate.virtualBrand),
  };
};

export const parseOpenDeliveryEvents = (value: unknown): OpenDeliveryEvent[] => {
  if (!Array.isArray(value)) return [];
  return value.map(parseOpenDeliveryEvent);
};

const formatAddress = (value: unknown): string => {
  const address = asRecord(value);
  const formatted = cleanString(address.formattedAddress);
  if (formatted) return formatted;

  const streetLine = [
    cleanString(address.street),
    cleanString(address.number),
  ].filter(Boolean).join(', ');
  const complement = cleanString(address.complement);
  const district = cleanString(address.district);
  const cityState = [cleanString(address.city), cleanString(address.state)]
    .filter(Boolean)
    .join(' - ');
  const postalCode = cleanString(address.postalCode);

  return [streetLine, complement, district, cityState, postalCode]
    .filter(Boolean)
    .join(' · ');
};

const itemOptionSummary = (value: unknown): string => {
  if (!Array.isArray(value)) return '';
  return value.flatMap(option => {
    const record = asRecord(option);
    const name = firstNonEmpty(record.name, record.description);
    const quantity = positiveInteger(record.quantity) ?? 1;
    return name ? [`${quantity}x ${name}`] : [];
  }).join(', ');
};

const mapOrderStatus = (lastEvent: string): NormalizedIntegrationOrder['status'] => {
  switch (lastEvent) {
    case 'CONFIRMED':
    case 'PREPARATION_REQUESTED':
      return 'accepted';
    case 'PREPARING':
      return 'preparing';
    case 'READY_FOR_PICKUP':
    case 'PICKUP_AREA_ASSIGNED':
      return 'ready';
    case 'DISPATCHED':
    case 'PICKED_UP':
      return 'out_for_delivery';
    case 'DELIVERED':
    case 'CONCLUDED':
      return 'completed';
    case 'CANCELLED':
      return 'cancelled';
    default:
      return 'pending';
  }
};

export const mapOpenDeliveryEventToOrderStatus = (
  eventType: OpenDeliveryEventType
): NormalizedIntegrationOrder['status'] | null => {
  if (eventType === 'CANCELLATION_REQUEST_DENIED' || eventType === 'CANCELLED_DENIED') {
    return null;
  }
  return mapOrderStatus(eventType);
};

export const normalizeOpenDeliveryOrder = (
  value: unknown,
  context: {
    tenantId: string;
    routingTarget: string;
    sourceAppId?: string;
    receivedAt?: string;
  }
): NormalizedIntegrationOrder => {
  const order = asRecord(value);
  const externalOrderId = cleanString(order.id);
  if (!externalOrderId) throw new Error('Pedido Open Delivery sem identificador.');

  const displayId = firstNonEmpty(order.displayId, order.externalCode, externalOrderId);
  const rawItems = Array.isArray(order.items) ? order.items : [];
  if (rawItems.length === 0) {
    throw new Error(`Pedido ${displayId} não possui itens válidos.`);
  }

  const internalId = `99food-${externalOrderId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const items = rawItems.map((rawItem, index) => {
    const item = asRecord(rawItem);
    const quantity = positiveInteger(item.quantity);
    const name = firstNonEmpty(item.name, item.description);
    if (!quantity || !name) {
      throw new Error(`Item ${index + 1} do pedido ${displayId} é inválido.`);
    }

    const unitPrice = firstPrice(
      item.unitPrice,
      item.price,
      item.unitValue,
      asRecord(item.totalPrice).value !== undefined
        ? (priceValue(item.totalPrice) ?? 0) / quantity
        : undefined,
      asRecord(item.subtotalPrice).value !== undefined
        ? (priceValue(item.subtotalPrice) ?? 0) / quantity
        : undefined
    );
    if (unitPrice === null || unitPrice < 0) {
      throw new Error(`Preço do item “${name}” é inválido.`);
    }

    const notes = [
      cleanString(item.specialInstructions),
      cleanString(item.observations),
      itemOptionSummary(item.options),
    ].filter(Boolean).join(' · ');

    return {
      lineId: `${internalId}-line-${index + 1}`,
      productId: firstNonEmpty(item.externalCode, item.id, `${externalOrderId}-${index + 1}`),
      name,
      price: unitPrice,
      quantity,
      paidQuantity: 0,
      transferredQuantity: 0,
      note: notes,
      image: cleanString(item.imageURL),
      isService: false,
    } satisfies NormalizedIntegrationOrderItem;
  });

  const subtotalByItems = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );
  const total = firstPrice(
    asRecord(order.total).orderAmount,
    order.orderAmount,
    order.totalPrice
  ) ?? subtotalByItems;
  const subtotal = firstPrice(
    asRecord(order.total).itemsPrice,
    order.itemsPrice
  ) ?? subtotalByItems;

  const orderType = cleanString(order.type);
  const delivery = asRecord(order.delivery);
  const indoor = asRecord(order.indoor);
  const customer = asRecord(order.customer);
  const payments = asRecord(order.payments);
  const prepaid = finiteNumber(payments.prepaid) ?? 0;
  const pending = finiteNumber(payments.pending) ?? Math.max(0, total - prepaid);
  const lastEvent = cleanString(order.lastEvent) || 'CREATED';
  const createdAt = cleanString(order.createdAt) || context.receivedAt || new Date().toISOString();
  const customerName = firstNonEmpty(
    customer.name,
    [cleanString(customer.firstName), cleanString(customer.lastName)]
      .filter(Boolean)
      .join(' '),
    'Cliente 99Food'
  );

  return {
    id: internalId,
    storeId: context.tenantId,
    buyerId: `99food:${firstNonEmpty(customer.id, externalOrderId)}`,
    buyerName: customerName,
    buyerEmail: cleanString(customer.email),
    fulfillmentType:
      orderType === 'DELIVERY'
        ? 'delivery'
        : orderType === 'INDOOR'
          ? 'dine_in'
          : 'pickup',
    deliveryAddress: formatAddress(delivery.deliveryAddress),
    tableCode: firstNonEmpty(indoor.table, indoor.place, indoor.tab),
    customerNote: firstNonEmpty(
      order.customerNote,
      order.specialInstructions,
      asRecord(order.takeout).pickupArea
    ),
    items,
    subtotal,
    total,
    status: mapOrderStatus(lastEvent),
    paymentStatus:
      pending <= 0
        ? 'paid'
        : prepaid > 0
          ? 'partial'
          : 'unpaid',
    source: 'transfer',
    sourceChannel: '99food',
    operatorId: 'integration:99food',
    operatorName: '99Food · Open Delivery',
    createdAt,
    updatedAt: context.receivedAt || new Date().toISOString(),
    integration: {
      provider: '99food',
      protocol: 'open-delivery',
      protocolVersion: OPEN_DELIVERY_VERSION,
      externalOrderId,
      displayId,
      sourceAppId: firstNonEmpty(order.sourceAppId, context.sourceAppId),
      routingTarget: context.routingTarget.trim(),
      lastEvent,
    },
  };
};

export const normalizeIntegrationBaseUrl = (
  value: string,
  allowInsecure = false
): string => {
  const parsed = new URL(value.trim());
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(allowInsecure && local)) {
    throw new Error('A URL da 99Food precisa usar HTTPS.');
  }
  parsed.hash = '';
  parsed.search = '';
  return parsed.toString().replace(/\/$/, '');
};

export const resolveOrderDetailsUrl = (
  baseUrl: string,
  orderId: string,
  eventOrderUrl: string
): string => {
  const base = new URL(baseUrl);
  if (eventOrderUrl) {
    const candidate = new URL(eventOrderUrl);
    if (candidate.protocol === 'https:' && candidate.origin === base.origin) {
      return candidate.toString();
    }
  }
  return new URL(`/v1/orders/${encodeURIComponent(orderId)}`, `${base.origin}/`).toString();
};

export const buildOpenDeliveryAction = (
  externalOrderId: string,
  nextStatus: NormalizedIntegrationOrder['status'],
  options: { displayId: string; createdAt: string; reason?: string }
): OpenDeliveryActionRequest => {
  const encodedId = encodeURIComponent(externalOrderId);
  const now = new Date().toISOString();

  switch (nextStatus) {
    case 'accepted':
      return {
        path: `/v1/orders/${encodedId}/confirm`,
        body: {
          reason: options.reason || 'Pedido aceito no Kyrub.',
          createdAt: options.createdAt || now,
          orderExternalCode: options.displayId || externalOrderId,
        },
      };
    case 'preparing':
      return { path: `/v1/orders/${encodedId}/preparing` };
    case 'ready':
      return { path: `/v1/orders/${encodedId}/readyForPickup` };
    case 'out_for_delivery':
      return { path: `/v1/orders/${encodedId}/dispatch` };
    case 'completed':
      return { path: `/v1/orders/${encodedId}/delivered` };
    case 'rejected':
    case 'cancelled':
      return {
        path: `/v1/orders/${encodedId}/requestCancellation`,
        body: {
          reason: options.reason || 'Pedido cancelado manualmente no Kyrub.',
          code: 'INTERNAL_DIFFICULTIES_OF_THE_RESTAURANT',
          mode: 'MANUAL',
        },
      };
    default:
      throw new Error('Esta mudança de status não possui ação Open Delivery.');
  }
};

const tokenCache = new Map<string, OpenDeliveryToken>();

const fetchWithTimeout = async (
  input: string,
  init: RequestInit,
  timeoutMs = 12_000
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const responseError = async (response: Response): Promise<Error> => {
  const text = (await response.text()).slice(0, 1_000);
  return new Error(
    `Open Delivery respondeu ${response.status}${text ? `: ${text}` : ''}`
  );
};

export class OpenDeliveryClient {
  constructor(private readonly connection: OpenDeliveryConnectionRuntime) {}

  private async accessToken(forceRefresh = false): Promise<string> {
    const cacheKey = this.connection.connectionId;
    const cached = tokenCache.get(cacheKey);
    if (!forceRefresh && cached && cached.expiresAt > Date.now() + 30_000) {
      return cached.accessToken;
    }

    const body = new URLSearchParams({
      client_id: this.connection.credentials.clientId,
      client_secret: this.connection.credentials.clientSecret,
      grant_type: 'client_credentials',
      scope: 'od.all',
    });
    const response = await fetchWithTimeout(this.connection.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) throw await responseError(response);

    const payload = asRecord(await response.json());
    const accessToken = cleanString(payload.access_token);
    const expiresIn = finiteNumber(payload.expires_in) ?? 300;
    if (!accessToken) throw new Error('A 99Food não retornou access_token.');

    tokenCache.set(cacheKey, {
      accessToken,
      expiresAt: Date.now() + Math.max(30, expiresIn) * 1_000,
    });
    return accessToken;
  }

  private async request(
    input: string,
    init: RequestInit = {},
    retry = true
  ): Promise<Response> {
    const token = await this.accessToken();
    const response = await fetchWithTimeout(input, {
      ...init,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    });

    if (response.status === 401 && retry) {
      tokenCache.delete(this.connection.connectionId);
      await this.accessToken(true);
      return this.request(input, init, false);
    }
    return response;
  }

  async verify(): Promise<Record<string, unknown>> {
    await this.accessToken(true);
    const url = new URL('/v1/versions/orderingApp', `${this.connection.baseUrl}/`).toString();
    const response = await this.request(url);
    if (response.status === 404) return { authenticated: true };
    if (!response.ok) throw await responseError(response);
    return asRecord(await response.json());
  }

  async registerWebhook(webhookUrl: string): Promise<void> {
    const url = new URL('/v1/merchantOnboarding', `${this.connection.baseUrl}/`);
    url.searchParams.set('merchantId', this.connection.externalStoreId);
    const response = await this.request(url.toString(), {
      method: 'PUT',
      body: JSON.stringify({
        ordersWebhookURL: webhookUrl,
        orderingAppMerchantId: this.connection.externalStoreId,
      }),
    });
    if (!response.ok && response.status !== 204) throw await responseError(response);
  }

  async pollEvents(): Promise<OpenDeliveryEvent[]> {
    const url = new URL('/v1/events:polling', `${this.connection.baseUrl}/`).toString();
    const response = await this.request(url);
    if (response.status === 204) return [];
    if (!response.ok) throw await responseError(response);
    return parseOpenDeliveryEvents(await response.json());
  }

  async acknowledgeEvents(events: OpenDeliveryEvent[]): Promise<void> {
    if (events.length === 0) return;
    const url = new URL('/v1/events/acknowledgment', `${this.connection.baseUrl}/`).toString();
    const response = await this.request(url, {
      method: 'POST',
      body: JSON.stringify(
        events.slice(0, 100).map(event => ({
          id: event.eventId,
          orderId: event.orderId,
          eventType: event.eventType,
        }))
      ),
    });
    if (!response.ok && response.status !== 202) throw await responseError(response);
  }

  async getOrder(event: OpenDeliveryEvent): Promise<unknown> {
    const url = resolveOrderDetailsUrl(
      this.connection.baseUrl,
      event.orderId,
      event.orderURL
    );
    const response = await this.request(url);
    if (!response.ok) throw await responseError(response);
    return response.json();
  }

  async sendAction(action: OpenDeliveryActionRequest): Promise<void> {
    const url = new URL(action.path, `${this.connection.baseUrl}/`).toString();
    const response = await this.request(url, {
      method: 'POST',
      ...(action.body ? { body: JSON.stringify(action.body) } : {}),
    });
    if (!response.ok && ![200, 202, 204].includes(response.status)) {
      throw await responseError(response);
    }
  }
}
