/** V1 launch policy: store-order distribution is deliberately suspended.
 * Reactivation requires a reviewed release, not a browser flag or a payment workaround.
 * Independent delivery work and existing contracted obligations are distinct.
 */
export function storeOrderDistributionEnabled(): boolean { return false; }
export function isIntegratedStoreDelivery(delivery: {id?:unknown;source?:unknown}): boolean {
 return delivery.source==='kyrub-order'||(typeof delivery.id==='string'&&delivery.id.startsWith('order-'));
}
export function mayAcceptNewDelivery(delivery: {id?:unknown;source?:unknown}): boolean {
 return !isIntegratedStoreDelivery(delivery)||storeOrderDistributionEnabled();
}
