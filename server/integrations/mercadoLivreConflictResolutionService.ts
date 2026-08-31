import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type { MercadoLivreExternalCatalogSnapshot } from './mercadoLivreNotificationProcessor.js';

type BaselineField = 'name' | 'price' | 'stock' | 'category' | 'image';
type ResolvableField = 'name' | 'price';
type ResolutionChoice = 'kyrub' | 'mercado_livre';

interface ProposalRecord {
  id: string;
  provider: 'mercado_livre';
  storeId: string;
  connectionId: string;
  externalItemId: string;
  snapshotId: string;
  status: 'approved';
  authority: 'provider_api_refetch';
  decisionAuthority: 'store_owner_review';
  decidedByUserId: string;
  applyStatus: 'applied';
  canonicalApplyStatus?: 'applied';
}

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
  schemaVersion: 1;
  id: string;
  storeId: string;
  bindingId: string;
  canonicalStoreId: string;
  canonicalProductId: string;
  baselineHash: string;
  baseline: CanonicalState;
}

export interface MercadoLivreConflictResolutionItem {
  proposalId: string;
  bindingId: string;
  canonicalProductId: string;
  canonicalStoreId: string;
  baselineStatus: 'conflict' | 'baseline_unavailable';
  baseline: CanonicalState | null;
  current: CanonicalState;
  incoming: { name: string; price: number | null };
  localChangedFields: BaselineField[];
  incomingChangedFields: ResolvableField[];
  resolvableFields: ResolvableField[];
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

const baselineHash = (state: CanonicalState): string => createHash('sha256')
  .update(JSON.stringify({ ...state, isService: false }))
  .digest('hex');

const bindingIdFor = (storeId: string, connectionId: string, externalItemId: string): string => {
  const identity = createHash('sha256')
    .update([storeId, 'mercado_livre', connectionId, externalItemId].join(':'))
    .digest('hex');
  return `mlbind_${identity.slice(0, 32)}`;
};

const assertProposal = (storeId: string, value: unknown): ProposalRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_CONFLICT_PROPOSAL_INVALID');
  const record = value as Record<string, unknown>;
  if (
    record.provider !== 'mercado_livre' || clean(record.storeId, 160) !== storeId || record.status !== 'approved' ||
    record.authority !== 'provider_api_refetch' || record.decisionAuthority !== 'store_owner_review' ||
    clean(record.decidedByUserId, 160) !== storeId || record.applyStatus !== 'applied' ||
    !clean(record.id, 240) || !clean(record.connectionId, 200) || !clean(record.externalItemId, 160) || !clean(record.snapshotId, 240)
  ) throw new Error('MERCADO_LIVRE_CONFLICT_PROPOSAL_INVALID');
  return record as unknown as ProposalRecord;
};

const assertBinding = (storeId: string, proposal: ProposalRecord, value: unknown): BindingRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_NOT_FOUND');
  const record = value as Record<string, unknown>;
  const expectedId = bindingIdFor(storeId, proposal.connectionId, proposal.externalItemId);
  if (
    clean(record.id, 160) !== expectedId || clean(record.storeId, 160) !== storeId || record.provider !== 'mercado_livre' ||
    clean(record.connectionId, 200) !== proposal.connectionId || clean(record.externalItemId, 160) !== proposal.externalItemId ||
    record.status !== 'active' || !clean(record.canonicalStoreId, 160) || !clean(record.canonicalProductId, 160) || !clean(record.canonicalBaselineHash, 80)
  ) throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_CONFLICT');
  return record as unknown as BindingRecord;
};

const canonicalState = (binding: BindingRecord, value: unknown): CanonicalState => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_BOUND_CANONICAL_PRODUCT_NOT_FOUND');
  const record = value as Record<string, unknown>;
  const price = finiteNonNegative(record.price);
  const stock = integerNonNegative(record.stock);
  if (clean(record.id, 160) !== binding.canonicalProductId || clean(record.storeId, 160) !== binding.canonicalStoreId ||
      !clean(record.name, 120) || price === null || stock === null || !clean(record.category, 120) || record.isService !== false) {
    throw new Error('MERCADO_LIVRE_BOUND_CANONICAL_PRODUCT_INVALID');
  }
  return { name: clean(record.name, 120), price, stock, category: clean(record.category, 120), image: clean(record.image, 2_000) };
};

