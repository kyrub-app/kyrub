import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { mercadoLivreGetJson } from './mercadoLivreOauthService.js';
import { getStoreConnectionRegistryRecord } from './storeConnectionRegistry.js';

interface ProposalRecord {
  schemaVersion: 2;
  id: string;
  storeId: string;
  provider: 'mercado_livre';
  executionStatus: 'published';
  publicationExecutionId: string;
  externalCatalogBindingId: string;
}

interface ExecutionRecord {
  schemaVersion: 2;
  id: string;
  proposalId: string;
  storeId: string;
  provider: 'mercado_livre';
  connectionId: string;
  canonicalStoreId: string;
  canonicalProductId: string;
  providerPublicationModel: 'legacy_items' | 'user_products';
  providerStockAuthority: 'item_available_quantity';
  status: 'published';
  externalItemId: string;
  externalUserProductId?: string;
  bindingId: string;
  reconciliationStatus?: 'reconciled';
}

interface BindingRecord {
  schemaVersion: 2;
  id: string;
  storeId: string;
  provider: 'mercado_livre';
  connectionId: string;
  externalItemId: string;
  externalUserProductId?: string;
  canonicalStoreId: string;
  canonicalProductId: string;
  status: 'active';
  reconciliationStatus: 'reconciled';
}

interface CanonicalState {
  name: string;
  price: number;
  stock: number;
  category: string;
  image: string;
}

interface ProviderState {
  title: string;
  price: number | null;
  availableQuantity: number | null;
  categoryId: string;
  status: string;
}

export interface MercadoLivreSyncChange {
  field: string;
  before: string | number | null;
  after: string | number | null;
}

export type MercadoLivreSyncInspectionClassification =
  | 'in_sync'
  | 'canonical_changed'
  | 'provider_changed'
  | 'conflict';

export interface MercadoLivrePostPublicationSyncInspectionResult {
  proposalId: string;
  executionId: string;
  bindingId: string;
  externalItemId: string;
  externalUserProductId?: string;
  classification: MercadoLivreSyncInspectionClassification;
  canonicalChanges: MercadoLivreSyncChange[];
  providerChanges: MercadoLivreSyncChange[];
  overlappingFields: string[];
  providerStatus: string;
  inspectedAt: string;
}

const clean = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const safeId = (value: string): boolean => /^[a-zA-Z0-9_-]{1,128}$/.test(value);

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

const semantic = (value: unknown): string => clean(value, 600)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('pt-BR')
  .replace(/[^a-z0-9]+/g, '');

const sameNumber = (left: number | null, right: number | null): boolean =>
  left === null || right === null ? left === right : Math.abs(left - right) < 0.000001;

const assertProposal = (storeId: string, proposalId: string, value: unknown): ProposalRecord => {
  const proposal = record(value);
  if (
    proposal.schemaVersion !== 2 ||
    clean(proposal.id, 128) !== proposalId ||
    clean(proposal.storeId, 128) !== storeId ||
    proposal.provider !== 'mercado_livre' ||
    proposal.executionStatus !== 'published' ||
    !safeId(clean(proposal.publicationExecutionId, 128)) ||
    !safeId(clean(proposal.externalCatalogBindingId, 128))
  ) throw new Error('MERCADO_LIVRE_SYNC_INSPECTION_PROPOSAL_INVALID');
  return proposal as unknown as ProposalRecord;
};

const assertExecution = (proposal: ProposalRecord, value: unknown): ExecutionRecord => {
  const execution = record(value);
  if (
    execution.schemaVersion !== 2 ||
    clean(execution.id, 128) !== proposal.publicationExecutionId ||
    clean(execution.proposalId, 128) !== proposal.id ||
    clean(execution.storeId, 128) !== proposal.storeId ||
    execution.provider !== 'mercado_livre' ||
    execution.status !== 'published' ||
    clean(execution.bindingId, 128) !== proposal.externalCatalogBindingId ||
    !clean(execution.connectionId, 200) ||
    !safeId(clean(execution.canonicalStoreId, 128)) ||
    !safeId(clean(execution.canonicalProductId, 128)) ||
    !safeId(clean(execution.externalItemId, 128)) ||
    (execution.providerPublicationModel !== 'legacy_items' && execution.providerPublicationModel !== 'user_products') ||
    execution.providerStockAuthority !== 'item_available_quantity' ||
    execution.reconciliationStatus !== 'reconciled' ||
    (execution.providerPublicationModel === 'user_products' && !safeId(clean(execution.externalUserProductId, 128)))
  ) throw new Error('MERCADO_LIVRE_SYNC_INSPECTION_EXECUTION_INVALID');
  return execution as unknown as ExecutionRecord;
};

