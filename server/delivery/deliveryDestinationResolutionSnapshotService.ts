import { parseDeliveryCustomerDestinationResolution } from '../../shared/deliveryCustomerDestinationResolution.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export type DeliveryDestinationResolutionSnapshotStatus =
  | 'not_applicable'
  | 'resolved'
  | 'review_required'
  | 'provider_not_configured'
  | 'not_found'
  | 'provider_unavailable'
  | 'missing';

const ORDER_RESOLUTION_STATUSES = new Set<DeliveryDestinationResolutionSnapshotStatus>([
  'not_applicable',
  'resolved',
  'review_required',
  'provider_not_configured',
  'not_found',
  'provider_unavailable',
]);

export interface DeliveryDestinationResolutionSnapshotFields {
  customerDestinationResolutionSnapshotStatus: DeliveryDestinationResolutionSnapshotStatus;
  customerDestinationResolutionSnapshot?: NonNullable<ReturnType<typeof parseDeliveryCustomerDestinationResolution>>;
  customerDestinationResolutionSnapshotAuthority: 'kyrub_server';
  customerDestinationResolutionSnapshotSource: 'order_delivery_destination_resolution';
  customerDestinationResolutionPaymentIntentId: string;
}

export const buildDeliveryDestinationResolutionSnapshotFields = (
  order: Record<string, unknown>
): DeliveryDestinationResolutionSnapshotFields => {
  const rawStatus = clean(order.customerDestinationResolutionStatus);
  if (!rawStatus) {
    return {
      customerDestinationResolutionSnapshotStatus: 'missing',
      customerDestinationResolutionSnapshotAuthority: 'kyrub_server',
      customerDestinationResolutionSnapshotSource: 'order_delivery_destination_resolution',
      customerDestinationResolutionPaymentIntentId: '',
    };
  }
  if (!ORDER_RESOLUTION_STATUSES.has(rawStatus as DeliveryDestinationResolutionSnapshotStatus)) {
    throw new Error('DELIVERY_DESTINATION_RESOLUTION_STATUS_INVALID');
  }

  const status = rawStatus as DeliveryDestinationResolutionSnapshotStatus;
  const resolution = order.customerDestinationResolution
    ? parseDeliveryCustomerDestinationResolution(order.customerDestinationResolution)
    : null;
  if ((status === 'resolved' || status === 'review_required') && !resolution) {
    throw new Error('DELIVERY_DESTINATION_RESOLUTION_INVALID');
  }
  if (resolution && resolution.status !== status) {
    throw new Error('DELIVERY_DESTINATION_RESOLUTION_CONFLICT');
  }

  return {
    customerDestinationResolutionSnapshotStatus: status,
    ...(resolution ? { customerDestinationResolutionSnapshot: resolution } : {}),
    customerDestinationResolutionSnapshotAuthority: 'kyrub_server',
    customerDestinationResolutionSnapshotSource: 'order_delivery_destination_resolution',
    customerDestinationResolutionPaymentIntentId: clean(
      order.customerDestinationResolutionPaymentIntentId
    ),
  };
};
