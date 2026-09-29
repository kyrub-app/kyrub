export const STORE_SALES_ANALYTICS_SCHEMA_VERSION = 1 as const;

export type StoreSalesAnalyticsPeriod = '24h' | '7d' | '30d' | '90d' | 'all';

export type StoreSalesOrderStatus =
  | 'pending'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'completed'
  | 'rejected'
  | 'cancelled';

export type StoreSalesFulfillment = 'delivery' | 'pickup' | 'dine_in' | 'unknown';

export type StoreSalesChannel =
  | 'kyrub'
  | 'mercado_livre'
  | '99food'
  | 'shopee'
  | 'ifood'
  | 'instagram'
  | 'erp'
  | 'other'
  | 'unknown';

export type StoreSalesPaymentStatus = 'unpaid' | 'partial' | 'paid' | 'unknown';

export interface StoreSalesAnalyticsOrderItem {
  productId: string;
  name: string;
  unitPriceMinor: number;
  quantity: number;
  transferredQuantity: number;
  voidedQuantity: number;
  discountMinor: number;
}

export interface StoreSalesAnalyticsOrder {
  orderId: string;
  buyerId: string;
  buyerName: string;
  status: StoreSalesOrderStatus;
  paymentStatus: StoreSalesPaymentStatus;
  fulfillmentType: StoreSalesFulfillment;
  sourceChannel: StoreSalesChannel;
  operatorId: string;
  operatorName: string;
  totalMinor: number;
  occurredAt: string;
  authority: 'canonical' | 'operational';
  items: StoreSalesAnalyticsOrderItem[];
}

export interface StoreSalesAnalyticsSummary {
  totalOrders: number;
  openOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  rejectedOrders: number;
  completedSalesMinor: number;
  averageTicketMinor: number;
  unitsSold: number;
  terminalCompletionRateBps: number | null;
  cancellationRateBps: number | null;
}

export interface StoreSalesStatusBucket {
  status: StoreSalesOrderStatus;
  count: number;
  valueMinor: number;
}

export interface StoreSalesProductBucket {
  productId: string;
  name: string;
  units: number;
  orderCount: number;
  grossMinor: number;
}

export interface StoreSalesDimensionBucket {
  key: string;
  count: number;
  salesMinor: number;
}

export interface StoreSalesTrendBucket {
  date: string;
  completedOrders: number;
  salesMinor: number;
}

export interface StoreSalesRecentOrder {
  orderId: string;
  buyerName: string;
  status: StoreSalesOrderStatus;
  paymentStatus: StoreSalesPaymentStatus;
  fulfillmentType: StoreSalesFulfillment;
  sourceChannel: StoreSalesChannel;
  totalMinor: number;
  occurredAt: string;
}

export interface StoreSalesPeriodComparison {
  previousCompletedOrders: number;
  previousCompletedSalesMinor: number;
  completedOrdersDeltaBps: number | null;
  completedSalesDeltaBps: number | null;
}

export interface StoreSalesAnalyticsPayload {
  schemaVersion: typeof STORE_SALES_ANALYTICS_SCHEMA_VERSION;
  storeId: string;
  generatedAt: string;
  period: StoreSalesAnalyticsPeriod;
  range: {
    from: string;
    to: string;
  } | null;
  summary: StoreSalesAnalyticsSummary;
  comparison: StoreSalesPeriodComparison | null;
  statusFlow: StoreSalesStatusBucket[];
  products: StoreSalesProductBucket[];
  channels: StoreSalesDimensionBucket[];
  fulfillment: StoreSalesDimensionBucket[];
  operators: StoreSalesDimensionBucket[];
  trend: StoreSalesTrendBucket[];
  recentOrders: StoreSalesRecentOrder[];
}

const PERIOD_MS: Record<Exclude<StoreSalesAnalyticsPeriod, 'all'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

const OPEN_STATUSES = new Set<StoreSalesOrderStatus>([
  'pending',
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
]);

const STATUS_ORDER: readonly StoreSalesOrderStatus[] = [
  'pending',
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'rejected',
  'cancelled',
];

