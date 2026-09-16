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
  tableCode: string;
  serviceLocation: ResolvedOrderServiceLocation;
  orders: CustomerOrder[];
  orderCount: number;
  pendingCount: number;
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

const tableCodeCollator = new Intl.Collator('pt-BR', {
  numeric: true,
  sensitivity: 'base',
});

type CustomerOrderWithServiceLocation = CustomerOrder & {
  serviceLocation?: unknown;
};

const resolveTableLocation = (
  order: CustomerOrder
): ResolvedOrderServiceLocation | null => {
  const serviceLocation = (order as CustomerOrderWithServiceLocation).serviceLocation;
  const location = resolveOrderServiceLocation({
    serviceLocation,
    tableCode: order.tableCode,
  });
  return location?.kind === 'table' ? location : null;
};

const isActiveDineInOrder = (order: CustomerOrder): boolean =>
  order.fulfillmentType === 'dine_in' &&
  Boolean(resolveTableLocation(order)) &&
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
  orders: CustomerOrder[]
): CustomerTableCard[] => {
  const grouped = new Map<
    string,
    { serviceLocation: ResolvedOrderServiceLocation; orders: CustomerOrder[] }
  >();

  orders.filter(isActiveDineInOrder).forEach(order => {
    const serviceLocation = resolveTableLocation(order);
    if (!serviceLocation) return;
    const key = serviceLocationIdentityKey(serviceLocation);
    const current = grouped.get(key) ?? { serviceLocation, orders: [] };
    current.orders.push(order);
    grouped.set(key, current);
  });

  return Array.from(grouped.values())
    .map(group => {
      const sortedOrders = [...group.orders].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt)
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
        orderCount: sortedOrders.length,
        pendingCount: sortedOrders.filter(awaitsAttendanceApproval).length,
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
        updatedAt: sortedOrders.reduce(
          (latest, order) =>
            order.updatedAt > latest ? order.updatedAt : latest,
          sortedOrders[0].updatedAt
        ),
        state: resolveTableState(sortedOrders),
      } satisfies CustomerTableCard;
    })
    .sort((left, right) => {
      const stateDifference =
        STATE_PRIORITY[left.state] - STATE_PRIORITY[right.state];
      if (stateDifference !== 0) return stateDifference;
      return tableCodeCollator.compare(left.tableCode, right.tableCode);
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