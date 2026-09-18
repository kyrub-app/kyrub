import {
  resolveOrderServiceLocation,
  serviceLocationIdentityKey,
  type ServiceLocationSnapshot,
} from './serviceLocation.js';

export type LocalServiceFulfillmentType = 'dine_in' | 'pickup';

export type LocalServiceOrderStatus =
  | 'pending'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'completed'
  | 'rejected'
  | 'cancelled';

export interface LocalServiceOrderLike {
  id: string;
  fulfillmentType: string;
  status: string;
  tableCode: string;
  serviceLocation?: ServiceLocationSnapshot | null;
  source: string;
  operatorId: string;
}

export interface LocalServiceSummary {
  activeOrders: number;
  activeServiceLocations: number;
  activeTables: number;
  pendingApprovals: number;
  inProduction: number;
  readyForServiceLocation: number;
  readyForTable: number;
  waitingPickup: number;
}

const TERMINAL_STATUSES = new Set(['completed', 'rejected', 'cancelled']);

const resolveLocation = (order: Pick<LocalServiceOrderLike, 'serviceLocation' | 'tableCode'>) =>
  resolveOrderServiceLocation({
    serviceLocation: order.serviceLocation,
    tableCode: order.tableCode,
  });

export const isLocalServiceOrder = (
  order: Pick<LocalServiceOrderLike, 'fulfillmentType'>
): boolean =>
  order.fulfillmentType === 'dine_in' || order.fulfillmentType === 'pickup';

export const isActiveLocalServiceOrder = (
  order: Pick<LocalServiceOrderLike, 'fulfillmentType' | 'status'>
): boolean => isLocalServiceOrder(order) && !TERMINAL_STATUSES.has(order.status);

export const isLocalAttendanceApprovalPending = (
  order: Pick<
    LocalServiceOrderLike,
    'fulfillmentType' | 'status' | 'source' | 'operatorId' | 'tableCode' | 'serviceLocation'
  >
): boolean =>
  order.fulfillmentType === 'dine_in' &&
  order.status === 'pending' &&
  order.source === 'customer' &&
  Boolean(resolveLocation(order)) &&
  !order.operatorId.trim();

export const buildLocalServiceSummary = (
  orders: LocalServiceOrderLike[]
): LocalServiceSummary => {
  const active = orders.filter(isActiveLocalServiceOrder);
  const activeLocations = active
    .map(order => resolveLocation(order))
    .filter(location => location !== null);
  const activeServiceLocations = new Set(
    activeLocations.map(serviceLocationIdentityKey)
  );
  const activeTables = new Set(
    activeLocations
      .filter(location => location.kind === 'table')
      .map(serviceLocationIdentityKey)
  );
  const readyForServiceLocation = active.filter(order =>
    order.fulfillmentType === 'dine_in' &&
    order.status === 'ready' &&
    Boolean(resolveLocation(order))
  ).length;
  const readyForTable = active.filter(order =>
    order.fulfillmentType === 'dine_in' &&
    order.status === 'ready' &&
    resolveLocation(order)?.kind === 'table'
  ).length;

  return {
    activeOrders: active.length,
    activeServiceLocations: activeServiceLocations.size,
    activeTables: activeTables.size,
    pendingApprovals: active.filter(isLocalAttendanceApprovalPending).length,
    inProduction: active.filter(order =>
      order.status === 'accepted' || order.status === 'preparing'
    ).length,
    readyForServiceLocation,
    readyForTable,
    waitingPickup: active.filter(order =>
      order.fulfillmentType === 'pickup' && order.status === 'ready'
    ).length,
  };
};
