import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  buildMercadoLivreImportProvenance,
  type MercadoLivreCatalogImportDraft,
  type MercadoLivreCatalogPreviewItem,
} from '../../shared/mercadoLivreIntegration.js';
import { getStoreConnectionRegistryRecord } from './storeConnectionRegistry.js';
import { getValidMercadoLivreAccessToken, mercadoLivreGetJson } from './mercadoLivreOauthService.js';

interface SearchResponse {
  results?: unknown;
  paging?: { total?: unknown };
}

interface MultigetEntry {
  code?: unknown;
  body?: unknown;
}

const clean = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

const finiteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseItemBody = (value: unknown): MercadoLivreCatalogPreviewItem | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const externalId = clean(candidate.id);
  const title = clean(candidate.title);
  if (!externalId || !title) return null;
  const availableQuantity = finiteNumber(candidate.available_quantity);
  return {
    externalId,
    title,
    price: finiteNumber(candidate.price),
    status: clean(candidate.status),
    categoryId: clean(candidate.category_id),
    ...(clean(candidate.thumbnail) ? { thumbnail: clean(candidate.thumbnail) } : {}),
    ...(clean(candidate.seller_custom_field) ? { sellerSku: clean(candidate.seller_custom_field) } : {}),
    ...(availableQuantity !== null ? { sourceAvailableQuantity: availableQuantity } : {}),
  };
};

const fetchItemsByIds = async (
  storeId: string,
  itemIds: string[]
): Promise<MercadoLivreCatalogPreviewItem[]> => {
  if (!itemIds.length) return [];
  const attributes = [
    'id',
    'title',
    'price',
    'available_quantity',
    'status',
    'thumbnail',
    'category_id',
    'seller_custom_field',
  ].join(',');
  const payload = await mercadoLivreGetJson<MultigetEntry[]>(
    storeId,
    `/items?ids=${encodeURIComponent(itemIds.join(','))}&attributes=${encodeURIComponent(attributes)}`
  );
  if (!Array.isArray(payload)) throw new Error('MERCADO_LIVRE_ITEMS_RESPONSE_INVALID');
  return payload
    .map(entry => parseItemBody(entry?.body ?? entry))
    .filter((item): item is MercadoLivreCatalogPreviewItem => Boolean(item));
};

const resolveConnection = async (storeId: string) => {
  const secret = await getValidMercadoLivreAccessToken(storeId);
  const connectionId = `mercado_livre__${secret.externalAccountId}`;
  const connection = await getStoreConnectionRegistryRecord({ storeId, connectionId });
  if (!connection || connection.provider !== 'mercado_livre' || connection.status !== 'connected') {
    throw new Error('MERCADO_LIVRE_CONNECTION_INVALID');
  }
  return connection;
};

export const previewMercadoLivreCatalog = async (input: {
  storeId: string;
  limit?: number;
}): Promise<{ connectionId: string; total: number; items: MercadoLivreCatalogPreviewItem[] }> => {
  const storeId = input.storeId.trim();
  const connection = await resolveConnection(storeId);
  const requestedLimit = Number(input.limit ?? 50);
  const limit = Number.isSafeInteger(requestedLimit)
    ? Math.max(1, Math.min(100, requestedLimit))
    : 50;
  const search = await mercadoLivreGetJson<SearchResponse>(
    storeId,
    `/users/${encodeURIComponent(connection.externalAccountId)}/items/search?limit=${limit}&offset=0`
  );
  const ids = Array.isArray(search.results)
    ? search.results.map(clean).filter(Boolean).slice(0, limit)
    : [];
  const items: MercadoLivreCatalogPreviewItem[] = [];
  for (let index = 0; index < ids.length; index += 20) {
    items.push(...await fetchItemsByIds(storeId, ids.slice(index, index + 20)));
  }
  return {
    connectionId: connection.id,
    total: Math.max(0, Number(search.paging?.total) || ids.length),
    items,
  };
};

const draftId = (externalId: string): string =>
  `mercado_livre__${externalId.replace(/[^A-Za-z0-9_-]/g, '_')}`;

export const confirmMercadoLivreCatalogImport = async (input: {
  storeId: string;
  itemIds: unknown;
}): Promise<{ imported: number; drafts: MercadoLivreCatalogImportDraft[] }> => {
  const storeId = input.storeId.trim();
  const connection = await resolveConnection(storeId);
  if (!Array.isArray(input.itemIds)) throw new Error('MERCADO_LIVRE_IMPORT_SELECTION_REQUIRED');
  const itemIds = Array.from(new Set(input.itemIds.map(clean).filter(Boolean)));
  if (!itemIds.length || itemIds.length > 50) {
    throw new Error('MERCADO_LIVRE_IMPORT_SELECTION_INVALID');
  }

  // Re-fetch selected items server-side. The client preview is never import authority.
  const sourceItems: MercadoLivreCatalogPreviewItem[] = [];
  for (let index = 0; index < itemIds.length; index += 20) {
    sourceItems.push(...await fetchItemsByIds(storeId, itemIds.slice(index, index + 20)));
  }
  const returnedIds = new Set(sourceItems.map(item => item.externalId));
  if (itemIds.some(id => !returnedIds.has(id))) {
    throw new Error('MERCADO_LIVRE_IMPORT_SELECTION_NOT_FOUND');
  }

  const importedAt = new Date().toISOString();
  const drafts = sourceItems.map(item => ({
    id: draftId(item.externalId),
    storeId,
    source: 'mercado_livre' as const,
    status: 'draft' as const,
    title: item.title,
    price: item.price,
    categoryId: item.categoryId,
    ...(item.thumbnail ? { thumbnail: item.thumbnail } : {}),
    ...(item.sellerSku ? { sellerSku: item.sellerSku } : {}),
    ...(item.sourceAvailableQuantity !== undefined
      ? { sourceAvailableQuantity: item.sourceAvailableQuantity }
      : {}),
    provenance: buildMercadoLivreImportProvenance({
      externalId: item.externalId,
      connectionId: connection.id,
      importedAt,
    }),
    createdAt: importedAt,
    updatedAt: importedAt,
  }));

  const batch = adminDb.batch();
  for (const draft of drafts) {
    const reference = adminDb.doc(`stores/${storeId}/catalogImportDrafts/${draft.id}`);
    batch.set(reference, {
      ...draft,
      serverUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  await batch.commit();
  return { imported: drafts.length, drafts };
};
