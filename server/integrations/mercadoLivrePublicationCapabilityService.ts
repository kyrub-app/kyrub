import { createHash } from 'node:crypto';
import { mercadoLivreGetJson } from './mercadoLivreOauthService.js';
import { getStoreConnectionRegistryRecord } from './storeConnectionRegistry.js';

const clean = (value: unknown, maximum = 240): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const tagsFrom = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.map(tag => clean(tag, 120)).filter(Boolean))].sort()
    : [];

export type MercadoLivrePublicationModel = 'legacy_items' | 'user_products';
export type MercadoLivreStockAuthority = 'item_available_quantity' | 'stock_locations';
export type MercadoLivrePublicationCapabilityReadiness = 'ready_current_adapter' | 'adapter_migration_required';

export interface MercadoLivrePublicationCapability {
  storeId: string;
  connectionId: string;
  externalAccountId: string;
  siteId: string;
  nickname: string;
  publicationModel: MercadoLivrePublicationModel;
  stockAuthority: MercadoLivreStockAuthority;
  warehouseMode: 'none' | 'single_warehouse' | 'multiwarehouse';
  userProductSeller: boolean;
  warehouseManagement: boolean;
  multiwarehouse: boolean;
  readiness: MercadoLivrePublicationCapabilityReadiness;
  blockers: string[];
  observedTags: string[];
  observedAt: string;
  authority: 'mercado_livre_users_api';
}

export interface MercadoLivrePublicationCapabilitySnapshot {
  externalAccountId: string;
  siteId: string;
  publicationModel: MercadoLivrePublicationModel;
  stockAuthority: MercadoLivreStockAuthority;
  warehouseMode: 'none' | 'single_warehouse' | 'multiwarehouse';
  userProductSeller: boolean;
  warehouseManagement: boolean;
  multiwarehouse: boolean;
  observedTags: string[];
  observedAt: string;
  authority: 'mercado_livre_users_api';
  fingerprint: string;
}

const materialCapabilityState = (capability: MercadoLivrePublicationCapability) => ({
  externalAccountId: capability.externalAccountId,
  siteId: capability.siteId,
  publicationModel: capability.publicationModel,
  stockAuthority: capability.stockAuthority,
  warehouseMode: capability.warehouseMode,
  userProductSeller: capability.userProductSeller,
  warehouseManagement: capability.warehouseManagement,
  multiwarehouse: capability.multiwarehouse,
});

export const mercadoLivrePublicationCapabilityFingerprint = (
  capability: MercadoLivrePublicationCapability
): string => createHash('sha256')
  .update(JSON.stringify(materialCapabilityState(capability)))
  .digest('hex');

export const freezeMercadoLivrePublicationCapability = (
  capability: MercadoLivrePublicationCapability
): MercadoLivrePublicationCapabilitySnapshot => ({
  ...materialCapabilityState(capability),
  observedTags: [...capability.observedTags],
  observedAt: capability.observedAt,
  authority: capability.authority,
  fingerprint: mercadoLivrePublicationCapabilityFingerprint(capability),
});

