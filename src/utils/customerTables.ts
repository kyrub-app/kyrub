import type { LocalServiceRequest } from '../../shared/localServiceRequest';
import type { ResolvedOrderServiceLocation } from '../../shared/serviceLocation';
import {
  resolveOrderServiceLocation,
  serviceLocationIdentityKey,
} from '../../shared/serviceLocation';
import type { CustomerOrder } from './customerOrders';
import {
  getCustomerOrderItemOpenQuantity,
  getCustomerOrderOutstandingTotal,
} from './customerOrders';

export type CustomerTableOperationalState =
  | 'pending'
  | 'ready'
  | 'preparing'
  | 'accepted';

export interface CustomerTableCard {
  /** Legacy compatibility name. This is the Service Location label. */
  tableCode: string;
  serviceLocation: ResolvedOrderServiceLocation;
  orders: CustomerOrder[];
  requests: LocalServiceRequest[];
  orderCount: number;
  pendingCount: number;
  assistanceRequestCount: number;
  closeAccountRequestCount: number;
  unacknowledgedRequestCount: number;
  itemCount: number;
  total: number;
  buyerNames: string[];
  primaryBuyerName: string;
  openedAt: string;
  updatedAt: string;
  state: CustomerTableOperationalState;
}

const TERMINAL_STATUSES = new Set([
  'completed',
  'rejected',
  'cancelled',
]);

const STATE_PRIORITY: Record<CustomerTableOperationalState, number> = {
  pending: 0,
  ready: 1,
  preparing: 2,
  accepted: 3,
};

const locationCollator = new Intl.Collator('pt-BR', {
  numeric: true,
  sensitivity: 'base',
});

type CustomerOrderWithServiceLocation = CustomerOrder & {
  serviceLocation?: unknown;
};

export const resolveCustomerOrderServiceLocation = (
  order: CustomerOrder
): ResolvedOrderServiceLocation | null => {
  const serviceLocation = (order as CustomerOrderWithServiceLocation).serviceLocation;
  return resolveOrderServiceLocation({
    serviceLocation,
    tableCode: order.tableCode,
  });
};

const isActiveDineInOrder = (order: CustomerOrder): boolean =>
  order.fulfillmentType === 'dine_in' &&
  Boolean(resolveCustomerOrderServiceLocation(order)) &&
  !TERMINAL_STATUSES.has(order.status) &&
  order.items.some(item => getCustomerOrderItemOpenQuantity(item) > 0);

const awaitsAttendanceApproval = (order: CustomerOrder): boolean =>
  order.source === 'customer' &&
  order.status === 'pending' &&
  !order.operatorId.trim();

const resolveTableState = (
  orders: CustomerOrder[]
): CustomerTableOperationalState => {
  if (orders.some(awaitsAttendanceApproval)) return 'pending';
  if (orders.some(order => order.status === 'ready')) return 'ready';
  if (orders.some(order => order.status === 'preparing')) return 'preparing';
  return 'accepted';
};

export const buildCustomerTableCards = (
  orders: CustomerOrder[],
  requests: LocalServiceRequest[] = []
): CustomerTableCard[] => {
  const grouped = new Map<
    string,
    {
      serviceLocation: ResolvedOrderServiceLocation;
      orders: CustomerOrder[];
      requests: LocalServiceRequest[];
    }
  >();

  orders.filter(isActiveDineInOrder).forEach(order => {
    const serviceLocation = resolveCustomerOrderServiceLocation(order);
    if (!serviceLocation) return;
    const key = serviceLocationIdentityKey(serviceLocation);
    const current = grouped.get(key) ?? { serviceLocation, orders: [], requests: [] };
    current.orders.push(order);
    grouped.set(key, current);
  });

  requests.forEach(request => {
    if (request.status !== 'open' && request.status !== 'acknowledged') return;
    const key = serviceLocationIdentityKey(request.serviceLocation);
    const current = grouped.get(key);
    if (!current) return;
    if (!current.orders.some(order => order.id === request.orderId)) return;
    current.requests.push(request);
  });

  return Array.from(grouped.values())
    .map(group => {
      const sortedOrders = [...group.orders].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt)
      );
      const sortedRequests = [...group.requests].sort((left, right) =>
        left.requestedAt.localeCompare(right.requestedAt)
      );
      const buyerNames = Array.from(
        new Set(
          sortedOrders
            .map(order => order.buyerName.trim())
            .filter(Boolean)
        )
      );

      return {
        tableCode: group.serviceLocation.label,
        serviceLocation: group.serviceLocation,
        orders: sortedOrders,
        requests: sortedRequests,
        orderCount: sortedOrders.length,
        pendingCount: sortedOrders.filter(awaitsAttendanceApproval).length,
        assistanceRequestCount: sortedRequests.filter(request => request.kind === 'assistance').length,
        closeAccountRequestCount: sortedRequests.filter(request => request.kind === 'close_account').length,
        unacknowledgedRequestCount: sortedRequests.filter(request => request.status === 'open').length,
        itemCount: sortedOrders.reduce(
          (sum, order) =>
            sum +
            order.items.reduce(
              (itemSum, item) =>
                itemSum + getCustomerOrderItemOpenQuantity(item),
              0
            ),
          0
        ),
        total: sortedOrders.reduce(
          (sum, order) => sum + getCustomerOrderOutstandingTotal(order),
          0
        ),
        buyerNames,
        primaryBuyerName: buyerNames[0] ?? 'Cliente',
        openedAt: sortedOrders.reduce(
          (oldest, order) =>
            !oldest || order.createdAt < oldest ? order.createdAt : oldest,
          ''
        ),
        updatedAt: [
          ...sortedOrders.map(order => order.updatedAt),
          ...sortedRequests.map(request => request.updatedAt),
        ].sort().at(-1) ?? sortedOrders[0].updatedAt,
        state: resolveTableState(sortedOrders),
      } satisfies CustomerTableCard;
    })
    .sort((left, right) => {
      const leftAttention = left.pendingCount + left.unacknowledgedRequestCount;
      const rightAttention = right.pendingCount + right.unacknowledgedRequestCount;
      if (leftAttention !== rightAttention) return rightAttention - leftAttention;
      const stateDifference =
        STATE_PRIORITY[left.state] - STATE_PRIORITY[right.state];
      if (stateDifference !== 0) return stateDifference;
      return locationCollator.compare(left.tableCode, right.tableCode);
    });
};

export const getCustomerTableStateLabel = (
  state: CustomerTableOperationalState,
  pendingCount: number
): string => {
  switch (state) {
    case 'pending':
      return `${pendingCount} novo${pendingCount === 1 ? '' : 's'}`;
    case 'ready':
      return 'Pronto';
    case 'preparing':
      return 'Em preparo';
    default:
      return 'Em atendimento';
  }
};
