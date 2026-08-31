import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type { MercadoLivreExternalCatalogSnapshot } from './mercadoLivreNotificationProcessor.js';

interface ApprovedAppliedProposalRecord {
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

interface ExternalCatalogBindingRecord {
  id: string;
  storeId: string;
  provider: 'mercado_livre';
  connectionId: string;
  externalItemId: string;
  canonicalStoreId: string;
  canonicalProductId: string;
  status: 'active';
  canonicalBaselineHash: string;
  sourceLastSyncedAt: string;
}

interface CanonicalProductRecord {
  id: string;
  storeId: string;
  name: string;
  price: number;
  stock: number;
  category: string;
  image: string;
  isService: false;
  publicationStatus: string;
  externalSource?: Record<string, unknown>;
}

export interface MercadoLivreBoundProductSyncItem {
  proposalId: string;
  snapshotId: string;
  bindingId: string;
  canonicalProductId: string;
  canonicalStoreId: string;
  externalItemId: string;
  current: {
    name: string;
    price: number;
    publicationStatus: string;
  };
  incoming: {
    name: string;
    price: number | null;
  };
  changedFields: Array<'name' | 'price'>;
  baselineStatus: 'clean' | 'conflict';
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

const canonicalBaselineHash = (input: {
  name: string;
  price: number;
  stock: number;
  category: string;
  image: string;
}): string => createHash('sha256')
  .update(JSON.stringify({
    name: input.name,
    price: input.price,
    stock: input.stock,
    category: input.category,
    image: input.image,
    isService: false,
  }))
  .digest('hex');

const bindingIdFor = (storeId: string, connectionId: string, externalItemId: string): string => {
  const identity = createHash('sha256')
    .update([storeId, 'mercado_livre', connectionId, externalItemId].join(':'))
    .digest('hex');
  return `mlbind_${identity.slice(0, 32)}`;
};

const assertProposal = (storeId: string, value: unknown): ApprovedAppliedProposalRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_BOUND_SYNC_PROPOSAL_INVALID');
  }
  const record = value as Record<string, unknown>;
  if (
    record.provider !== 'mercado_livre' ||
    clean(record.storeId, 160) !== storeId ||
    record.status !== 'approved' ||
    record.authority !== 'provider_api_refetch' ||
    record.decisionAuthority !== 'store_owner_review' ||
    clean(record.decidedByUserId, 160) !== storeId ||
    record.applyStatus !== 'applied' ||
    !clean(record.id, 220) ||
    !clean(record.connectionId, 200) ||
    !clean(record.externalItemId, 160) ||
    !clean(record.snapshotId, 240)
  ) {
    throw new Error('MERCADO_LIVRE_BOUND_SYNC_PROPOSAL_INVALID');
  }
  return record as unknown as ApprovedAppliedProposalRecord;
};

const assertSnapshot = (
  storeId: string,
  proposal: ApprovedAppliedProposalRecord,
  value: unknown
): MercadoLivreExternalCatalogSnapshot => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_EXTERNAL_SNAPSHOT_INVALID');
  }
  const snapshot = value as MercadoLivreExternalCatalogSnapshot;
  if (
    snapshot.provider !== 'mercado_livre' ||
    snapshot.storeId !== storeId ||
    snapshot.id !== proposal.snapshotId ||
    snapshot.connectionId !== proposal.connectionId ||
    snapshot.externalItemId !== proposal.externalItemId ||
    snapshot.authority !== 'provider_api_refetch'
  ) throw new Error('MERCADO_LIVRE_EXTERNAL_SNAPSHOT_INVALID');
  return snapshot;
};

const assertBinding = (
  storeId: string,
  proposal: ApprovedAppliedProposalRecord,
  bindingId: string,
  value: unknown
): ExternalCatalogBindingRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_NOT_FOUND');
  }
  const record = value as Record<string, unknown>;
  if (
    clean(record.id, 160) !== bindingId ||
    clean(record.storeId, 160) !== storeId ||
    record.provider !== 'mercado_livre' ||
    clean(record.connectionId, 200) !== proposal.connectionId ||
    clean(record.externalItemId, 160) !== proposal.externalItemId ||
    record.status !== 'active' ||
    !clean(record.canonicalStoreId, 160) ||
    !clean(record.canonicalProductId, 160) ||
    !clean(record.canonicalBaselineHash, 80)
  ) throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_CONFLICT');
  return record as unknown as ExternalCatalogBindingRecord;
};

