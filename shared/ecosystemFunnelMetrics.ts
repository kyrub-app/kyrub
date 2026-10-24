/**
 * Pure aggregation rules for the Kyrub administrative ecosystem funnel.
 * Callers must authorize access before reading or returning underlying records.
 * This module does not query Firestore or expose global data to store CRM routes.
 */
export interface EcosystemPaidEntitlement {
  ownerId?: unknown;
  storeId?: unknown;
  plan?: unknown;
  source?: unknown;
  status?: unknown;
}

export const countActivePaidOwners = (
  entitlements: readonly EcosystemPaidEntitlement[]
): number => {
  const owners = new Set<string>();
  for (const entitlement of entitlements) {
    const ownerId = typeof entitlement.ownerId === 'string'
      ? entitlement.ownerId.trim()
      : '';
    if (
      ownerId &&
      entitlement.source === 'subscription' &&
      entitlement.status === 'active' &&
      (entitlement.plan === 'pro' || entitlement.plan === 'business')
    ) {
      owners.add(ownerId);
    }
  }
  return owners.size;
};

export const calculatePaidStoreConversion = (
  paidOwners: number | null,
  canonicalStores: number | null
): number | null => {
  if (
    paidOwners === null ||
    canonicalStores === null ||
    !Number.isSafeInteger(paidOwners) ||
    !Number.isSafeInteger(canonicalStores) ||
    paidOwners < 0 ||
    canonicalStores <= 0 ||
    paidOwners > canonicalStores
  ) return null;
  return (paidOwners / canonicalStores) * 100;
};
