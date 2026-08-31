import type { User } from 'firebase/auth';

const encoded = (value: string): string => encodeURIComponent(value.trim());

const authorizedFetch = async <T>(user: User, input: RequestInfo | URL, init: RequestInit = {}): Promise<T> => {
  const token = await user.getIdToken();
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(input, { ...init, headers, cache: 'no-store' });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.error === 'string' && payload.error.trim()
      ? payload.error.trim()
      : `Não foi possível concluir a operação (${response.status}).`;
    const code = typeof payload.code === 'string' ? payload.code : '';
    throw new Error(code ? `${message} (${code})` : message);
  }
  return payload as T;
};

export interface MercadoLivreE2EEligibleProduct {
  id: string;
  canonicalStoreId: string;
  name: string;
  price: number;
  stock: number;
  category: string;
  image: string;
  publicationStatus: string;
  activeBindingId: string;
  externalItemId: string;
}

export interface MercadoLivreCategorySuggestion {
  domainId: string;
  domainName: string;
  categoryId: string;
  categoryName: string;
}

export interface MercadoLivreE2ECategoryOptions {
  proposalId: string;
  category: { id: string; name: string };
  conditions: string[];
  currencies: string[];
  listingTypes: Array<{ id: string; name: string }>;
  attributes: Array<{
    id: string;
    name: string;
    valueType: string;
    required: boolean;
    newRequired: boolean;
    conditionalRequired: boolean;
    values: Array<{ id: string; name: string }>;
  }>;
  authority: 'provider_api_requirement_options';
}

export const loadMercadoLivreE2EEligibleProducts = (user: User, storeId: string) =>
  authorizedFetch<{ canonicalStoreId: string; items: MercadoLivreE2EEligibleProduct[] }>(
    user,
    `/api/store-connections/mercado-livre/${encoded(storeId)}/e2e/eligible-products`
  );

export const proposeMercadoLivreE2EPublication = (user: User, storeId: string, connectionId: string, canonicalProductId: string) =>
  authorizedFetch<{ id: string; canonicalStoreId: string; canonicalProductId: string; executionStatus: 'not_authorized' }>(
    user,
    `/api/store-connections/mercado-livre/${encoded(storeId)}/outbound-publication-proposals`,
    { method: 'POST', body: JSON.stringify({ connectionId, canonicalProductId }) }
  );

export const inspectMercadoLivreE2ERequirements = (user: User, storeId: string, proposalId: string) =>
  authorizedFetch<{ proposalId: string; siteId: string; categorySuggestions: MercadoLivreCategorySuggestion[] }>(
    user,
    `/api/store-connections/mercado-livre/${encoded(storeId)}/outbound-publication-proposals/${encoded(proposalId)}/inspect-requirements`,
    { method: 'POST' }
  );

export const loadMercadoLivreE2ECategoryOptions = (user: User, storeId: string, proposalId: string, categoryId: string) =>
  authorizedFetch<MercadoLivreE2ECategoryOptions>(
    user,
    `/api/store-connections/mercado-livre/${encoded(storeId)}/e2e/outbound-publication-proposals/${encoded(proposalId)}/category-options`,
    { method: 'POST', body: JSON.stringify({ categoryId }) }
  );

export type MercadoLivreAttributeInput = { id: string; valueId?: string; valueName?: string };

export const configureMercadoLivreE2ERequirements = (
  user: User,
  storeId: string,
  proposalId: string,
  input: { categoryId: string; listingTypeId: string; condition: string; attributes: MercadoLivreAttributeInput[] }
) => authorizedFetch<{
  proposalId: string;
  ready: boolean;
  requiredAttributeIds: string[];
  conditionalAttributeIds: string[];
  missingRequiredAttributeIds: string[];
}>(
  user,
  `/api/store-connections/mercado-livre/${encoded(storeId)}/outbound-publication-proposals/${encoded(proposalId)}/configure-requirements`,
  { method: 'POST', body: JSON.stringify(input) }
);

export const validateMercadoLivreE2EConditionalRequirements = (user: User, storeId: string, proposalId: string) =>
  authorizedFetch<Record<string, unknown>>(
    user,
    `/api/store-connections/mercado-livre/${encoded(storeId)}/outbound-publication-proposals/${encoded(proposalId)}/validate-conditional-requirements`,
    { method: 'POST' }
  );

export const validateMercadoLivreE2EListing = (user: User, storeId: string, proposalId: string) =>
  authorizedFetch<{
    proposalId: string;
    publicationReadiness: 'ready_for_owner_authorization' | 'needs_correction';
    providerStatus: number;
    causes: Array<{ code?: string; message?: string }>;
  }>(
    user,
    `/api/store-connections/mercado-livre/${encoded(storeId)}/outbound-publication-proposals/${encoded(proposalId)}/validate-listing`,
    { method: 'POST' }
  );