const safeDateMs = (value: string): number => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const bpsDelta = (current: number, previous: number): number | null => {
  if (previous <= 0) return current > 0 ? null : 0;
  return Math.round(((current - previous) / previous) * 10_000);
};

const effectiveUnits = (item: StoreSalesAnalyticsOrderItem): number =>
  Math.max(0, item.quantity - item.transferredQuantity - item.voidedQuantity);

const completedOrders = (orders: StoreSalesAnalyticsOrder[]): StoreSalesAnalyticsOrder[] =>
  orders.filter(order => order.status === 'completed');

const summarizeOrders = (orders: StoreSalesAnalyticsOrder[]): StoreSalesAnalyticsSummary => {
  const completed = completedOrders(orders);
  const completedSalesMinor = completed.reduce((sum, order) => sum + order.totalMinor, 0);
  const terminalCount = orders.filter(order =>
    order.status === 'completed' || order.status === 'rejected' || order.status === 'cancelled'
  ).length;
  const cancelledOrders = orders.filter(order => order.status === 'cancelled').length;

  return {
    totalOrders: orders.length,
    openOrders: orders.filter(order => OPEN_STATUSES.has(order.status)).length,
    completedOrders: completed.length,
    cancelledOrders,
    rejectedOrders: orders.filter(order => order.status === 'rejected').length,
    completedSalesMinor,
    averageTicketMinor: completed.length ? Math.round(completedSalesMinor / completed.length) : 0,
    unitsSold: completed.reduce(
      (sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + effectiveUnits(item), 0),
      0
    ),
    terminalCompletionRateBps: terminalCount
      ? Math.round((completed.length / terminalCount) * 10_000)
      : null,
    cancellationRateBps: orders.length
      ? Math.round((cancelledOrders / orders.length) * 10_000)
      : null,
  };
};

const dimensionBuckets = (
  orders: StoreSalesAnalyticsOrder[],
  keyFor: (order: StoreSalesAnalyticsOrder) => string
): StoreSalesDimensionBucket[] => {
  const buckets = new Map<string, { count: number; salesMinor: number }>();
  for (const order of completedOrders(orders)) {
    const key = keyFor(order) || 'unknown';
    const current = buckets.get(key) ?? { count: 0, salesMinor: 0 };
    current.count += 1;
    current.salesMinor += order.totalMinor;
    buckets.set(key, current);
  }
  return Array.from(buckets.entries())
    .map(([key, value]) => ({ key, ...value }))
    .sort((left, right) =>
      right.salesMinor - left.salesMinor || right.count - left.count || left.key.localeCompare(right.key)
    );
};

const productBuckets = (orders: StoreSalesAnalyticsOrder[]): StoreSalesProductBucket[] => {
  const buckets = new Map<string, {
    productId: string;
    name: string;
    units: number;
    orderIds: Set<string>;
    grossMinor: number;
  }>();

  for (const order of completedOrders(orders)) {
    for (const item of order.items) {
      const units = effectiveUnits(item);
      if (units <= 0) continue;
      const key = item.productId || item.name;
      if (!key) continue;
      const current = buckets.get(key) ?? {
        productId: item.productId,
        name: item.name || 'Item sem nome',
        units: 0,
        orderIds: new Set<string>(),
        grossMinor: 0,
      };
      current.units += units;
      current.orderIds.add(order.orderId);
      current.grossMinor += Math.max(0, item.unitPriceMinor * units - item.discountMinor);
      buckets.set(key, current);
    }
  }

  return Array.from(buckets.values())
    .map(bucket => ({
      productId: bucket.productId,
      name: bucket.name,
      units: bucket.units,
      orderCount: bucket.orderIds.size,
      grossMinor: bucket.grossMinor,
    }))
    .sort((left, right) =>
      right.units - left.units || right.grossMinor - left.grossMinor || left.name.localeCompare(right.name)
    )
    .slice(0, 12);
};

