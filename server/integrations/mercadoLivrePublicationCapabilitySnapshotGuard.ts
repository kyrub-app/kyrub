import {
  freezeMercadoLivrePublicationCapability,
  inspectMercadoLivrePublicationCapability,
  type MercadoLivrePublicationCapabilitySnapshot,
} from './mercadoLivrePublicationCapabilityService.js';

const clean = (value: unknown, maximum = 240): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

export const assertMercadoLivrePublicationCapabilitySnapshot = (
  value: unknown
): MercadoLivrePublicationCapabilitySnapshot => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_PUBLICATION_CAPABILITY_SNAPSHOT_INVALID');
  }
  const record = value as Record<string, unknown>;
  if (
    !clean(record.externalAccountId, 160) ||
    !clean(record.siteId, 40) ||
    (record.publicationModel !== 'legacy_items' && record.publicationModel !== 'user_products') ||
    (record.stockAuthority !== 'item_available_quantity' && record.stockAuthority !== 'stock_locations') ||
    (record.warehouseMode !== 'none' && record.warehouseMode !== 'single_warehouse' && record.warehouseMode !== 'multiwarehouse') ||
    typeof record.userProductSeller !== 'boolean' ||
    typeof record.warehouseManagement !== 'boolean' ||
    typeof record.multiwarehouse !== 'boolean' ||
    !Array.isArray(record.observedTags) ||
    !clean(record.observedAt, 80) ||
    record.authority !== 'mercado_livre_users_api' ||
    !/^[a-f0-9]{64}$/i.test(clean(record.fingerprint, 80))
  ) {
    throw new Error('MERCADO_LIVRE_PUBLICATION_CAPABILITY_SNAPSHOT_INVALID');
  }
  return record as unknown as MercadoLivrePublicationCapabilitySnapshot;
};

export const assertCurrentMercadoLivrePublicationCapability = async (input: {
  storeId: string;
  connectionId: string;
  requestedByUserId: string;
  expectedSnapshot: unknown;
}): Promise<MercadoLivrePublicationCapabilitySnapshot> => {
  const expected = assertMercadoLivrePublicationCapabilitySnapshot(input.expectedSnapshot);
  const current = await inspectMercadoLivrePublicationCapability({
    storeId: input.storeId,
    connectionId: input.connectionId,
    requestedByUserId: input.requestedByUserId,
  });
  const currentSnapshot = freezeMercadoLivrePublicationCapability(current);

  if (
    current.readiness !== 'ready_current_adapter' ||
    currentSnapshot.fingerprint !== expected.fingerprint ||
    currentSnapshot.externalAccountId !== expected.externalAccountId ||
    currentSnapshot.siteId !== expected.siteId ||
    currentSnapshot.publicationModel !== expected.publicationModel ||
    currentSnapshot.stockAuthority !== expected.stockAuthority ||
    currentSnapshot.warehouseMode !== expected.warehouseMode ||
    currentSnapshot.userProductSeller !== expected.userProductSeller ||
    currentSnapshot.warehouseManagement !== expected.warehouseManagement ||
    currentSnapshot.multiwarehouse !== expected.multiwarehouse
  ) {
    throw new Error('MERCADO_LIVRE_PUBLICATION_CAPABILITY_STALE');
  }

  if (
    currentSnapshot.publicationModel !== 'legacy_items' ||
    currentSnapshot.stockAuthority !== 'item_available_quantity'
  ) {
    throw new Error('MERCADO_LIVRE_OUTBOUND_PUBLICATION_MODEL_UNSUPPORTED');
  }

  return currentSnapshot;
};