const assertBinding = (execution: ExecutionRecord, value: unknown): BindingRecord => {
  const binding = record(value);
  if (
    binding.schemaVersion !== 2 ||
    clean(binding.id, 128) !== execution.bindingId ||
    clean(binding.storeId, 128) !== execution.storeId ||
    binding.provider !== 'mercado_livre' ||
    binding.status !== 'active' ||
    binding.reconciliationStatus !== 'reconciled' ||
    clean(binding.connectionId, 200) !== execution.connectionId ||
    clean(binding.externalItemId, 128) !== execution.externalItemId ||
    clean(binding.canonicalStoreId, 128) !== execution.canonicalStoreId ||
    clean(binding.canonicalProductId, 128) !== execution.canonicalProductId ||
    (execution.providerPublicationModel === 'user_products' &&
      clean(binding.externalUserProductId, 128) !== clean(execution.externalUserProductId, 128))
  ) throw new Error('MERCADO_LIVRE_SYNC_INSPECTION_BINDING_INVALID');
  return binding as unknown as BindingRecord;
};

const canonicalState = (value: unknown): CanonicalState => {
  const source = record(value);
  const name = clean(source.name, 120);
  const price = finiteNonNegative(source.price);
  const stock = integerNonNegative(source.stock);
  const category = clean(source.category, 120);
  if (!name || price === null || stock === null || !category || source.isService !== false) {
    throw new Error('MERCADO_LIVRE_SYNC_INSPECTION_CANONICAL_PRODUCT_INVALID');
  }
  return { name, price, stock, category, image: clean(source.image, 2_000) };
};

const baselineCanonicalState = (value: unknown, execution: ExecutionRecord): CanonicalState => {
  const source = record(value);
  if (
    source.schemaVersion !== 1 ||
    clean(source.bindingId, 128) !== execution.bindingId ||
    clean(source.canonicalStoreId, 128) !== execution.canonicalStoreId ||
    clean(source.canonicalProductId, 128) !== execution.canonicalProductId ||
    source.authority !== 'post_publication_canonical_snapshot'
  ) throw new Error('MERCADO_LIVRE_SYNC_INSPECTION_BASELINE_INVALID');
  return canonicalState(source.baseline);
};

const providerState = (value: unknown, execution: ExecutionRecord): ProviderState => {
  const source = record(value);
  if (clean(source.id, 128) !== execution.externalItemId) {
    throw new Error('MERCADO_LIVRE_SYNC_INSPECTION_PROVIDER_IDENTITY_MISMATCH');
  }
  if (
    execution.providerPublicationModel === 'user_products' &&
    clean(source.user_product_id, 128) !== clean(execution.externalUserProductId, 128)
  ) throw new Error('MERCADO_LIVRE_SYNC_INSPECTION_PROVIDER_IDENTITY_MISMATCH');
  const title = clean(source.title, 120);
  if (!title) throw new Error('MERCADO_LIVRE_SYNC_INSPECTION_PROVIDER_ITEM_INVALID');
  return {
    title,
    price: finiteNonNegative(source.price),
    availableQuantity: finiteNonNegative(source.available_quantity),
    categoryId: clean(source.category_id, 128),
    status: clean(source.status, 80),
  };
};

const baselineProviderState = (value: unknown, execution: ExecutionRecord): ProviderState => {
  const snapshot = record(value);
  if (
    clean(snapshot.externalItemId, 128) !== execution.externalItemId ||
    snapshot.authority !== 'provider_api_refetch' ||
    clean(snapshot.sourceExecutionId, 128) !== execution.id
  ) throw new Error('MERCADO_LIVRE_SYNC_INSPECTION_PROVIDER_BASELINE_INVALID');
  return providerState(snapshot.item, execution);
};

