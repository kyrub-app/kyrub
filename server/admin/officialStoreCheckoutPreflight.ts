import type { KyrubCommercialPlanId } from '../../shared/kyrubCommercialPlans.js';
import { resolveCanonicalStoreIdentity } from '../identity/canonicalStoreIdentityService.js';
import { getOfficialStoreIdentity } from './officialStoreService.js';
import { resolveCheckoutBillingRoute, type CheckoutBillingRoute } from './officialPlanCheckoutRouting.js';

/**
 * Server-only classification. Neither the client-provided official store ID nor
 * a product title is trusted as evidence that the platform should be paid.
 *
 * This is a preflight boundary, not an executable payment endpoint. The
 * eventual checkout integration must resolve the product's plan tag from
 * persisted catalog data, rather than trusting a caller-provided plan ID.
 */
export const resolveOfficialStoreCheckoutRoute = async (input: {
  sellerStoreReference: string;
  persistedPlatformPlanId?: KyrubCommercialPlanId | null;
}): Promise<CheckoutBillingRoute> => {
  const [seller, official] = await Promise.all([
    resolveCanonicalStoreIdentity(input.sellerStoreReference, { requirePublishedTenant: true }),
    getOfficialStoreIdentity(),
  ]);

  return resolveCheckoutBillingRoute({
    sellerStoreId: seller.canonicalStoreId,
    officialStoreId: official?.canonicalStoreId ?? null,
    platformPlanId: input.persistedPlatformPlanId,
  });
};