const assertSnapshot = (storeId: string, proposal: ProposalRecord, value: unknown): MercadoLivreExternalCatalogSnapshot => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_EXTERNAL_SNAPSHOT_INVALID');
  const snapshot = value as MercadoLivreExternalCatalogSnapshot;
  if (snapshot.provider !== 'mercado_livre' || snapshot.storeId !== storeId || snapshot.id !== proposal.snapshotId ||
      snapshot.connectionId !== proposal.connectionId || snapshot.externalItemId !== proposal.externalItemId || snapshot.authority !== 'provider_api_refetch') {
    throw new Error('MERCADO_LIVRE_EXTERNAL_SNAPSHOT_INVALID');
  }
  return snapshot;
};

const assertBaseline = (binding: BindingRecord, value: unknown): BaselineRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MERCADO_LIVRE_CONFLICT_BASELINE_INVALID');
  const record = value as Record<string, unknown>;
  const baseline = record.baseline && typeof record.baseline === 'object' && !Array.isArray(record.baseline)
    ? record.baseline as Record<string, unknown> : null;
  const parsed: CanonicalState | null = baseline ? {
    name: clean(baseline.name, 120),
    price: finiteNonNegative(baseline.price) ?? -1,
    stock: integerNonNegative(baseline.stock) ?? -1,
    category: clean(baseline.category, 120),
    image: clean(baseline.image, 2_000),
  } : null;
  if (!parsed || !parsed.name || parsed.price < 0 || parsed.stock < 0 || !parsed.category ||
      clean(record.id, 160) !== binding.id || clean(record.bindingId, 160) !== binding.id ||
      clean(record.canonicalStoreId, 160) !== binding.canonicalStoreId || clean(record.canonicalProductId, 160) !== binding.canonicalProductId ||
      clean(record.baselineHash, 80) !== binding.canonicalBaselineHash || baselineHash(parsed) !== binding.canonicalBaselineHash) {
    throw new Error('MERCADO_LIVRE_CONFLICT_BASELINE_INVALID');
  }
  return { ...(record as unknown as BaselineRecord), baseline: parsed };
};

const changedFromBaseline = (baseline: CanonicalState, current: CanonicalState): BaselineField[] =>
  (['name', 'price', 'stock', 'category', 'image'] as BaselineField[]).filter(field => baseline[field] !== current[field]);

const incomingChanges = (baseline: CanonicalState, snapshot: MercadoLivreExternalCatalogSnapshot): ResolvableField[] => {
  const fields: ResolvableField[] = [];
  const incomingName = clean(snapshot.item.title, 120);
  const incomingPrice = finiteNonNegative(snapshot.item.price);
  if (incomingName && incomingName !== baseline.name) fields.push('name');
  if (incomingPrice !== null && incomingPrice !== baseline.price) fields.push('price');
  return fields;
};

