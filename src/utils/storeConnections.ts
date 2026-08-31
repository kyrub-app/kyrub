import type { User } from 'firebase/auth';
import type {
  KyrubCommerceChannel,
  KyrubConnectionStatus,
  KyrubSyncAuthority,
} from '../../shared/storeConnections';
import type { MercadoLivreCatalogPreviewItem } from '../../shared/mercadoLivreIntegration';

export interface PublicStoreConnectionRecord {
  id: string;
  scope: 'store';
  storeId: string;
  provider: string;
  channel: KyrubCommerceChannel;
  status: KyrubConnectionStatus;
  externalAccountId: string;
  syncAuthority: KyrubSyncAuthority;
  connectedByUserId: string;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt?: string;
  credentialAuthority: 'vault';
}

export interface StoreConnectionOnboardingSnapshot {
  storeId: string;
  question: string;
  declaration: {
    schemaVersion: 1;
    storeId: string;
    channels: KyrubCommerceChannel[];
    source: 'merchant_onboarding';
    authority: 'store_owner';
    declaredByUserId: string;
    declaredAt: string;
  } | null;
  connections: PublicStoreConnectionRecord[];
}

export interface MercadoLivreCatalogPreview {
  connectionId: string;
  total: number;
  items: MercadoLivreCatalogPreviewItem[];
}

export interface MercadoLivreImportDraftPreparationItem {
  draft: {
    id: string;
    storeId: string;
    source: 'mercado_livre';
    status: 'draft';
    title: string;
    price: number | null;
    categoryId: string;
    thumbnail?: string;
    sellerSku?: string;
    sourceAvailableQuantity?: number;
    provenance: {
      source: 'mercado_livre';
      externalId: string;
      connectionId: string;
      importedAt: string;
      lastSyncedAt: string;
    };
    createdAt: string;
    updatedAt: string;
    kyrubPreparationDraftId?: string;
    preparedFromUpdatedAt?: string;
    preparationStatus?: 'prepared';
    promotionStatus?: 'promoted';
    externalCatalogBindingId?: string;
    canonicalProductId?: string;
  };
  preparation: {
    status: 'not_prepared' | 'prepared' | 'stale' | 'bound';
    kyrubDraftId?: string;
    canonicalProductId?: string;
  };
}

export interface MercadoLivreSyncReviewItem {
  proposal: {
    id: string;
    provider: 'mercado_livre';
    storeId: string;
    connectionId: string;
    externalItemId: string;
    snapshotId: string;
    sourceNotificationId: string;
    status: 'review_required' | 'approved' | 'rejected';
    authority: 'provider_api_refetch';
    proposedAt: string;
    proposal: 'external_change_detected';
    decisionAuthority?: 'store_owner_review';
    applyStatus?: 'not_applied' | 'applied';
  };
  snapshot: {
    id: string;
    provider: 'mercado_livre';
    storeId: string;
    connectionId: string;
    externalAccountId: string;
    externalItemId: string;
    sourceNotificationId: string;
    sourceTopic: string;
    sourceResource: string;
    authority: 'provider_api_refetch';
    fetchedAt: string;
    item: {
      externalId: string;
      title: string;
      price: number | null;
      availableQuantity: number | null;
      status: string;
      categoryId: string;
      sellerSku?: string;
    };
  };
}

export interface MercadoLivreBoundProductSyncItem {
  proposalId: string;
  snapshotId: string;
  bindingId: string;
  canonicalProductId: string;
  canonicalStoreId: string;
  externalItemId: string;
  current: {
    name: string;
    price: number;
    publicationStatus: string;
  };
  incoming: {
    name: string;
    price: number | null;
  };
  changedFields: Array<'name' | 'price'>;
  baselineStatus: 'clean' | 'conflict';
}