const canonicalChanges = (before: CanonicalState, after: CanonicalState): MercadoLivreSyncChange[] => {
  const changes: MercadoLivreSyncChange[] = [];
  if (semantic(before.name) !== semantic(after.name)) changes.push({ field: 'name', before: before.name, after: after.name });
  if (!sameNumber(before.price, after.price)) changes.push({ field: 'price', before: before.price, after: after.price });
  if (before.stock !== after.stock) changes.push({ field: 'stock', before: before.stock, after: after.stock });
  if (semantic(before.category) !== semantic(after.category)) changes.push({ field: 'category', before: before.category, after: after.category });
  if (before.image !== after.image) changes.push({ field: 'image', before: before.image || null, after: after.image || null });
  return changes;
};

const providerChanges = (before: ProviderState, after: ProviderState): MercadoLivreSyncChange[] => {
  const changes: MercadoLivreSyncChange[] = [];
  if (semantic(before.title) !== semantic(after.title)) changes.push({ field: 'title', before: before.title, after: after.title });
  if (!sameNumber(before.price, after.price)) changes.push({ field: 'price', before: before.price, after: after.price });
  if (!sameNumber(before.availableQuantity, after.availableQuantity)) {
    changes.push({ field: 'available_quantity', before: before.availableQuantity, after: after.availableQuantity });
  }
  if (before.categoryId !== after.categoryId) changes.push({ field: 'category_id', before: before.categoryId || null, after: after.categoryId || null });
  return changes;
};

const overlappingFields = (
  canonical: MercadoLivreSyncChange[],
  provider: MercadoLivreSyncChange[]
): string[] => {
  const canonicalFields = new Set(canonical.map(change => change.field));
  const providerFields = new Set(provider.map(change => change.field));
  const overlaps: string[] = [];
  if (canonicalFields.has('price') && providerFields.has('price')) overlaps.push('price');
  if (canonicalFields.has('stock') && providerFields.has('available_quantity')) overlaps.push('stock');
  if (canonicalFields.has('name') && providerFields.has('title')) overlaps.push('name');
  return overlaps;
};

const classify = (
  canonical: MercadoLivreSyncChange[],
  provider: MercadoLivreSyncChange[],
  overlaps: string[]
): MercadoLivreSyncInspectionClassification => {
  if (canonical.length === 0 && provider.length === 0) return 'in_sync';
  if (overlaps.length > 0) return 'conflict';
  if (canonical.length > 0 && provider.length === 0) return 'canonical_changed';
  if (canonical.length === 0 && provider.length > 0) return 'provider_changed';
  return 'conflict';
};

