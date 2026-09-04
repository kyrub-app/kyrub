import {
  inspectMercadoLivrePublicationCapability,
  mercadoLivrePublicationCapabilityFingerprint,
  type MercadoLivrePublicationCapability,
} from './mercadoLivrePublicationCapabilityService.js';

export const assertMercadoLivrePublicationCapabilityUnchanged = async (input: {
  storeId: string;
  connectionId: string;
  expectedFingerprint: string;
  requestedByUserId: string;
}): Promise<MercadoLivrePublicationCapability> => {
  const expectedFingerprint = input.expectedFingerprint.trim();
  if (!expectedFingerprint) throw new Error('MERCADO_LIVRE_PUBLICATION_CAPABILITY_FINGERPRINT_REQUIRED');

  const capability = await inspectMercadoLivrePublicationCapability({
    storeId: input.storeId,
    connectionId: input.connectionId,
    requestedByUserId: input.requestedByUserId,
  });
  const currentFingerprint = mercadoLivrePublicationCapabilityFingerprint(capability);
  if (currentFingerprint !== expectedFingerprint) {
    throw new Error('MERCADO_LIVRE_PUBLICATION_CAPABILITY_CHANGED');
  }
  if (
    capability.readiness !== 'ready_current_adapter' ||
    capability.publicationModel !== 'legacy_items' ||
    capability.stockAuthority !== 'item_available_quantity'
  ) {
    throw new Error('MERCADO_LIVRE_PUBLICATION_ADAPTER_MIGRATION_REQUIRED');
  }
  return capability;
};
