/** Owner-approved launch scope, 2026-11-25. A future release must explicitly
 * change this contract before new on-demand assignments or split are enabled. */
export const COMMERCIAL_V1_SCOPE={
 merchantDirectPix:true,
 platformSubscriptionBilling:true,
 directFreelanceHiring:true,
 ownDelivery:true,
 onDemandDelivery:false,
 marketplaceSplit:false,
 automaticCourierPayout:false,
} as const;
export function assertNewOnDemandDeliveryAllowed():void{
 if(!COMMERCIAL_V1_SCOPE.onDemandDelivery)throw Error('DELIVERY_V1_STANDBY');
}