const trendBuckets = (orders: StoreSalesAnalyticsOrder[]): StoreSalesTrendBucket[] => {
  const buckets = new Map<string, { completedOrders: number; salesMinor: number }>();
  for (const order of completedOrders(orders)) {
    const date = order.occurredAt.slice(0, 10);
    if (!date) continue;
    const current = buckets.get(date) ?? { completedOrders: 0, salesMinor: 0 };
    current.completedOrders += 1;
    current.salesMinor += order.totalMinor;
    buckets.set(date, current);
  }
  return Array.from(buckets.entries())
    .map(([date, value]) => ({ date, ...value }))
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-30);
};

export const normalizeStoreSalesAnalyticsPeriod = (
  value: unknown
): StoreSalesAnalyticsPeriod =>
  value === '24h' || value === '7d' || value === '30d' || value === '90d' || value === 'all'
    ? value
    : '30d';

export const buildStoreSalesAnalytics = (input: {
  storeId: string;
  orders: StoreSalesAnalyticsOrder[];
  period: StoreSalesAnalyticsPeriod;
  now?: Date;
}): StoreSalesAnalyticsPayload => {
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('STORE_SALES_ANALYTICS_NOW_INVALID');
  const nowMs = now.getTime();
  const periodMs = input.period === 'all' ? null : PERIOD_MS[input.period];
  const currentFromMs = periodMs === null ? null : nowMs - periodMs;
  const previousFromMs = periodMs === null ? null : nowMs - periodMs * 2;

  const currentOrders = input.orders
    .filter(order => {
      const occurredAtMs = safeDateMs(order.occurredAt);
      return occurredAtMs > 0 && (currentFromMs === null || occurredAtMs >= currentFromMs) && occurredAtMs <= nowMs;
    })
    .sort((left, right) => safeDateMs(right.occurredAt) - safeDateMs(left.occurredAt));

  const previousOrders = periodMs === null || previousFromMs === null || currentFromMs === null
    ? []
    : input.orders.filter(order => {
        const occurredAtMs = safeDateMs(order.occurredAt);
        return occurredAtMs >= previousFromMs && occurredAtMs < currentFromMs;
      });

  const summary = summarizeOrders(currentOrders);
  const previousSummary = periodMs === null ? null : summarizeOrders(previousOrders);

  const statusFlow = STATUS_ORDER.map(status => {
    const orders = currentOrders.filter(order => order.status === status);
    return {
      status,
      count: orders.length,
      valueMinor: orders.reduce((sum, order) => sum + order.totalMinor, 0),
    };
  });

  return {
    schemaVersion: STORE_SALES_ANALYTICS_SCHEMA_VERSION,
    storeId: input.storeId,
    generatedAt: now.toISOString(),
    period: input.period,
    range: currentFromMs === null
      ? null
      : { from: new Date(currentFromMs).toISOString(), to: now.toISOString() },
    summary,
    comparison: previousSummary
      ? {
          previousCompletedOrders: previousSummary.completedOrders,
          previousCompletedSalesMinor: previousSummary.completedSalesMinor,
          completedOrdersDeltaBps: bpsDelta(summary.completedOrders, previousSummary.completedOrders),
          completedSalesDeltaBps: bpsDelta(summary.completedSalesMinor, previousSummary.completedSalesMinor),
        }
      : null,
    statusFlow,
    products: productBuckets(currentOrders),
    channels: dimensionBuckets(currentOrders, order => order.sourceChannel),
    fulfillment: dimensionBuckets(currentOrders, order => order.fulfillmentType),
    operators: dimensionBuckets(currentOrders, order => order.operatorId || order.operatorName || 'unknown'),
    trend: trendBuckets(currentOrders),
    recentOrders: currentOrders.slice(0, 12).map(order => ({
      orderId: order.orderId,
      buyerName: order.buyerName,
      status: order.status,
      paymentStatus: order.paymentStatus,
      fulfillmentType: order.fulfillmentType,
      sourceChannel: order.sourceChannel,
      totalMinor: order.totalMinor,
      occurredAt: order.occurredAt,
    })),
  };
};
