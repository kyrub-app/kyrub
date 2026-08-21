export const KYRUB_DELIVERY_COMPLETION_SCHEMA_VERSION = 1 as const;

export type KyrubDeliveryCompletionStatus =
  | 'awaiting_delivery'
  | 'awaiting_buyer_confirmation'
  | 'confirmed'
  | 'disputed';

export type KyrubDeliveryCompletion = {
  schemaVersion: typeof KYRUB_DELIVERY_COMPLETION_SCHEMA_VERSION;
  deliveryId: string;
  orderId: string;
  storeId: string;
  buyerId: string;
  courierId: string;
  status: KyrubDeliveryCompletionStatus;
  settlementEligible: boolean;
  confirmedBy?: string;
  confirmedAt?: string;
  correlationId: string;
};
