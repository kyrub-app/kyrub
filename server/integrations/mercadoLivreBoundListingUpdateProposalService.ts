import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { mercadoLivreGetJson } from './mercadoLivreOauthService.js';
import { getStoreConnectionRegistryRecord } from './storeConnectionRegistry.js';

type UpdatableField = 'name' | 'price';

interface BindingRecord {
  id: string;
  storeId: string;
  provider: 'mercado_livre';
  connectionId: string;
  externalItemId: string;
  canonicalStoreId: string;
  canonicalProductId: string;
  status: 'active';
  canonicalBaselineHash: string;
}

interface CanonicalState {
  name: string;
  price: number;
  stock: number;
  category: string;
  image: string;
}

interface BaselineRecord {
  id: string;
  bindingId: string;
  canonicalStoreId: string;
  canonicalProductId: string;
  baselineHash: string;
  baseline: CanonicalState;
}

interface ProviderItem {
  id?: unknown;
  seller_id?: unknown;
  title?: unknown;
  price?: unknown;
  available_quantity?: unknown;
  category_id?: unknown;
  status?: unknown;
}

export interface MercadoLivreBoundListingUpdateProposal {
  schemaVersion: 2;
  id: string;
  storeId: string;
  provider: 'mercado_livre';
  connectionId: string;
  bindingId: string;
  externalItemId: string;
  canonicalStoreId: string;
  canonicalProductId: string;
  authority: 'canonical_kyrub_and_provider_api_refetch';
  status: 'review_required' | 'no_changes';
  executionStatus: 'not_authorized';
  canonicalBaselineHash: string;
  canonicalTargetHash: string;
  providerObservedHash: string;
  createdAt: string;
  baseline: CanonicalState;
  currentCanonical: CanonicalState;
  observedExternal: {
    name: string;
    price: number;
    availableQuantity: number | null;
    categoryId: string;
    status: string;
  };
  proposedChanges: Partial<Record<UpdatableField, string | number>>;
  changedFields: UpdatableField[];
  protectedFields: ['stock', 'category', 'image', 'publicationStatus'];
}

const clean = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const finiteNonNegative = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const integerNonNegative = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const canonicalHash = (state: CanonicalState): string => sha256(JSON.stringify({ ...state, isService: false }));
const providerHash = (state: { name: string; price: number; availableQuantity: number | null; categoryId: string; status: string }): string =>
  sha256(JSON.stringify(state));

const assertBinding = (storeId: string, bindingId: string, value: unknown): BindingRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_NOT_FOUND');
  const record = value as Record<string, unknown>;
  if (
    clean(record.id, 160) !== bindingId || clean(record.storeId, 160) !== storeId || record.provider !== 'mercado_livre' ||
    record.status !== 'active' || !clean(record.connectionId, 200) || !clean(record.externalItemId, 160) ||
    !clean(record.canonicalStoreId, 160) || !clean(record.canonicalProductId, 160) || !clean(record.canonicalBaselineHash, 80)
  ) throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_CONFLICT');
  return record as unknown as BindingRecord;
};

const parseCanonicalState = (expectedStoreId: string, expectedProductId: string, value: unknown): CanonicalState => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_BOUND_CANONICAL_PRODUCT_NOT_FOUND');
  const record = value as Record<string, unknown>;
  const name = clean(record.name, 120);
  const price = finiteNonNegative(record.price);
  const stock = integerNonNegative(record.stock);
  const category = clean(record.category, 160);
  if (
    clean(record.id, 160) !== expectedProductId || clean(record.storeId, 160) !== expectedStoreId ||
    !name || price === null || stock === null || !category || record.isService !== false
  ) throw new Error('MERCADO_LIVRE_BOUND_CANONICAL_PRODUCT_INVALID');
  return { name, price, stock, category, image: clean(record.image, 2_000) };
};

const assertBaseline = (binding: BindingRecord, value: unknown): BaselineRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_BASELINE_REQUIRED');
  const record = value as Record<string, unknown>;
  const baseline = parseCanonicalState(binding.canonicalStoreId, binding.canonicalProductId, {
    id: binding.canonicalProductId,
    storeId: binding.canonicalStoreId,
    ...(record.baseline && typeof record.baseline === 'object' && !Array.isArray(record.baseline) ? record.baseline as Record<string, unknown> : {}),
    isService: false,
  });
  if (
    clean(record.id, 160) !== binding.id || clean(record.bindingId, 160) !== binding.id ||
    clean(record.canonicalStoreId, 160) !== binding.canonicalStoreId || clean(record.canonicalProductId, 160) !== binding.canonicalProductId ||
    clean(record.baselineHash, 80) !== binding.canonicalBaselineHash || canonicalHash(baseline) !== binding.canonicalBaselineHash
  ) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_BASELINE_CONFLICT');
  return { ...(record as unknown as BaselineRecord), baseline };
};

const observedProviderState = (binding: BindingRecord, externalAccountId: string, value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_ITEM_RESPONSE_INVALID');
  const item = value as ProviderItem;
  const id = clean(item.id, 160);
  const sellerId = clean(item.seller_id, 160);
  const name = clean(item.title, 120);
  const price = finiteNonNegative(item.price);
  if (id !== binding.externalItemId || sellerId !== externalAccountId || !name || price === null) {
    throw new Error('MERCADO_LIVRE_BOUND_LISTING_IDENTITY_MISMATCH');
  }
  return {
    name,
    price,
    availableQuantity: finiteNonNegative(item.available_quantity),
    categoryId: clean(item.category_id, 160),
    status: clean(item.status, 80),
  };
};