const assertCanonicalProduct = (
  binding: ExternalCatalogBindingRecord,
  value: unknown
): CanonicalProductRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_BOUND_CANONICAL_PRODUCT_NOT_FOUND');
  }
  const record = value as Record<string, unknown>;
  const price = finiteNonNegative(record.price);
  const stock = integerNonNegative(record.stock);
  if (
    clean(record.id, 160) !== binding.canonicalProductId ||
    clean(record.storeId, 160) !== binding.canonicalStoreId ||
    !clean(record.name, 120) ||
    price === null ||
    stock === null ||
    !clean(record.category, 120) ||
    record.isService !== false
  ) throw new Error('MERCADO_LIVRE_BOUND_CANONICAL_PRODUCT_INVALID');
  return {
    ...(record as unknown as CanonicalProductRecord),
    name: clean(record.name, 120),
    price,
    stock,
    category: clean(record.category, 120),
    image: clean(record.image, 2_000),
    publicationStatus: clean(record.publicationStatus, 40) || 'draft',
  };
};

const currentHash = (product: CanonicalProductRecord): string => canonicalBaselineHash({
  name: product.name,
  price: product.price,
  stock: product.stock,
  category: product.category,
  image: product.image,
});

const changedFieldsFor = (
  product: CanonicalProductRecord,
  snapshot: MercadoLivreExternalCatalogSnapshot
): Array<'name' | 'price'> => {
  const fields: Array<'name' | 'price'> = [];
  const incomingName = clean(snapshot.item.title, 120);
  if (incomingName && incomingName !== product.name) fields.push('name');
  const incomingPrice = finiteNonNegative(snapshot.item.price);
  if (incomingPrice !== null && incomingPrice !== product.price) fields.push('price');
  return fields;
};

export const listMercadoLivreBoundProductSyncQueue = async (input: {
  storeId: string;
  limit?: number;
}): Promise<{ items: MercadoLivreBoundProductSyncItem[] }> => {
  const storeId = input.storeId.trim();
  if (!storeId) throw new Error('STORE_CONNECTION_STORE_REQUIRED');
  const requestedLimit = Number(input.limit ?? 50);
  const limit = Number.isSafeInteger(requestedLimit) ? Math.max(1, Math.min(100, requestedLimit)) : 50;
  const proposals = await adminDb
    .collection(`stores/${storeId}/catalogSyncProposals`)
    .where('provider', '==', 'mercado_livre')
    .where('status', '==', 'approved')
    .limit(limit)
    .get();

  const items: MercadoLivreBoundProductSyncItem[] = [];
  for (const document of proposals.docs) {
    let proposal: ApprovedAppliedProposalRecord;
    try {
      proposal = assertProposal(storeId, document.data());
    } catch {
      continue;
    }
    if (proposal.canonicalApplyStatus === 'applied') continue;

    const snapshotDocument = await adminDb.doc(
      `stores/${storeId}/externalCatalogSnapshots/${proposal.snapshotId}`
    ).get();
    if (!snapshotDocument.exists) continue;
    const snapshot = assertSnapshot(storeId, proposal, snapshotDocument.data());
    const bindingId = bindingIdFor(storeId, proposal.connectionId, proposal.externalItemId);
    const bindingDocument = await adminDb.doc(
      `stores/${storeId}/externalCatalogBindings/${bindingId}`
    ).get();
    if (!bindingDocument.exists) continue;
    const binding = assertBinding(storeId, proposal, bindingId, bindingDocument.data());
    const canonicalDocument = await adminDb.doc(
      `stores/${binding.canonicalStoreId}/products/${binding.canonicalProductId}`
    ).get();
    if (!canonicalDocument.exists) continue;
    const product = assertCanonicalProduct(binding, canonicalDocument.data());
    const changedFields = changedFieldsFor(product, snapshot);
    if (!changedFields.length) continue;

    items.push({
      proposalId: proposal.id,
      snapshotId: snapshot.id,
      bindingId,
      canonicalProductId: binding.canonicalProductId,
      canonicalStoreId: binding.canonicalStoreId,
      externalItemId: proposal.externalItemId,
      current: {
        name: product.name,
        price: product.price,
        publicationStatus: product.publicationStatus,
      },
      incoming: {
        name: clean(snapshot.item.title, 120),
        price: finiteNonNegative(snapshot.item.price),
      },
      changedFields,
      baselineStatus: currentHash(product) === binding.canonicalBaselineHash ? 'clean' : 'conflict',
    });
  }
  return { items };
};