export const captureMercadoLivreBindingBaseline = async (input: {
  storeId: string;
  bindingId: string;
  capturedByUserId: string;
}): Promise<{ bindingId: string; captured: boolean }> => {
  const storeId = input.storeId.trim();
  const bindingId = input.bindingId.trim();
  const capturedByUserId = input.capturedByUserId.trim();
  if (!storeId || !bindingId || !capturedByUserId || capturedByUserId !== storeId) throw new Error('MERCADO_LIVRE_CONFLICT_BASELINE_TARGET_INVALID');
  const bindingRef = adminDb.doc(`stores/${storeId}/externalCatalogBindings/${bindingId}`);
  const baselineRef = adminDb.doc(`stores/${storeId}/externalCatalogBindingBaselines/${bindingId}`);
  let captured = false;
  await adminDb.runTransaction(async transaction => {
    const [bindingDoc, baselineDoc] = await Promise.all([transaction.get(bindingRef), transaction.get(baselineRef)]);
    if (!bindingDoc.exists) throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_NOT_FOUND');
    const raw = bindingDoc.data() as Record<string, unknown>;
    const binding: BindingRecord = {
      id: clean(raw.id, 160), storeId: clean(raw.storeId, 160), provider: raw.provider as 'mercado_livre',
      connectionId: clean(raw.connectionId, 200), externalItemId: clean(raw.externalItemId, 160),
      canonicalStoreId: clean(raw.canonicalStoreId, 160), canonicalProductId: clean(raw.canonicalProductId, 160),
      status: raw.status as 'active', canonicalBaselineHash: clean(raw.canonicalBaselineHash, 80),
    };
    if (binding.id !== bindingId || binding.storeId !== storeId || binding.provider !== 'mercado_livre' || binding.status !== 'active' ||
        !binding.canonicalStoreId || !binding.canonicalProductId || !binding.canonicalBaselineHash) throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_CONFLICT');
    if (baselineDoc.exists) { assertBaseline(binding, baselineDoc.data()); return; }
    const canonicalRef = adminDb.doc(`stores/${binding.canonicalStoreId}/products/${binding.canonicalProductId}`);
    const canonicalDoc = await transaction.get(canonicalRef);
    if (!canonicalDoc.exists) throw new Error('MERCADO_LIVRE_BOUND_CANONICAL_PRODUCT_NOT_FOUND');
    const state = canonicalState(binding, canonicalDoc.data());
    if (baselineHash(state) !== binding.canonicalBaselineHash) throw new Error('MERCADO_LIVRE_CONFLICT_BASELINE_CAPTURE_STALE');
    transaction.create(baselineRef, {
      schemaVersion: 1, id: bindingId, storeId, bindingId, canonicalStoreId: binding.canonicalStoreId,
      canonicalProductId: binding.canonicalProductId, baselineHash: binding.canonicalBaselineHash, baseline: state,
      authority: 'canonical_hash_verified_snapshot', capturedByUserId, capturedAt: new Date().toISOString(), serverCreatedAt: FieldValue.serverTimestamp(),
    });
    captured = true;
  });
  return { bindingId, captured };
};

export const listMercadoLivreConflictResolutionQueue = async (input: { storeId: string; limit?: number }): Promise<{ items: MercadoLivreConflictResolutionItem[] }> => {
  const storeId = input.storeId.trim();
  if (!storeId) throw new Error('STORE_CONNECTION_STORE_REQUIRED');
  const requested = Number(input.limit ?? 50);
  const limit = Number.isSafeInteger(requested) ? Math.max(1, Math.min(100, requested)) : 50;
  const proposals = await adminDb.collection(`stores/${storeId}/catalogSyncProposals`)
    .where('provider', '==', 'mercado_livre').where('status', '==', 'approved').limit(limit).get();
  const items: MercadoLivreConflictResolutionItem[] = [];
  for (const doc of proposals.docs) {
    let proposal: ProposalRecord;
    try { proposal = assertProposal(storeId, doc.data()); } catch { continue; }
    if (proposal.canonicalApplyStatus === 'applied') continue;
    const bindingId = bindingIdFor(storeId, proposal.connectionId, proposal.externalItemId);
    const [bindingDoc, snapshotDoc] = await Promise.all([
      adminDb.doc(`stores/${storeId}/externalCatalogBindings/${bindingId}`).get(),
      adminDb.doc(`stores/${storeId}/externalCatalogSnapshots/${proposal.snapshotId}`).get(),
    ]);
    if (!bindingDoc.exists || !snapshotDoc.exists) continue;
    const binding = assertBinding(storeId, proposal, bindingDoc.data());
    const snapshot = assertSnapshot(storeId, proposal, snapshotDoc.data());
    const canonicalDoc = await adminDb.doc(`stores/${binding.canonicalStoreId}/products/${binding.canonicalProductId}`).get();
    if (!canonicalDoc.exists) continue;
    const current = canonicalState(binding, canonicalDoc.data());
    if (baselineHash(current) === binding.canonicalBaselineHash) continue;
    const baselineDoc = await adminDb.doc(`stores/${storeId}/externalCatalogBindingBaselines/${bindingId}`).get();
    if (!baselineDoc.exists) {
      items.push({ proposalId: proposal.id, bindingId, canonicalProductId: binding.canonicalProductId, canonicalStoreId: binding.canonicalStoreId,
        baselineStatus: 'baseline_unavailable', baseline: null, current,
        incoming: { name: clean(snapshot.item.title, 120), price: finiteNonNegative(snapshot.item.price) },
        localChangedFields: [], incomingChangedFields: [], resolvableFields: [] });
      continue;
    }
    const baseline = assertBaseline(binding, baselineDoc.data()).baseline;
    const localChangedFields = changedFromBaseline(baseline, current);
    const incomingChangedFields = incomingChanges(baseline, snapshot);
    const incoming = { name: clean(snapshot.item.title, 120), price: finiteNonNegative(snapshot.item.price) };
    const resolvableFields = (['name', 'price'] as ResolvableField[]).filter(field => {
      if (field === 'name') return Boolean(incoming.name) && incoming.name !== current.name;
      return incoming.price !== null && incoming.price !== current.price;
    });
    items.push({ proposalId: proposal.id, bindingId, canonicalProductId: binding.canonicalProductId, canonicalStoreId: binding.canonicalStoreId,
      baselineStatus: 'conflict', baseline, current, incoming, localChangedFields, incomingChangedFields, resolvableFields });
  }
  return { items };
};