const outboundChanges = (baseline: CanonicalState, current: CanonicalState, observed: { name: string; price: number }): {
  changedFields: UpdatableField[];
  proposedChanges: Partial<Record<UpdatableField, string | number>>;
} => {
  const changedFields: UpdatableField[] = [];
  const proposedChanges: Partial<Record<UpdatableField, string | number>> = {};
  for (const field of ['name', 'price'] as UpdatableField[]) {
    const localChanged = current[field] !== baseline[field];
    const providerChanged = observed[field] !== baseline[field];
    if (localChanged && providerChanged && current[field] !== observed[field]) {
      throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_FIELD_CONFLICT');
    }
    if (localChanged && current[field] !== observed[field]) {
      changedFields.push(field);
      proposedChanges[field] = current[field];
    }
  }
  return { changedFields, proposedChanges };
};

export const proposeMercadoLivreBoundListingUpdate = async (input: {
  storeId: string;
  bindingId: string;
  proposedByUserId: string;
}): Promise<MercadoLivreBoundListingUpdateProposal> => {
  const storeId = input.storeId.trim();
  const bindingId = input.bindingId.trim();
  const proposedByUserId = input.proposedByUserId.trim();
  if (!storeId || !bindingId || proposedByUserId !== storeId) throw new Error('MERCADO_LIVRE_BOUND_LISTING_UPDATE_TARGET_INVALID');

  const bindingRef = adminDb.doc(`stores/${storeId}/externalCatalogBindings/${bindingId}`);
  const baselineRef = adminDb.doc(`stores/${storeId}/externalCatalogBindingBaselines/${bindingId}`);
  const [bindingDoc, baselineDoc] = await Promise.all([bindingRef.get(), baselineRef.get()]);
  if (!bindingDoc.exists) throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_NOT_FOUND');
  const binding = assertBinding(storeId, bindingId, bindingDoc.data());
  const baseline = assertBaseline(binding, baselineDoc.data()).baseline;
  const connection = await getStoreConnectionRegistryRecord({ storeId, connectionId: binding.connectionId });
  if (!connection || connection.provider !== 'mercado_livre' || connection.status !== 'connected' || connection.syncAuthority !== 'manual_review') {
    throw new Error('MERCADO_LIVRE_CONNECTION_INVALID');
  }

  const canonicalRef = adminDb.doc(`stores/${binding.canonicalStoreId}/products/${binding.canonicalProductId}`);
  const canonicalDoc = await canonicalRef.get();
  if (!canonicalDoc.exists) throw new Error('MERCADO_LIVRE_BOUND_CANONICAL_PRODUCT_NOT_FOUND');
  const canonical = parseCanonicalState(binding.canonicalStoreId, binding.canonicalProductId, canonicalDoc.data());
  const canonicalTargetHash = canonicalHash(canonical);

  const providerRaw = await mercadoLivreGetJson<unknown>(storeId, `/items/${encodeURIComponent(binding.externalItemId)}`);
  const observed = observedProviderState(binding, connection.externalAccountId, providerRaw);
  const { changedFields, proposedChanges } = outboundChanges(baseline, canonical, observed);

  const providerObservedHash = providerHash(observed);
  const proposalId = `mlupd_${sha256([storeId, bindingId, binding.canonicalBaselineHash, canonicalTargetHash, providerObservedHash].join(':')).slice(0, 32)}`;
  const proposalRef = adminDb.doc(`stores/${storeId}/catalogOutboundUpdateProposals/${proposalId}`);
  const existing = await proposalRef.get();
  if (existing.exists) return existing.data() as MercadoLivreBoundListingUpdateProposal;

  const createdAt = new Date().toISOString();
  const proposal: MercadoLivreBoundListingUpdateProposal = {
    schemaVersion: 2,
    id: proposalId,
    storeId,
    provider: 'mercado_livre',
    connectionId: binding.connectionId,
    bindingId,
    externalItemId: binding.externalItemId,
    canonicalStoreId: binding.canonicalStoreId,
    canonicalProductId: binding.canonicalProductId,
    authority: 'canonical_kyrub_and_provider_api_refetch',
    status: changedFields.length ? 'review_required' : 'no_changes',
    executionStatus: 'not_authorized',
    canonicalBaselineHash: binding.canonicalBaselineHash,
    canonicalTargetHash,
    providerObservedHash,
    createdAt,
    baseline,
    currentCanonical: canonical,
    observedExternal: observed,
    proposedChanges,
    changedFields,
    protectedFields: ['stock', 'category', 'image', 'publicationStatus'],
  };
  await proposalRef.create({ ...proposal, proposedByUserId, serverCreatedAt: FieldValue.serverTimestamp() });
  return proposal;
};

export const listMercadoLivreBoundListingUpdateProposals = async (input: { storeId: string; limit?: number }) => {
  const storeId = input.storeId.trim();
  if (!storeId) throw new Error('STORE_CONNECTION_STORE_REQUIRED');
  const requested = Number(input.limit ?? 50);
  const limit = Number.isSafeInteger(requested) ? Math.max(1, Math.min(100, requested)) : 50;
  const snapshot = await adminDb.collection(`stores/${storeId}/catalogOutboundUpdateProposals`).limit(limit).get();
  const items = snapshot.docs.map(doc => doc.data() as MercadoLivreBoundListingUpdateProposal)
    .filter(item => item.provider === 'mercado_livre' && item.storeId === storeId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { items };
};
