import {
  resolveOrderServiceLocation,
  serviceLocationIdentityKey,
  type ResolvedOrderServiceLocation,
} from '../../shared/serviceLocation';
import {
  getCustomerOrderItemOpenQuantity,
  getCustomerOrderOutstandingTotal,
  type CustomerOrder,
} from './customerOrders';

const TERMINAL_STATUSES = new Set<CustomerOrder['status']>([
  'completed',
  'rejected',
  'cancelled',
]);

export const isOrderAtServiceLocation = (
  order: CustomerOrder,
  location: ResolvedOrderServiceLocation
): boolean => {
  if (order.fulfillmentType !== 'dine_in') return false;
  const resolved = resolveOrderServiceLocation({
    serviceLocation: order.serviceLocation,
    tableCode: order.tableCode,
  });
  return Boolean(
    resolved &&
    serviceLocationIdentityKey(resolved) === serviceLocationIdentityKey(location)
  );
};

export const getActiveServiceLocationOrders = (
  orders: CustomerOrder[],
  location: ResolvedOrderServiceLocation
): CustomerOrder[] =>
  orders
    .filter(order =>
      isOrderAtServiceLocation(order, location) &&
      !TERMINAL_STATUSES.has(order.status) &&
      order.items.some(item => getCustomerOrderItemOpenQuantity(item) > 0)
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

export const getServiceLocationOutstandingTotal = (
  orders: CustomerOrder[],
  location: ResolvedOrderServiceLocation
): number =>
  getActiveServiceLocationOrders(orders, location).reduce(
    (sum, order) => sum + getCustomerOrderOutstandingTotal(order),
    0
  );

export const getServiceLocationOpenItemCount = (
  orders: CustomerOrder[],
  location: ResolvedOrderServiceLocation
): number =>
  getActiveServiceLocationOrders(orders, location).reduce(
    (sum, order) =>
      sum + order.items.reduce(
        (itemSum, item) => itemSum + getCustomerOrderItemOpenQuantity(item),
        0
      ),
    0
  );