const authorizedFetch = async <T>(
  user: User,
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<T> => {
  const token = await user.getIdToken();
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(input, {
    ...init,
    headers,
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.error === 'string' && payload.error.trim()
      ? payload.error.trim()
      : `Não foi possível concluir a operação (${response.status}).`;
    throw new Error(message);
  }
  return payload as T;
};

const encoded = (value: string): string => encodeURIComponent(value.trim());

export const loadStoreConnectionOnboarding = async (
  user: User,
  storeId: string
): Promise<StoreConnectionOnboardingSnapshot> =>
  authorizedFetch<StoreConnectionOnboardingSnapshot>(
    user,
    `/api/store-connections/${encoded(storeId)}`
  );

export const beginMercadoLivreConnection = async (
  user: User,
  storeId: string
): Promise<string> => {
  const payload = await authorizedFetch<{ authorizationUrl: string }>(
    user,
    `/api/store-connections/mercado-livre/${encoded(storeId)}/authorize`,
    { method: 'POST' }
  );
  if (!payload.authorizationUrl?.startsWith('https://')) {
    throw new Error('O backend não retornou uma autorização segura do Mercado Livre.');
  }
  return payload.authorizationUrl;
};

export const loadMercadoLivreCatalogPreview = async (
  user: User,
  storeId: string,
  limit = 50
): Promise<MercadoLivreCatalogPreview> =>
  authorizedFetch<MercadoLivreCatalogPreview>(
    user,
    `/api/store-connections/mercado-livre/${encoded(storeId)}/catalog-preview?limit=${Math.max(1, Math.min(100, Math.trunc(limit)))}`
  );

export const confirmMercadoLivreCatalogImport = async (
  user: User,
  storeId: string,
  itemIds: string[]
): Promise<{ imported: number }> =>
  authorizedFetch<{ imported: number }>(
    user,
    `/api/store-connections/mercado-livre/${encoded(storeId)}/catalog-import`,
    {
      method: 'POST',
      body: JSON.stringify({ itemIds }),
    }
  );

export const loadMercadoLivreImportDraftsForPreparation = async (
  user: User,
  storeId: string,
  limit = 50
): Promise<{ items: MercadoLivreImportDraftPreparationItem[] }> =>
  authorizedFetch<{ items: MercadoLivreImportDraftPreparationItem[] }>(
    user,
    `/api/store-connections/mercado-livre/${encoded(storeId)}/catalog-import-drafts?limit=${Math.max(1, Math.min(100, Math.trunc(limit)))}`
  );

export const prepareMercadoLivreImportAsKyrubCatalogDraft = async (
  user: User,
  storeId: string,
  draftId: string
): Promise<{
  importDraftId: string;
  kyrubDraftId: string;
  status: 'prepared';
  missingFields: Array<'price' | 'category' | 'stock'>;
  alreadyPrepared: boolean;
}> =>
  authorizedFetch(
    user,
    `/api/store-connections/mercado-livre/${encoded(storeId)}/catalog-import-drafts/${encoded(draftId)}/prepare-kyrub-draft`,
    { method: 'POST' }
  );

export const createCanonicalKyrubProductFromMercadoLivreDraft = async (
  user: User,
  storeId: string,
  draftId: string,
  input: { category: string; stock: number; price?: number }
): Promise<{
  importDraftId: string;
  bindingId: string;
  canonicalProductId: string;
  publicationStatus: 'draft';
  alreadyBound: boolean;
}> =>
  authorizedFetch(
    user,
    `/api/store-connections/mercado-livre/${encoded(storeId)}/catalog-import-drafts/${encoded(draftId)}/create-kyrub-product`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    }
  );

export const loadMercadoLivreSyncReviewQueue = async (
  user: User,
  storeId: string,
  limit = 50
): Promise<{ items: MercadoLivreSyncReviewItem[] }> =>
  authorizedFetch<{ items: MercadoLivreSyncReviewItem[] }>(
    user,
    `/api/store-connections/mercado-livre/${encoded(storeId)}/sync-proposals?limit=${Math.max(1, Math.min(100, Math.trunc(limit)))}`
  );

export const loadApprovedMercadoLivreSyncProposals = async (
  user: User,
  storeId: string,
  limit = 50
): Promise<{ items: MercadoLivreSyncReviewItem[] }> =>
  authorizedFetch<{ items: MercadoLivreSyncReviewItem[] }>(
    user,
    `/api/store-connections/mercado-livre/${encoded(storeId)}/sync-proposals-approved?limit=${Math.max(1, Math.min(100, Math.trunc(limit)))}`
  );

export const loadMercadoLivreBoundProductSyncQueue = async (
  user: User,
  storeId: string,
  limit = 50
): Promise<{ items: MercadoLivreBoundProductSyncItem[] }> =>
  authorizedFetch<{ items: MercadoLivreBoundProductSyncItem[] }>(
    user,
    `/api/store-connections/mercado-livre/${encoded(storeId)}/bound-product-sync?limit=${Math.max(1, Math.min(100, Math.trunc(limit)))}`
  );

export const decideMercadoLivreSyncProposal = async (
  user: User,
  storeId: string,
  proposalId: string,
  decision: 'approve' | 'reject'
): Promise<{ proposalId: string; status: 'approved' | 'rejected' }> =>
  authorizedFetch<{ proposalId: string; status: 'approved' | 'rejected' }>(
    user,
    `/api/store-connections/mercado-livre/${encoded(storeId)}/sync-proposals/${encoded(proposalId)}/decision`,
    {
      method: 'POST',
      body: JSON.stringify({ decision }),
    }
  );

export const applyApprovedMercadoLivreSyncProposalToDraft = async (
  user: User,
  storeId: string,
  proposalId: string
): Promise<{
  proposalId: string;
  draftId: string;
  applyStatus: 'applied';
  target: 'catalog_import_draft';
  alreadyApplied: boolean;
}> =>
  authorizedFetch(
    user,
    `/api/store-connections/mercado-livre/${encoded(storeId)}/sync-proposals/${encoded(proposalId)}/apply-to-draft`,
    { method: 'POST' }
  );

export const applyMercadoLivreSnapshotToBoundCanonicalProduct = async (
  user: User,
  storeId: string,
  proposalId: string
): Promise<{
  proposalId: string;
  bindingId: string;
  canonicalProductId: string;
  changedFields: Array<'name' | 'price'>;
  canonicalApplyStatus: 'applied';
  alreadyApplied: boolean;
}> =>
  authorizedFetch(
    user,
    `/api/store-connections/mercado-livre/${encoded(storeId)}/sync-proposals/${encoded(proposalId)}/apply-to-canonical`,
    { method: 'POST' }
  );

export const updateStoreConnectionSyncAuthority = async (
  user: User,
  storeId: string,
  connectionId: string,
  syncAuthority: KyrubSyncAuthority
): Promise<PublicStoreConnectionRecord> =>
  authorizedFetch<PublicStoreConnectionRecord>(
    user,
    `/api/store-connections/${encoded(storeId)}/${encoded(connectionId)}/sync-authority`,
    {
      method: 'PATCH',
      body: JSON.stringify({ syncAuthority }),
    }
  );
