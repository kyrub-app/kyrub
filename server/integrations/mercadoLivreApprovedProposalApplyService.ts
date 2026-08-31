import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { buildMercadoLivreImportProvenance } from '../../shared/mercadoLivreIntegration.js';
import type { MercadoLivreExternalCatalogSnapshot } from './mercadoLivreNotificationProcessor.js';

interface ApprovedProposalRecord {
  id: string;
  provider: 'mercado_livre';
  storeId: string;
  connectionId: string;
  externalItemId: string;
  snapshotId: string;
  status: 'approved';
  authority: 'provider_api_refetch';
  proposal: 'external_change_detected';
  decisionAuthority: 'store_owner_review';
  decidedByUserId: string;
  applyStatus: 'not_applied' | 'applied';
  appliedDraftId?: string;
}

interface ExistingImportDraft {
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
  provenance: {
    source: 'mercado_livre';
    externalId: string;
    connectionId: string;
    importedAt: string;
    lastSyncedAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

const draftIdForExternalItem = (externalItemId: string): string =>
  `mercado_livre__${externalItemId.replace(/[^A-Za-z0-9_-]/g, '_')}`;

const assertApprovedProposal = (storeId: string, value: unknown): ApprovedProposalRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_SYNC_PROPOSAL_INVALID');
  }
  const record = value as Record<string, unknown>;
  if (
    record.provider !== 'mercado_livre' ||
    clean(record.storeId) !== storeId ||
    record.status !== 'approved' ||
    record.authority !== 'provider_api_refetch' ||
    record.proposal !== 'external_change_detected' ||
    record.decisionAuthority !== 'store_owner_review' ||
    clean(record.decidedByUserId) !== storeId ||
    !clean(record.id) ||
    !clean(record.connectionId) ||
    !clean(record.externalItemId) ||
    !clean(record.snapshotId) ||
    (record.applyStatus !== 'not_applied' && record.applyStatus !== 'applied')
  ) throw new Error('MERCADO_LIVRE_SYNC_PROPOSAL_NOT_APPROVED');
  return record as unknown as ApprovedProposalRecord;
};

const assertSnapshot = (
  storeId: string,
  proposal: ApprovedProposalRecord,
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

const assertCompatibleDraft = (
  storeId: string,
  proposal: ApprovedProposalRecord,
  value: unknown
): ExistingImportDraft => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_SYNC_DRAFT_CONFLICT');
  }
  const draft = value as ExistingImportDraft;
  if (
    draft.storeId !== storeId ||
    draft.source !== 'mercado_livre' ||
    draft.status !== 'draft' ||
    draft.provenance?.source !== 'mercado_livre' ||
    draft.provenance.externalId !== proposal.externalItemId ||
    draft.provenance.connectionId !== proposal.connectionId ||
    !clean(draft.provenance.lastSyncedAt) ||
    clean(draft.updatedAt) !== clean(draft.provenance.lastSyncedAt)
  ) throw new Error('MERCADO_LIVRE_SYNC_DRAFT_CONFLICT');
  return draft;
};

export interface MercadoLivreApprovedSyncProposalItem {
  proposal: ApprovedProposalRecord;
  snapshot: MercadoLivreExternalCatalogSnapshot;
}

export const listMercadoLivreApprovedSyncProposals = async (input: {
  storeId: string;
  limit?: number;
}): Promise<{ items: MercadoLivreApprovedSyncProposalItem[] }> => {
  const storeId = input.storeId.trim();
  if (!storeId) throw new Error('STORE_CONNECTION_STORE_REQUIRED');
  const requestedLimit = Number(input.limit ?? 50);
  const limit = Number.isSafeInteger(requestedLimit) ? Math.max(1, Math.min(100, requestedLimit)) : 50;
  const snapshot = await adminDb
    .collection(`stores/${storeId}/catalogSyncProposals`)
    .where('provider', '==', 'mercado_livre')
    .where('status', '==', 'approved')
    .limit(limit)
    .get();

  const items: MercadoLivreApprovedSyncProposalItem[] = [];
  for (const document of snapshot.docs) {
    const proposal = assertApprovedProposal(storeId, document.data());
    if (proposal.applyStatus !== 'not_applied') continue;
    const source = await adminDb.doc(`stores/${storeId}/externalCatalogSnapshots/${proposal.snapshotId}`).get();
    if (!source.exists) throw new Error('MERCADO_LIVRE_EXTERNAL_SNAPSHOT_NOT_FOUND');
    items.push({ proposal, snapshot: assertSnapshot(storeId, proposal, source.data()) });
  }
  return { items };
};

