/**
 * Fallback identity for pre-binding Mercado Pago payments when the optional
 * top-level stores/{uid} migration document has not been materialized.
 *
 * The canonical owner's store is already owner-verified by the route, but
 * the primary store record is re-read here to bind the fallback to a real
 * persisted store. Never infer a different historical tenant or account.
 */
export const legacyMercadoPagoStoreIdFromPrimaryOwner = (
  canonicalStoreIdInput: string,
  primaryStoreInput: Record<string, unknown> | null
): string => {
  const canonicalStoreId = canonicalStoreIdInput.trim();
  const clean = (value: unknown): string =>
    typeof value === 'string' ? value.trim() : '';
  if (
    !canonicalStoreId
    || !primaryStoreInput
    || clean(primaryStoreInput.id) !== canonicalStoreId
    || clean(primaryStoreInput.ownerId) !== canonicalStoreId
  ) {
    throw new Error('STORE_PROVIDER_RECONCILIATION_STORE_SCOPE_INVALID');
  }
  const explicitLegacy = clean(primaryStoreInput.legacyTenantId);
  // An explicitly different legacy tenant needs the authoritative
  // stores/{canonicalStoreId} mapping; do not silently substitute uid.
  if (explicitLegacy && explicitLegacy !== canonicalStoreId) {
    throw new Error('STORE_PROVIDER_RECONCILIATION_STORE_SCOPE_INVALID');
  }
  return canonicalStoreId;
};
