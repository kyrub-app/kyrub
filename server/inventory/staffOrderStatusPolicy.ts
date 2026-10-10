import { hasStorePermission, type StoreRole } from '../../src/utils/storeSecurity.js';
import type { InventoryOrderStatus } from '../../shared/inventoryConsumption.js';

/**
 * KDS status changes are not equivalent to cash, refunds or merchant payouts.
 * Keep the existing owner flow intact; an active non-owner member must have
 * permission for the particular transition, not just general orders.read.
 */
export const canStaffUpdateOrderStatus = (
  role: StoreRole,
  status: InventoryOrderStatus
): boolean => {
  if (role === 'owner' || role === 'manager') return true;
  switch (status) {
    case 'accepted':
    case 'out_for_delivery':
      return hasStorePermission(role, 'orders.transfer');
    case 'preparing':
    case 'ready':
      return hasStorePermission(role, 'production.update');
    case 'completed':
      return hasStorePermission(role, 'orders.transfer') &&
        hasStorePermission(role, 'cash.manage');
    case 'rejected':
      return hasStorePermission(role, 'orders.cancel');
    case 'cancelled':
    default:
      // Cancellation/refund authority is audited separately; never allow it
      // solely because the user can view/operate the KDS.
      return false;
  }
};
