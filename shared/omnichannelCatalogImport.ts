export type OmnichannelCatalogSource = 'mercado_livre' | 'shopee' | 'ifood' | '99food' | 'instagram' | 'erp' | 'csv' | 'ai' | 'manual';

export interface DiscoveredCatalogItem {
  externalId: string;
  title: string;
  category?: string;
  price?: number;
  imageUrls: string[];
  stock?: number;
  rawFingerprint: string;
}

export interface CatalogImportConflict {
  externalId: string;
  kind: 'duplicate_external_id' | 'possible_duplicate_title' | 'price_mismatch' | 'stock_mismatch';
  message: string;
}

export interface CatalogImportPreview {
  previewId: string;
  storeId: string;
  connectionId: string;
  source: OmnichannelCatalogSource;
  discoveredAt: string;
  items: DiscoveredCatalogItem[];
  conflicts: CatalogImportConflict[];
  importAllowed: boolean;
  requiresHumanConfirmation: true;
}

export interface ConfirmedCatalogImport {
  previewId: string;
  storeId: string;
  connectionId: string;
  confirmedByUserId: string;
  confirmedAt: string;
}

const required = (value: string, code: string): void => {
  if (!value.trim()) throw new Error(code);
};

export const buildCatalogImportPreview = (input: Omit<CatalogImportPreview, 'importAllowed' | 'requiresHumanConfirmation'>): CatalogImportPreview => {
  required(input.previewId, 'CATALOG_PREVIEW_ID_REQUIRED');
  required(input.storeId, 'CATALOG_STORE_REQUIRED');
  required(input.connectionId, 'CATALOG_CONNECTION_REQUIRED');
  const seen = new Set<string>();
  for (const item of input.items) {
    required(item.externalId, 'CATALOG_EXTERNAL_ID_REQUIRED');
    required(item.title, 'CATALOG_TITLE_REQUIRED');
    required(item.rawFingerprint, 'CATALOG_FINGERPRINT_REQUIRED');
    if (seen.has(item.externalId)) throw new Error('CATALOG_DUPLICATE_EXTERNAL_ID');
    seen.add(item.externalId);
  }
  return {
    ...input,
    importAllowed: input.items.length > 0,
    requiresHumanConfirmation: true,
  };
};

export const confirmCatalogImportPreview = (
  preview: CatalogImportPreview,
  input: Omit<ConfirmedCatalogImport, 'previewId' | 'storeId' | 'connectionId'>
): ConfirmedCatalogImport => {
  if (!preview.importAllowed) throw new Error('CATALOG_IMPORT_NOT_ALLOWED');
  required(input.confirmedByUserId, 'CATALOG_CONFIRMER_REQUIRED');
  required(input.confirmedAt, 'CATALOG_CONFIRMED_AT_REQUIRED');
  return {
    previewId: preview.previewId,
    storeId: preview.storeId,
    connectionId: preview.connectionId,
    confirmedByUserId: input.confirmedByUserId,
    confirmedAt: input.confirmedAt,
  };
};

export const canImportCatalog = (preview: CatalogImportPreview, confirmation?: ConfirmedCatalogImport): boolean =>
  Boolean(
    preview.importAllowed &&
    confirmation &&
    confirmation.previewId === preview.previewId &&
    confirmation.storeId === preview.storeId &&
    confirmation.connectionId === preview.connectionId
  );