export const projectMercadoLivrePublicationCapability = (input: {
  storeId: string;
  connectionId: string;
  externalAccountId: string;
  seller: unknown;
  observedAt?: string;
}): MercadoLivrePublicationCapability => {
  if (!input.seller || typeof input.seller !== 'object' || Array.isArray(input.seller)) {
    throw new Error('MERCADO_LIVRE_SELLER_CAPABILITY_INVALID');
  }
  const seller = input.seller as Record<string, unknown>;
  const externalAccountId = clean(input.externalAccountId, 160);
  const observedSellerId = clean(seller.id, 160);
  if (!externalAccountId || observedSellerId !== externalAccountId) {
    throw new Error('MERCADO_LIVRE_SELLER_IDENTITY_MISMATCH');
  }
  const siteId = clean(seller.site_id, 40);
  if (!siteId) throw new Error('MERCADO_LIVRE_SELLER_SITE_REQUIRED');

  const observedTags = tagsFrom(seller.tags);
  const userProductSeller = observedTags.includes('user_product_seller');
  const warehouseManagement = observedTags.includes('warehouse_management');
  const multiwarehouse = observedTags.includes('multiwarehouse');

  if (multiwarehouse && !warehouseManagement) {
    throw new Error('MERCADO_LIVRE_WAREHOUSE_CAPABILITY_INCONSISTENT');
  }

  const publicationModel: MercadoLivrePublicationModel = userProductSeller ? 'user_products' : 'legacy_items';
  const stockAuthority: MercadoLivreStockAuthority = warehouseManagement ? 'stock_locations' : 'item_available_quantity';
  const warehouseMode = multiwarehouse
    ? 'multiwarehouse'
    : warehouseManagement
      ? 'single_warehouse'
      : 'none';

  const blockers: string[] = [];
  if (publicationModel === 'user_products') blockers.push('user_products_publication_adapter_required');
  if (stockAuthority === 'stock_locations') blockers.push('stock_locations_adapter_required');

  return {
    storeId: clean(input.storeId, 160),
    connectionId: clean(input.connectionId, 200),
    externalAccountId,
    siteId,
    nickname: clean(seller.nickname, 160),
    publicationModel,
    stockAuthority,
    warehouseMode,
    userProductSeller,
    warehouseManagement,
    multiwarehouse,
    readiness: blockers.length ? 'adapter_migration_required' : 'ready_current_adapter',
    blockers,
    observedTags,
    observedAt: input.observedAt ?? new Date().toISOString(),
    authority: 'mercado_livre_users_api',
  };
};

export const inspectMercadoLivrePublicationCapability = async (input: {
  storeId: string;
  connectionId: string;
  requestedByUserId: string;
}): Promise<MercadoLivrePublicationCapability> => {
  const storeId = clean(input.storeId, 160);
  const connectionId = clean(input.connectionId, 200);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  if (!storeId || !connectionId || requestedByUserId !== storeId) {
    throw new Error('MERCADO_LIVRE_PUBLICATION_CAPABILITY_FORBIDDEN');
  }

  const connection = await getStoreConnectionRegistryRecord({ storeId, connectionId });
  if (
    !connection ||
    connection.provider !== 'mercado_livre' ||
    connection.status !== 'connected' ||
    connection.storeId !== storeId ||
    !clean(connection.externalAccountId, 160)
  ) {
    throw new Error('MERCADO_LIVRE_CONNECTION_INVALID');
  }

  const externalAccountId = clean(connection.externalAccountId, 160);
  const seller = await mercadoLivreGetJson<unknown>(
    storeId,
    `/users/${encodeURIComponent(externalAccountId)}`
  );

  return projectMercadoLivrePublicationCapability({
    storeId,
    connectionId,
    externalAccountId,
    seller,
  });
};

export const assertMercadoLivrePublicationCapabilityCurrent = async (input: {
  storeId: string;
  connectionId: string;
  requestedByUserId: string;
  expectedFingerprint: string;
  expectedPublicationModel: MercadoLivrePublicationModel;
  expectedStockAuthority: MercadoLivreStockAuthority;
}): Promise<MercadoLivrePublicationCapabilitySnapshot> => {
  const expectedFingerprint = clean(input.expectedFingerprint, 80);
  if (!/^[a-f0-9]{64}$/i.test(expectedFingerprint)) {
    throw new Error('MERCADO_LIVRE_PUBLICATION_CAPABILITY_EXPECTATION_INVALID');
  }

  const current = await inspectMercadoLivrePublicationCapability({
    storeId: input.storeId,
    connectionId: input.connectionId,
    requestedByUserId: input.requestedByUserId,
  });
  const snapshot = freezeMercadoLivrePublicationCapability(current);
  if (
    snapshot.fingerprint !== expectedFingerprint ||
    current.publicationModel !== input.expectedPublicationModel ||
    current.stockAuthority !== input.expectedStockAuthority
  ) {
    throw new Error('MERCADO_LIVRE_PUBLICATION_CAPABILITY_STALE');
  }
  if (current.readiness !== 'ready_current_adapter') {
    throw new Error(
      `MERCADO_LIVRE_OUTBOUND_PUBLICATION_ADAPTER_MIGRATION_REQUIRED:${current.blockers.join(',')}`
    );
  }
  return snapshot;
};