import type { LocalAttendanceSession } from '../../shared/localAttendance';
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
  /** Operational key used by the existing table workspace. */
  tableCode: string;
  /** User-facing identification, e.g. "3" or "Mesa 3". */
  displayLabel: string;
  /** Configured service area, e.g. "Calçada". */
  areaLabel: string;
  attendanceId: string;
  peopleCount: number;
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

const attendanceKey = (value: string): string =>
  value.trim().toLocaleLowerCase('pt-BR');

type CustomerOrderWithServiceLocation = CustomerOrder & {
  serviceLocation?: unknown;
};

type CardGroup = {
  serviceLocation: ResolvedOrderServiceLocation;
  orders: CustomerOrder[];
  requests: LocalServiceRequest[];
  session: LocalAttendanceSession | null;
  tableCode: string;
  displayLabel: string;
  areaLabel: string;
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

const resolveAttendanceLocation = (
  session: LocalAttendanceSession
): ResolvedOrderServiceLocation => {
  if (session.serviceLocation) {
    return {
      ...session.serviceLocation,
      source: 'canonical',
    };
  }
  return {
    schemaVersion: 1,
    id: '',
    kind: 'table',
    label: session.customerLabel,
    source: 'legacy_table_code',
  };
};

export const buildCustomerTableCards = (
  orders: CustomerOrder[],
  requests: LocalServiceRequest[] = [],
  attendanceSessions: LocalAttendanceSession[] = []
): CustomerTableCard[] => {
  const grouped = new Map<string, CardGroup>();
  const openSessions = attendanceSessions.filter(session => session.status === 'open');
  const sessionGroupsByTableKey = new Map<string, string[]>();

  for (const session of openSessions) {
    const groupKey = `attendance:${session.id}`;
    const serviceLocation = resolveAttendanceLocation(session);
    grouped.set(groupKey, {
      serviceLocation,
      orders: [],
      requests: [],
      session,
      tableCode: session.customerLabel,
      displayLabel: session.customerLabel,
      areaLabel: session.serviceLocation?.label ?? session.space,
    });
    const tableKey = attendanceKey(session.customerLabel);
    const keys = sessionGroupsByTableKey.get(tableKey) ?? [];
    keys.push(groupKey);
    sessionGroupsByTableKey.set(tableKey, keys);
  }

  orders.filter(isActiveDineInOrder).forEach(order => {
    const tableMatches = order.tableCode
      ? sessionGroupsByTableKey.get(attendanceKey(order.tableCode)) ?? []
      : [];
    if (tableMatches.length === 1) {
      grouped.get(tableMatches[0])?.orders.push(order);
      return;
    }

    const serviceLocation = resolveCustomerOrderServiceLocation(order);
    if (!serviceLocation) return;
    const key = `location:${serviceLocationIdentityKey(serviceLocation)}`;
    const current = grouped.get(key) ?? {
      serviceLocation,
      orders: [],
      requests: [],
      session: null,
      tableCode: serviceLocation.label,
      displayLabel: serviceLocation.label,
      areaLabel: serviceLocation.label,
    };
    current.orders.push(order);
    grouped.set(key, current);
  });

  requests.forEach(request => {
    if (request.status !== 'open' && request.status !== 'acknowledged') return;
    const groupForOrder = Array.from(grouped.values()).find(group =>
      group.orders.some(order => order.id === request.orderId)
    );
    if (groupForOrder) {
      groupForOrder.requests.push(request);
      return;
    }
    const key = `location:${serviceLocationIdentityKey(request.serviceLocation)}`;
    const current = grouped.get(key);
    if (!current) return;
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
      const sessionOpenedAt = group.session?.openedAt ?? '';
      const orderOpenedAt = sortedOrders.reduce(
        (oldest, order) =>
          !oldest || order.createdAt < oldest ? order.createdAt : oldest,
        ''
      );
      const openedAt =
        sessionOpenedAt && orderOpenedAt
          ? (sessionOpenedAt < orderOpenedAt ? sessionOpenedAt : orderOpenedAt)
          : sessionOpenedAt || orderOpenedAt;
      const updatedAt = [
        group.session?.updatedAt ?? '',
        ...sortedOrders.map(order => order.updatedAt),
        ...sortedRequests.map(request => request.updatedAt),
      ].filter(Boolean).sort().at(-1) ?? openedAt;

      return {
        tableCode: group.tableCode,
        displayLabel: group.displayLabel,
        areaLabel: group.areaLabel,
        attendanceId: group.session?.id ?? '',
        peopleCount: group.session?.itemCount ?? 0,
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
        primaryBuyerName:
          buyerNames[0] ??
          (group.session
            ? `${group.session.itemCount} pessoa${group.session.itemCount === 1 ? '' : 's'}`
            : 'Cliente'),
        openedAt,
        updatedAt,
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
      return locationCollator.compare(left.displayLabel, right.displayLabel);
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