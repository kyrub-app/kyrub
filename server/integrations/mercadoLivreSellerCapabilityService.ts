import { createHash } from 'node:crypto';
import { mercadoLivreGetJson } from './mercadoLivreOauthService.js';
import { getStoreConnectionRegistryRecord } from './storeConnectionRegistry.js';

export type MercadoLivrePublicationModel = 'legacy_items' | 'user_products';
export type MercadoLivreStockAuthorityMode =
  | 'item_available_quantity'
  | 'user_product_item_readback_required'
  | 'multi_origin_seller_warehouse';

export interface MercadoLivreSellerCapabilitySnapshot {
  provider: 'mercado_livre';
  connectionId: string;
  providerUserId: string;
  siteId: string;
  publicationModel: MercadoLivrePublicationModel;
  stockAuthorityMode: MercadoLivreStockAuthorityMode;
  requiresUserProductsAdapter: boolean;
  warehouseManagementEnabled: boolean;
  isTestUser: boolean;
  relevantTags: string[];
  capabilityFingerprint: string;
  observedAt: string;
  authority: 'mercado_livre_authenticated_user_profile';
}

interface MercadoLivreUserProfile {
  id?: unknown;
  site_id?: unknown;
  tags?: unknown;
}

const clean = (value: unknown, maximum = 300): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().slice(0, maximum)
    : '';

const normalizeTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(tag => clean(tag, 120)).filter(Boolean))].sort();
};

export const normalizeMercadoLivreSellerCapability = (input: {
  connectionId: string;
  expectedProviderUserId: string;
  profile: MercadoLivreUserProfile;
  observedAt?: string;
}): MercadoLivreSellerCapabilitySnapshot => {
  const connectionId = clean(input.connectionId, 200);
  const expectedProviderUserId = clean(input.expectedProviderUserId, 160);
  const providerUserId = clean(input.profile?.id, 160);
  const siteId = clean(input.profile?.site_id, 40);
  if (!connectionId || !expectedProviderUserId || providerUserId !== expectedProviderUserId || !siteId) {
    throw new Error('MERCADO_LIVRE_SELLER_CAPABILITY_IDENTITY_MISMATCH');
  }

  const tags = normalizeTags(input.profile?.tags);
  const tagSet = new Set(tags);
  const requiresUserProductsAdapter = tagSet.has('user_product_seller');
  const warehouseManagementEnabled = tagSet.has('warehouse_management');
  const publicationModel: MercadoLivrePublicationModel = requiresUserProductsAdapter
    ? 'user_products'
    : 'legacy_items';
  const stockAuthorityMode: MercadoLivreStockAuthorityMode = warehouseManagementEnabled
    ? 'multi_origin_seller_warehouse'
    : requiresUserProductsAdapter
      ? 'user_product_item_readback_required'
      : 'item_available_quantity';
  const relevantTags = tags.filter(tag =>
    tag === 'user_product_seller' || tag === 'warehouse_management' || tag === 'test_user'
  );
  const capabilityFingerprint = createHash('sha256')
    .update(JSON.stringify({
      providerUserId,
      siteId,
      publicationModel,
      stockAuthorityMode,
      relevantTags,
    }))
    .digest('hex');

  return {
    provider: 'mercado_livre',
    connectionId,
    providerUserId,
    siteId,
    publicationModel,
    stockAuthorityMode,
    requiresUserProductsAdapter,
    warehouseManagementEnabled,
    isTestUser: tagSet.has('test_user'),
    relevantTags,
    capabilityFingerprint,
    observedAt: input.observedAt ?? new Date().toISOString(),
    authority: 'mercado_livre_authenticated_user_profile',
  };
};

export const inspectMercadoLivreSellerCapability = async (input: {
  storeId: string;
  connectionId: string;
}): Promise<MercadoLivreSellerCapabilitySnapshot> => {
  const storeId = clean(input.storeId, 160);
  const connectionId = clean(input.connectionId, 200);
  if (!storeId || !connectionId) throw new Error('MERCADO_LIVRE_SELLER_CAPABILITY_TARGET_INVALID');

  const connection = await getStoreConnectionRegistryRecord({ storeId, connectionId });
  if (
    !connection ||
    connection.provider !== 'mercado_livre' ||
    connection.status !== 'connected' ||
    connection.syncAuthority !== 'manual_review' ||
    !clean(connection.externalAccountId, 160)
  ) {
    throw new Error('MERCADO_LIVRE_CONNECTION_INVALID');
  }

  const providerUserId = clean(connection.externalAccountId, 160);
  const profile = await mercadoLivreGetJson<MercadoLivreUserProfile>(
    storeId,
    `/users/${encodeURIComponent(providerUserId)}`
  );
  return normalizeMercadoLivreSellerCapability({
    connectionId,
    expectedProviderUserId: providerUserId,
    profile,
  });
};
