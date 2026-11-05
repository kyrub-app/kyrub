/**
 * Fail-closed bridge between a prepaid contract and an existing subscription.
 * An equal buyer/product pair alone never establishes entitlement ownership.
 * The binding must be persisted on the predecessor contract by an authorized
 * creation/migration flow before renewal can extend benefits.
 */
export interface PrepaidRenewalEntitlementBinding {
  storeId: string;
  previousContractId: string;
  subscriptionId: string;
  customerId: string;
  productId: string;
}

const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 180 && !value.includes('/');

export const assertPrepaidRenewalEntitlementBinding = (input: {
  storeId: string;
  previousContractId: string;
  customerId: string;
  productId: string;
  predecessor: Record<string, unknown>;
  subscription: Record<string, unknown> | null;
}): PrepaidRenewalEntitlementBinding => {
  const { storeId, previousContractId, customerId, productId, predecessor, subscription } = input;
  const subscriptionId = predecessor.subscriptionId;
  if (![storeId, previousContractId, customerId, productId, subscriptionId].every(validId) ||
      predecessor.storeId !== storeId ||
      predecessor.contractId !== previousContractId ||
      predecessor.customerId !== customerId ||
      predecessor.productId !== productId ||
      !subscription ||
      subscription.id !== subscriptionId ||
      subscription.storeId !== storeId ||
      subscription.buyerId !== customerId ||
      subscription.productId !== productId) {
    throw new Error('RENEWAL_ENTITLEMENT_BINDING_NOT_VERIFIED');
  }
  return { storeId, previousContractId, customerId, productId, subscriptionId: subscriptionId as string };
};