export const resolveMercadoLivreBoundProductConflict = async (input: {
  storeId: string;
  proposalId: string;
  choices: Partial<Record<ResolvableField, ResolutionChoice>>;
  resolvedByUserId: string;
}): Promise<{ proposalId: string; canonicalProductId: string; resolvedFields: ResolvableField[]; canonicalApplyStatus: 'applied' }> => {
  const storeId = input.storeId.trim();
  const proposalId = input.proposalId.trim();
  const resolvedByUserId = input.resolvedByUserId.trim();
  if (!storeId || !proposalId || resolvedByUserId !== storeId || !input.choices || typeof input.choices !== 'object') {
    throw new Error('MERCADO_LIVRE_CONFLICT_RESOLUTION_INPUT_INVALID');
  }
  for (const [field, choice] of Object.entries(input.choices)) {
    if (!['name', 'price'].includes(field) || !['kyrub', 'mercado_livre'].includes(String(choice))) throw new Error('MERCADO_LIVRE_CONFLICT_RESOLUTION_INPUT_INVALID');
  }
  const proposalRef = adminDb.doc(`stores/${storeId}/catalogSyncProposals/${proposalId}`);
  let output: { proposalId: string; canonicalProductId: string; resolvedFields: ResolvableField[]; canonicalApplyStatus: 'applied' } | null = null;
  await adminDb.runTransaction(async transaction => {
    const proposalDoc = await transaction.get(proposalRef);
    if (!proposalDoc.exists) throw new Error('MERCADO_LIVRE_SYNC_PROPOSAL_NOT_FOUND');
    const proposal = assertProposal(storeId, proposalDoc.data());
    if (proposal.canonicalApplyStatus === 'applied') throw new Error('MERCADO_LIVRE_CONFLICT_ALREADY_RESOLVED');
    const bindingId = bindingIdFor(storeId, proposal.connectionId, proposal.externalItemId);
    const bindingRef = adminDb.doc(`stores/${storeId}/externalCatalogBindings/${bindingId}`);
    const snapshotRef = adminDb.doc(`stores/${storeId}/externalCatalogSnapshots/${proposal.snapshotId}`);
    const baselineRef = adminDb.doc(`stores/${storeId}/externalCatalogBindingBaselines/${bindingId}`);
    const [bindingDoc, snapshotDoc, baselineDoc] = await Promise.all([transaction.get(bindingRef), transaction.get(snapshotRef), transaction.get(baselineRef)]);
    if (!bindingDoc.exists || !snapshotDoc.exists || !baselineDoc.exists) throw new Error('MERCADO_LIVRE_CONFLICT_BASELINE_REQUIRED');
    const binding = assertBinding(storeId, proposal, bindingDoc.data());
    const snapshot = assertSnapshot(storeId, proposal, snapshotDoc.data());
    const baseline = assertBaseline(binding, baselineDoc.data()).baseline;
    const canonicalRef = adminDb.doc(`stores/${binding.canonicalStoreId}/products/${binding.canonicalProductId}`);
    const canonicalDoc = await transaction.get(canonicalRef);
    if (!canonicalDoc.exists) throw new Error('MERCADO_LIVRE_BOUND_CANONICAL_PRODUCT_NOT_FOUND');
    const current = canonicalState(binding, canonicalDoc.data());
    if (baselineHash(current) === binding.canonicalBaselineHash) throw new Error('MERCADO_LIVRE_CONFLICT_NO_LONGER_PRESENT');
    const incomingName = clean(snapshot.item.title, 120);
    const incomingPrice = finiteNonNegative(snapshot.item.price);
    const resolvableFields = (['name', 'price'] as ResolvableField[]).filter(field => field === 'name'
      ? Boolean(incomingName) && incomingName !== current.name
      : incomingPrice !== null && incomingPrice !== current.price);
    for (const field of resolvableFields) if (!input.choices[field]) throw new Error('MERCADO_LIVRE_CONFLICT_RESOLUTION_CHOICE_REQUIRED');
    const next: CanonicalState = { ...current };
    if (resolvableFields.includes('name') && input.choices.name === 'mercado_livre') next.name = incomingName;
    if (resolvableFields.includes('price') && input.choices.price === 'mercado_livre' && incomingPrice !== null) next.price = incomingPrice;
    const nextHash = baselineHash(next);
    const now = new Date().toISOString();
    const resolutionRef = adminDb.doc(`stores/${storeId}/catalogSyncConflictResolutions/${proposalId}`);
    const existingResolution = await transaction.get(resolutionRef);
    if (existingResolution.exists) throw new Error('MERCADO_LIVRE_CONFLICT_RESOLUTION_ALREADY_RECORDED');
    transaction.update(canonicalRef, {
      ...(next.name !== current.name ? { name: next.name } : {}),
      ...(next.price !== current.price ? { price: next.price } : {}),
      catalogAuthority: 'store_owner_conflict_resolution', updatedByUserId: resolvedByUserId, updatedByRole: 'owner',
      'externalSource.sourceLastSyncedAt': snapshot.fetchedAt, 'externalSource.lastAppliedProposalId': proposalId,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(bindingRef, {
      canonicalBaselineHash: nextHash, sourceLastSyncedAt: snapshot.fetchedAt, lastAppliedProposalId: proposalId,
      lastAppliedSnapshotId: snapshot.id, updatedAt: now, serverUpdatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(baselineRef, {
      schemaVersion: 1, id: bindingId, storeId, bindingId, canonicalStoreId: binding.canonicalStoreId,
      canonicalProductId: binding.canonicalProductId, baselineHash: nextHash, baseline: next,
      authority: 'store_owner_conflict_resolution', capturedByUserId: resolvedByUserId, capturedAt: now, serverUpdatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(resolutionRef, {
      schemaVersion: 1, id: proposalId, storeId, provider: 'mercado_livre', proposalId, bindingId,
      canonicalStoreId: binding.canonicalStoreId, canonicalProductId: binding.canonicalProductId,
      sourceSnapshotId: snapshot.id, authority: 'store_owner_conflict_resolution', resolvedByUserId,
      localChangedFields: changedFromBaseline(baseline, current), incomingChangedFields: incomingChanges(baseline, snapshot),
      resolvableFields, choices: input.choices, baseline, current, incoming: { name: incomingName, price: incomingPrice }, after: next,
      protectedFieldsRetainedFromKyrub: ['stock', 'category', 'image'], createdAt: now, serverCreatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(proposalRef, {
      canonicalApplyStatus: 'applied', canonicalApplyAuthority: 'store_owner_conflict_resolution',
      canonicalAppliedByUserId: resolvedByUserId, canonicalAppliedFields: resolvableFields,
      canonicalAppliedBindingId: bindingId, canonicalAppliedProductId: binding.canonicalProductId,
      conflictResolutionId: proposalId, canonicalAppliedAt: now, serverCanonicalAppliedAt: FieldValue.serverTimestamp(),
    });
    output = { proposalId, canonicalProductId: binding.canonicalProductId, resolvedFields: resolvableFields, canonicalApplyStatus: 'applied' };
  });
  if (!output) throw new Error('MERCADO_LIVRE_CONFLICT_RESOLUTION_FAILED');
  return output;
};
