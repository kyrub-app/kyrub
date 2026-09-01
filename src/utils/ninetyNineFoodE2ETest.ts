import { auth } from './firebase';

const encoded = (value: string): string => encodeURIComponent(value.trim());

const authorizedRequest = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente.');
  const token = await user.getIdToken();
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(path, { ...init, headers, cache: 'no-store' });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' && payload.error.trim()
      ? payload.error.trim()
      : `Não foi possível concluir a operação 99Food (${response.status}).`);
  }
  return payload as T;
};

export interface NinetyNineFoodE2EBinding {
  id: string;
  provider: '99food';
  canonicalStoreId: string;
  externalStoreId: string;
  externalProductId: string;
  canonicalProductId: string;
  status: 'active' | 'inactive';
  revision: number;
}

export interface NinetyNineFoodE2ECatalogIdentity {
  id: string;
  status: 'resolved' | 'not_found' | 'ambiguous';
  bindingId: string;
  bindingRevision: number;
  providerMenuId: string;
  providerItemOfferId: string;
  providerItemExternalCode: string;
  candidateCount: number;
  capabilityManifestHash: string;
}

export interface NinetyNineFoodE2EReconciliation {
  reconciliationId: string;
  executionId: string;
  targetAvailableQuantity: number;
  observedQuantityAvailable: number;
  status: 'reconciled' | 'reconciliation_required';
  providerEvidenceHash: string;
  authority: 'provider_merchant_snapshot_refetch_comparison';
}

export const listNinetyNineFoodE2EBindings = () =>
  authorizedRequest<{ canonicalStoreId: string; externalStoreId: string; items: NinetyNineFoodE2EBinding[] }>(
    '/api/integrations/99food/product-bindings'
  );

export const bindNinetyNineFoodE2EProduct = (externalProductId: string, canonicalProductId: string) =>
  authorizedRequest<{ binding: NinetyNineFoodE2EBinding; alreadyBound: boolean }>(
    `/api/integrations/99food/product-bindings/${encoded(externalProductId)}`,
    { method: 'PUT', body: JSON.stringify({ canonicalProductId }) }
  );

export const discoverNinetyNineFoodE2EMenuCapability = () =>
  authorizedRequest<{ capability: Record<string, unknown> | null }>(
    '/api/integrations/99food/capabilities/menu/discover',
    { method: 'POST' }
  );

export const resolveNinetyNineFoodE2ECatalogIdentity = (externalProductId: string) =>
  authorizedRequest<NinetyNineFoodE2ECatalogIdentity>(
    `/api/integrations/99food/product-bindings/${encoded(externalProductId)}/catalog-identity/resolve`,
    { method: 'POST' }
  );

export const setNinetyNineFoodE2EAvailabilityPolicy = (
  canonicalStoreId: string,
  input: { enabled: boolean; safetyStockUnits: number; allocationCapUnits: number | null }
) => authorizedRequest<{ storeId: string; channel: '99food'; revision: number }>(
  `/api/orders/availability/${encoded(canonicalStoreId)}/policies/99food`,
  { method: 'PUT', body: JSON.stringify(input) }
);

export const createNinetyNineFoodE2EAvailabilitySnapshot = (
  canonicalStoreId: string,
  canonicalProductId: string
) => authorizedRequest<{
  snapshotId: string;
  sourceFingerprint: string;
  policyRevision: number;
  availableToPromiseUnits: number;
  publishableUnits: number;
}>(
  `/api/orders/availability/${encoded(canonicalStoreId)}/products/${encoded(canonicalProductId)}/snapshots/99food`,
  { method: 'POST' }
);

export const proposeNinetyNineFoodE2EAvailability = (
  externalProductId: string,
  channelAvailabilitySnapshotId: string
) => authorizedRequest<{
  proposal: {
    id: string;
    targetAvailableQuantity: number;
    status: 'review_required';
    executionStatus: 'not_authorized';
  };
  alreadyExisted: boolean;
}>(
  `/api/integrations/99food/product-bindings/${encoded(externalProductId)}/availability-proposals`,
  { method: 'POST', body: JSON.stringify({ channelAvailabilitySnapshotId }) }
);

export const authorizeNinetyNineFoodE2EAvailability = (proposalId: string) =>
  authorizedRequest<{
    authorization: {
      id: string;
      proposalId: string;
      targetAvailableQuantity: number;
      providerMenuId: string;
      providerItemOfferId: string;
      expiresAt: string;
    };
    authorizationToken: string;
  }>(
    `/api/integrations/99food/availability-proposals/${encoded(proposalId)}/authorize`,
    { method: 'POST' }
  );

export const executeNinetyNineFoodE2EAvailability = (
  authorizationId: string,
  authorizationToken: string
) => authorizedRequest<{
  execution: {
    id: string;
    authorizationId: string;
    targetAvailableQuantity: number;
    status: 'provider_write_accepted' | 'provider_rejected' | 'reconciliation_required';
    providerHttpStatus: number | null;
  };
}>(
  `/api/integrations/99food/availability-authorizations/${encoded(authorizationId)}/execute`,
  { method: 'POST', body: JSON.stringify({ authorizationToken }) }
);

export const reconcileNinetyNineFoodE2EAvailability = (executionId: string) =>
  authorizedRequest<NinetyNineFoodE2EReconciliation>(
    `/api/integrations/99food/availability-executions/${encoded(executionId)}/reconcile`,
    { method: 'POST' }
  );
