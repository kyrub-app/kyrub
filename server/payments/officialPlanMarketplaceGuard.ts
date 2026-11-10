/** Platform-owned plan bindings must never be charged as ordinary retail items. */
export const assertNoOfficialPlanProducts = async (
  productIds: string[],
  hasOfficialMapping: (productId: string) => Promise<boolean>
): Promise<void> => {
  const uniqueIds = [...new Set(productIds)];
  if (uniqueIds.some(id => !/^[a-zA-Z0-9_-]{1,128}$/.test(id))) {
    throw new Error('CHECKOUT_PRODUCT_NOT_AVAILABLE');
  }
  // Read errors propagate: a missing mapping cannot be assumed on DB failure.
  const mapped = await Promise.all(uniqueIds.map(hasOfficialMapping));
  if (mapped.some(Boolean)) throw new Error('CHECKOUT_OFFICIAL_PLAN_REQUIRES_OFFICIAL_FLOW');
};