export const applyApprovedMercadoLivreProposalToDraft = async (input: {
  storeId: string;
  proposalId: string;
  appliedByUserId: string;
}): Promise<{
  proposalId: string;
  draftId: string;
  applyStatus: 'applied';
  target: 'catalog_import_draft';
  alreadyApplied: boolean;
}> => {
  const storeId = input.storeId.trim();
  const proposalId = input.proposalId.trim();
  const appliedByUserId = input.appliedByUserId.trim();
  if (!storeId || !proposalId || !appliedByUserId) {
    throw new Error('MERCADO_LIVRE_SYNC_APPLY_TARGET_INVALID');
  }
  if (appliedByUserId !== storeId) throw new Error('STORE_CONNECTION_FORBIDDEN');

  const proposalRef = adminDb.doc(`stores/${storeId}/catalogSyncProposals/${proposalId}`);
  let result: {
    proposalId: string;
    draftId: string;
    applyStatus: 'applied';
    target: 'catalog_import_draft';
    alreadyApplied: boolean;
  } | null = null;

  await adminDb.runTransaction(async transaction => {
    const proposalDocument = await transaction.get(proposalRef);
    if (!proposalDocument.exists) throw new Error('MERCADO_LIVRE_SYNC_PROPOSAL_NOT_FOUND');
    const proposal = assertApprovedProposal(storeId, proposalDocument.data());
    const draftId = proposal.appliedDraftId || draftIdForExternalItem(proposal.externalItemId);
    if (proposal.applyStatus === 'applied') {
      result = { proposalId, draftId, applyStatus: 'applied', target: 'catalog_import_draft', alreadyApplied: true };
      return;
    }

    const snapshotRef = adminDb.doc(`stores/${storeId}/externalCatalogSnapshots/${proposal.snapshotId}`);
    const draftRef = adminDb.doc(`stores/${storeId}/catalogImportDrafts/${draftId}`);
    const [snapshotDocument, draftDocument] = await Promise.all([
      transaction.get(snapshotRef),
      transaction.get(draftRef),
    ]);
    if (!snapshotDocument.exists) throw new Error('MERCADO_LIVRE_EXTERNAL_SNAPSHOT_NOT_FOUND');
    const source = assertSnapshot(storeId, proposal, snapshotDocument.data());
    const existing = draftDocument.exists
      ? assertCompatibleDraft(storeId, proposal, draftDocument.data())
      : null;

    if (existing && existing.provenance.lastSyncedAt.localeCompare(source.fetchedAt) > 0) {
      throw new Error('MERCADO_LIVRE_SYNC_PROPOSAL_STALE');
    }

    const importedAt = existing?.provenance.importedAt || source.fetchedAt;
    const provenance = {
      ...buildMercadoLivreImportProvenance({
        externalId: proposal.externalItemId,
        connectionId: proposal.connectionId,
        importedAt,
      }),
      lastSyncedAt: source.fetchedAt,
    };
    transaction.set(draftRef, {
      id: draftId,
      storeId,
      source: 'mercado_livre',
      status: 'draft',
      title: source.item.title,
      price: source.item.price,
      categoryId: source.item.categoryId,
      ...(existing?.thumbnail ? { thumbnail: existing.thumbnail } : {}),
      ...(source.item.sellerSku ? { sellerSku: source.item.sellerSku } : {}),
      ...(source.item.availableQuantity !== null
        ? { sourceAvailableQuantity: source.item.availableQuantity }
        : {}),
      provenance,
      createdAt: existing?.createdAt || source.fetchedAt,
      updatedAt: source.fetchedAt,
      serverUpdatedAt: FieldValue.serverTimestamp(),
      updateAuthority: 'approved_store_owner_review',
      sourceProposalId: proposal.id,
      sourceSnapshotId: source.id,
    });
    transaction.update(proposalRef, {
      applyStatus: 'applied',
      applyTarget: 'catalog_import_draft',
      applyAuthority: 'approved_store_owner_review',
      appliedByUserId,
      appliedDraftId: draftId,
      appliedAt: new Date().toISOString(),
      serverAppliedAt: FieldValue.serverTimestamp(),
    });
    result = { proposalId, draftId, applyStatus: 'applied', target: 'catalog_import_draft', alreadyApplied: false };
  });

  if (!result) throw new Error('MERCADO_LIVRE_SYNC_APPLY_FAILED');
  return result;
};
