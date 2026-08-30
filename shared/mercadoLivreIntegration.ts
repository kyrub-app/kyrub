import type { KyrubImportedDataProvenance } from './storeConnections.js';

export const MERCADO_LIVRE_CHANNEL = 'mercado_livre' as const;
export const MERCADO_LIVRE_PROVIDER = 'mercado_livre' as const;
export const MERCADO_LIVRE_AUTHORIZATION_ENDPOINT =
  'https://auth.mercadolivre.com.br/authorization';
export const MERCADO_LIVRE_TOKEN_ENDPOINT =
  'https://api.mercadolibre.com/oauth/token';
export const MERCADO_LIVRE_API_ORIGIN = 'https://api.mercadolibre.com';

export interface MercadoLivreCatalogPreviewItem {
  externalId: string;
  title: string;
  price: number | null;
  status: string;
  categoryId: string;
  thumbnail?: string;
  sellerSku?: string;
  sourceAvailableQuantity?: number;
}

export interface MercadoLivreCatalogImportDraft {
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
  provenance: KyrubImportedDataProvenance;
  createdAt: string;
  updatedAt: string;
}

export const buildMercadoLivreImportProvenance = (input: {
  externalId: string;
  connectionId: string;
  importedAt: string;
}): KyrubImportedDataProvenance => ({
  source: 'mercado_livre',
  externalId: input.externalId.trim(),
  connectionId: input.connectionId.trim(),
  importedAt: input.importedAt,
  lastSyncedAt: input.importedAt,
});
