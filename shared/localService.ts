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
  source: string;
  operatorId: string;
}

export interface LocalServiceSummary {
  activeOrders: number;
  activeTables: number;
  pendingApprovals: number;
  inProduction: number;
  readyForTable: number;
  waitingPickup: number;
}

const TERMINAL_STATUSES = new Set(['completed', 'rejected', 'cancelled']);

const normalize = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

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
    'fulfillmentType' | 'status' | 'source' | 'operatorId' | 'tableCode'
  >
): boolean =>
  order.fulfillmentType === 'dine_in' &&
  order.status === 'pending' &&
  order.source === 'customer' &&
  Boolean(normalize(order.tableCode)) &&
  !normalize(order.operatorId);

export const buildLocalServiceSummary = (
  orders: LocalServiceOrderLike[]
): LocalServiceSummary => {
  const active = orders.filter(isActiveLocalServiceOrder);
  const activeTables = new Set(
    active
      .filter(order => order.fulfillmentType === 'dine_in')
      .map(order => normalize(order.tableCode).toLocaleUpperCase('pt-BR'))
      .filter(Boolean)
  );

  return {
    activeOrders: active.length,
    activeTables: activeTables.size,
    pendingApprovals: active.filter(isLocalAttendanceApprovalPending).length,
    inProduction: active.filter(order =>
      order.status === 'accepted' || order.status === 'preparing'
    ).length,
    readyForTable: active.filter(order =>
      order.fulfillmentType === 'dine_in' && order.status === 'ready'
    ).length,
    waitingPickup: active.filter(order =>
      order.fulfillmentType === 'pickup' && order.status === 'ready'
    ).length,
  };
};