export const applyMercadoLivreSnapshotToBoundCanonicalProduct = async (input: {
  storeId: string;
  proposalId: string;
  appliedByUserId: string;
}): Promise<{
  proposalId: string;
  bindingId: string;
  canonicalProductId: string;
  changedFields: Array<'name' | 'price'>;
  canonicalApplyStatus: 'applied';
  alreadyApplied: boolean;
}> => {
  const storeId = input.storeId.trim();
  const proposalId = input.proposalId.trim();
  const appliedByUserId = input.appliedByUserId.trim();
  if (!storeId || !proposalId || !appliedByUserId) {
    throw new Error('MERCADO_LIVRE_BOUND_SYNC_TARGET_INVALID');
  }
  if (appliedByUserId !== storeId) throw new Error('STORE_CONNECTION_FORBIDDEN');

  const proposalReference = adminDb.doc(`stores/${storeId}/catalogSyncProposals/${proposalId}`);
  let result: {
    proposalId: string;
    bindingId: string;
    canonicalProductId: string;
    changedFields: Array<'name' | 'price'>;
    canonicalApplyStatus: 'applied';
    alreadyApplied: boolean;
  } | null = null;

  await adminDb.runTransaction(async transaction => {
    const proposalDocument = await transaction.get(proposalReference);
    if (!proposalDocument.exists) throw new Error('MERCADO_LIVRE_SYNC_PROPOSAL_NOT_FOUND');
    const proposal = assertProposal(storeId, proposalDocument.data());
    const bindingId = bindingIdFor(storeId, proposal.connectionId, proposal.externalItemId);
    if (proposal.canonicalApplyStatus === 'applied') {
      const bindingDocument = await transaction.get(
        adminDb.doc(`stores/${storeId}/externalCatalogBindings/${bindingId}`)
      );
      if (!bindingDocument.exists) throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_NOT_FOUND');
      const binding = assertBinding(storeId, proposal, bindingId, bindingDocument.data());
      result = {
        proposalId,
        bindingId,
        canonicalProductId: binding.canonicalProductId,
        changedFields: [],
        canonicalApplyStatus: 'applied',
        alreadyApplied: true,
      };
      return;
    }

    const snapshotReference = adminDb.doc(
      `stores/${storeId}/externalCatalogSnapshots/${proposal.snapshotId}`
    );
    const bindingReference = adminDb.doc(`stores/${storeId}/externalCatalogBindings/${bindingId}`);
    const [snapshotDocument, bindingDocument] = await Promise.all([
      transaction.get(snapshotReference),
      transaction.get(bindingReference),
    ]);
    if (!snapshotDocument.exists) throw new Error('MERCADO_LIVRE_EXTERNAL_SNAPSHOT_NOT_FOUND');
    if (!bindingDocument.exists) throw new Error('MERCADO_LIVRE_EXTERNAL_BINDING_NOT_FOUND');
    const snapshot = assertSnapshot(storeId, proposal, snapshotDocument.data());
    const binding = assertBinding(storeId, proposal, bindingId, bindingDocument.data());
    const canonicalReference = adminDb.doc(
      `stores/${binding.canonicalStoreId}/products/${binding.canonicalProductId}`
    );
    const canonicalDocument = await transaction.get(canonicalReference);
    if (!canonicalDocument.exists) throw new Error('MERCADO_LIVRE_BOUND_CANONICAL_PRODUCT_NOT_FOUND');
    const product = assertCanonicalProduct(binding, canonicalDocument.data());

    if (currentHash(product) !== binding.canonicalBaselineHash) {
      throw new Error('MERCADO_LIVRE_BOUND_SYNC_BASELINE_CONFLICT');
    }

    const changedFields = changedFieldsFor(product, snapshot);
    const incomingName = clean(snapshot.item.title, 120);
    const incomingPrice = finiteNonNegative(snapshot.item.price);
    const nextName = changedFields.includes('name') ? incomingName : product.name;
    const nextPrice = changedFields.includes('price') && incomingPrice !== null ? incomingPrice : product.price;
    const nextBaselineHash = canonicalBaselineHash({
      name: nextName,
      price: nextPrice,
      stock: product.stock,
      category: product.category,
      image: product.image,
    });
    const now = new Date().toISOString();
    const applicationReference = adminDb.doc(
      `stores/${storeId}/catalogSyncApplications/${proposalId}`
    );
    const existingApplication = await transaction.get(applicationReference);
    if (existingApplication.exists) {
      throw new Error('MERCADO_LIVRE_BOUND_SYNC_APPLICATION_CONFLICT');
    }

    transaction.update(canonicalReference, {
      ...(changedFields.includes('name') ? { name: nextName } : {}),
      ...(changedFields.includes('price') ? { price: nextPrice } : {}),
      catalogAuthority: 'store_owner_external_sync_review',
      updatedByUserId: appliedByUserId,
      updatedByRole: 'owner',
      'externalSource.sourceLastSyncedAt': snapshot.fetchedAt,
      'externalSource.lastAppliedProposalId': proposalId,
      updatedAt: FieldValue.serverTimestamp(),
    });

    transaction.update(bindingReference, {
      canonicalBaselineHash: nextBaselineHash,
      sourceLastSyncedAt: snapshot.fetchedAt,
      lastAppliedProposalId: proposalId,
      lastAppliedSnapshotId: snapshot.id,
      updatedAt: now,
      serverUpdatedAt: FieldValue.serverTimestamp(),
    });

    transaction.create(applicationReference, {
      schemaVersion: 1,
      id: proposalId,
      storeId,
      provider: 'mercado_livre',
      connectionId: proposal.connectionId,
      externalItemId: proposal.externalItemId,
      bindingId,
      canonicalStoreId: binding.canonicalStoreId,
      canonicalProductId: binding.canonicalProductId,
      proposalId,
      sourceSnapshotId: snapshot.id,
      authority: 'store_owner_external_sync_review',
      appliedByUserId,
      changedFields,
      before: {
        name: product.name,
        price: product.price,
        stock: product.stock,
        category: product.category,
        image: product.image,
      },
      after: {
        name: nextName,
        price: nextPrice,
        stock: product.stock,
        category: product.category,
        image: product.image,
      },
      sourceEvidence: {
        title: snapshot.item.title,
        price: snapshot.item.price,
        availableQuantity: snapshot.item.availableQuantity,
        categoryId: snapshot.item.categoryId,
        fetchedAt: snapshot.fetchedAt,
      },
      createdAt: now,
      serverCreatedAt: FieldValue.serverTimestamp(),
    });

    transaction.update(proposalReference, {
      canonicalApplyStatus: 'applied',
      canonicalApplyAuthority: 'store_owner_external_sync_review',
      canonicalAppliedByUserId: appliedByUserId,
      canonicalAppliedFields: changedFields,
      canonicalAppliedBindingId: bindingId,
      canonicalAppliedProductId: binding.canonicalProductId,
      canonicalAppliedAt: now,
      serverCanonicalAppliedAt: FieldValue.serverTimestamp(),
    });

    result = {
      proposalId,
      bindingId,
      canonicalProductId: binding.canonicalProductId,
      changedFields,
      canonicalApplyStatus: 'applied',
      alreadyApplied: false,
    };
  });

  if (!result) throw new Error('MERCADO_LIVRE_BOUND_SYNC_APPLY_FAILED');
  return result;
};