export const authorizeMercadoLivreE2EPublication = (user: User, storeId: string, proposalId: string) =>
  authorizedFetch<{
    proposalId: string;
    authorizationId: string;
    authorizationToken: string;
    expiresAtMillis: number;
  }>(
    user,
    `/api/store-connections/mercado-livre/${encoded(storeId)}/outbound-publication-proposals/${encoded(proposalId)}/authorize-publication`,
    { method: 'POST' }
  );

export const executeMercadoLivreE2EPublication = (user: User, storeId: string, authorizationId: string, authorizationToken: string) =>
  authorizedFetch<{
    proposalId: string;
    authorizationId: string;
    executionId: string;
    status: 'published';
    externalItemId: string;
    bindingId: string;
    providerStatus: string;
    permalink?: string;
  }>(
    user,
    `/api/store-connections/mercado-livre/${encoded(storeId)}/outbound-publication-authorizations/${encoded(authorizationId)}/execute`,
    { method: 'POST', body: JSON.stringify({ authorizationToken }) }
  );

export const reconcileMercadoLivreE2EPublication = (user: User, storeId: string, executionId: string) =>
  authorizedFetch<{
    executionId: string;
    bindingId: string;
    externalItemId: string;
    snapshotId: string;
    reconciliationStatus: 'reconciled';
  }>(
    user,
    `/api/store-connections/mercado-livre/${encoded(storeId)}/outbound-publication-executions/${encoded(executionId)}/reconcile`,
    { method: 'POST' }
  );

export const setMercadoLivreE2EAvailabilityPolicy = (
  user: User,
  canonicalStoreId: string,
  input: { enabled: boolean; safetyStockUnits: number; allocationCapUnits: number | null }
) => authorizedFetch<{ storeId: string; channel: 'mercado_livre'; revision: number }>(
  user,
  `/api/orders/availability/${encoded(canonicalStoreId)}/policies/mercado_livre`,
  { method: 'PUT', body: JSON.stringify(input) }
);

export const createMercadoLivreE2EAvailabilitySnapshot = (user: User, canonicalStoreId: string, productId: string) =>
  authorizedFetch<{
    snapshotId: string;
    sourceFingerprint: string;
    policyRevision: number;
    availableToPromiseUnits: number;
    publishableUnits: number;
  }>(
    user,
    `/api/orders/availability/${encoded(canonicalStoreId)}/products/${encoded(productId)}/snapshots/mercado_livre`,
    { method: 'POST' }
  );

export const proposeMercadoLivreE2EStock = (user: User, storeId: string, bindingId: string, channelAvailabilitySnapshotId: string) =>
  authorizedFetch<{
    id: string;
    status: 'review_required' | 'no_changes' | 'blocked_provider_stock_mode';
    targetAvailableQuantity: number;
    observedAvailableQuantity: number | null;
    blockedReason: string;
  }>(
    user,
    `/api/store-connections/mercado-livre/${encoded(storeId)}/external-catalog-bindings/${encoded(bindingId)}/stock-proposals`,
    { method: 'POST', body: JSON.stringify({ channelAvailabilitySnapshotId }) }
  );

export const authorizeMercadoLivreE2EStock = (user: User, storeId: string, proposalId: string) =>
  authorizedFetch<{
    proposalId: string;
    authorizationId: string;
    authorizationToken: string;
    targetAvailableQuantity: number;
    expiresAtMillis: number;
  }>(
    user,
    `/api/store-connections/mercado-livre/${encoded(storeId)}/outbound-stock-proposals/${encoded(proposalId)}/authorize`,
    { method: 'POST' }
  );

export const executeMercadoLivreE2EStock = (user: User, storeId: string, authorizationId: string, authorizationToken: string) =>
  authorizedFetch<{
    proposalId: string;
    authorizationId: string;
    executionId: string;
    bindingId: string;
    externalItemId: string;
    status: 'provider_write_succeeded';
    targetAvailableQuantity: number;
  }>(
    user,
    `/api/store-connections/mercado-livre/${encoded(storeId)}/outbound-stock-authorizations/${encoded(authorizationId)}/execute`,
    { method: 'POST', body: JSON.stringify({ authorizationToken }) }
  );

export const reconcileMercadoLivreE2EStock = (user: User, storeId: string, executionId: string) =>
  authorizedFetch<{
    executionId: string;
    proposalId: string;
    bindingId: string;
    externalItemId: string;
    targetAvailableQuantity: number;
    observedAvailableQuantity: number;
    reconciliationStatus: 'reconciled';
  }>(
    user,
    `/api/store-connections/mercado-livre/${encoded(storeId)}/outbound-stock-executions/${encoded(executionId)}/reconcile`,
    { method: 'POST' }
  );