export const inspectMercadoLivrePostPublicationSync = async (input: {
  storeId: string;
  proposalId: string;
  inspectedByUserId: string;
}): Promise<MercadoLivrePostPublicationSyncInspectionResult> => {
  const storeId = clean(input.storeId, 128);
  const proposalId = clean(input.proposalId, 128);
  const inspectedByUserId = clean(input.inspectedByUserId, 128);
  if (!safeId(storeId) || !safeId(proposalId) || inspectedByUserId !== storeId) {
    throw new Error('MERCADO_LIVRE_SYNC_INSPECTION_TARGET_INVALID');
  }

  const proposalRef = adminDb.doc(`stores/${storeId}/catalogOutboundPublicationProposals/${proposalId}`);
  const proposalDoc = await proposalRef.get();
  if (!proposalDoc.exists) throw new Error('MERCADO_LIVRE_SYNC_INSPECTION_PROPOSAL_NOT_FOUND');
  const proposal = assertProposal(storeId, proposalId, proposalDoc.data());

  const executionRef = adminDb.doc(`stores/${storeId}/catalogOutboundPublicationExecutions/${proposal.publicationExecutionId}`);
  const executionDoc = await executionRef.get();
  if (!executionDoc.exists) throw new Error('MERCADO_LIVRE_SYNC_INSPECTION_EXECUTION_NOT_FOUND');
  const execution = assertExecution(proposal, executionDoc.data());

  const bindingRef = adminDb.doc(`stores/${storeId}/externalCatalogBindings/${execution.bindingId}`);
  const baselineRef = adminDb.doc(`stores/${storeId}/externalCatalogBindingBaselines/${execution.bindingId}`);
  const initialSnapshotRef = adminDb.doc(`stores/${storeId}/externalCatalogSnapshots/${execution.id}__initial_snapshot`);
  const canonicalRef = adminDb.doc(`stores/${execution.canonicalStoreId}/products/${execution.canonicalProductId}`);
  const [bindingDoc, baselineDoc, initialSnapshotDoc, canonicalDoc] = await Promise.all([
    bindingRef.get(), baselineRef.get(), initialSnapshotRef.get(), canonicalRef.get(),
  ]);
  if (!bindingDoc.exists) throw new Error('MERCADO_LIVRE_SYNC_INSPECTION_BINDING_NOT_FOUND');
  if (!baselineDoc.exists) throw new Error('MERCADO_LIVRE_SYNC_INSPECTION_BASELINE_NOT_FOUND');
  if (!initialSnapshotDoc.exists) throw new Error('MERCADO_LIVRE_SYNC_INSPECTION_PROVIDER_BASELINE_NOT_FOUND');
  if (!canonicalDoc.exists) throw new Error('MERCADO_LIVRE_SYNC_INSPECTION_CANONICAL_PRODUCT_NOT_FOUND');
  assertBinding(execution, bindingDoc.data());

  const connection = await getStoreConnectionRegistryRecord({ storeId, connectionId: execution.connectionId });
  if (!connection || connection.provider !== 'mercado_livre' || connection.status !== 'connected' || connection.syncAuthority !== 'manual_review') {
    throw new Error('MERCADO_LIVRE_SYNC_INSPECTION_CONNECTION_INVALID');
  }

  const baselineCanonical = baselineCanonicalState(baselineDoc.data(), execution);
  const currentCanonical = canonicalState(canonicalDoc.data());
  const baselineProvider = baselineProviderState(initialSnapshotDoc.data(), execution);
  const fetchedProvider = await mercadoLivreGetJson<unknown>(
    storeId,
    `/items/${encodeURIComponent(execution.externalItemId)}`
  );
  const currentProvider = providerState(fetchedProvider, execution);

  const canonicalDiff = canonicalChanges(baselineCanonical, currentCanonical);
  const providerDiff = providerChanges(baselineProvider, currentProvider);
  const overlaps = overlappingFields(canonicalDiff, providerDiff);
  const classification = classify(canonicalDiff, providerDiff, overlaps);
  const inspectedAt = new Date().toISOString();

  const inspectionRef = adminDb.doc(`stores/${storeId}/catalogOutboundSyncInspections/${execution.bindingId}`);
  await inspectionRef.set({
    schemaVersion: 1,
    id: execution.bindingId,
    storeId,
    provider: 'mercado_livre',
    proposalId,
    executionId: execution.id,
    bindingId: execution.bindingId,
    connectionId: execution.connectionId,
    canonicalStoreId: execution.canonicalStoreId,
    canonicalProductId: execution.canonicalProductId,
    externalItemId: execution.externalItemId,
    ...(execution.externalUserProductId ? { externalUserProductId: execution.externalUserProductId } : {}),
    classification,
    canonicalChanges: canonicalDiff,
    providerChanges: providerDiff,
    overlappingFields: overlaps,
    providerStatus: currentProvider.status,
    authority: 'canonical_baseline_plus_provider_api_readback',
    syncAuthority: 'manual_review',
    inspectedByUserId,
    inspectedAt,
    serverInspectedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    proposalId,
    executionId: execution.id,
    bindingId: execution.bindingId,
    externalItemId: execution.externalItemId,
    ...(execution.externalUserProductId ? { externalUserProductId: execution.externalUserProductId } : {}),
    classification,
    canonicalChanges: canonicalDiff,
    providerChanges: providerDiff,
    overlappingFields: overlaps,
    providerStatus: currentProvider.status,
    inspectedAt,
  };
};
