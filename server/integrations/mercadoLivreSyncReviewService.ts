import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type {
  MercadoLivreCatalogSyncProposal,
  MercadoLivreExternalCatalogSnapshot,
} from './mercadoLivreNotificationProcessor.js';

export interface MercadoLivreSyncReviewItem {
  proposal: MercadoLivreCatalogSyncProposal & {
    status: 'review_required' | 'approved' | 'rejected';
    decidedAt?: string;
    decidedByUserId?: string;
  };
  snapshot: MercadoLivreExternalCatalogSnapshot;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const proposalPath = (storeId: string, proposalId: string): string =>
  `stores/${storeId}/catalogSyncProposals/${proposalId}`;

const snapshotPath = (storeId: string, snapshotId: string): string =>
  `stores/${storeId}/externalCatalogSnapshots/${snapshotId}`;

const assertProposalForStore = (
  storeId: string,
  value: unknown
): MercadoLivreSyncReviewItem['proposal'] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_SYNC_PROPOSAL_INVALID');
  }
  const record = value as Record<string, unknown>;
  if (
    record.provider !== 'mercado_livre' ||
    clean(record.storeId) !== storeId ||
    record.authority !== 'provider_api_refetch' ||
    record.proposal !== 'external_change_detected' ||
    !clean(record.id) ||
    !clean(record.connectionId) ||
    !clean(record.externalItemId) ||
    !clean(record.snapshotId)
  ) throw new Error('MERCADO_LIVRE_SYNC_PROPOSAL_INVALID');
  if (record.status !== 'review_required' && record.status !== 'approved' && record.status !== 'rejected') {
    throw new Error('MERCADO_LIVRE_SYNC_PROPOSAL_INVALID');
  }
  return record as unknown as MercadoLivreSyncReviewItem['proposal'];
};

const assertSnapshotForProposal = (
  storeId: string,
  proposal: MercadoLivreSyncReviewItem['proposal'],
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

export const listMercadoLivreSyncReviewQueue = async (input: {
  storeId: string;
  limit?: number;
}): Promise<{ items: MercadoLivreSyncReviewItem[] }> => {
  const storeId = input.storeId.trim();
  if (!storeId) throw new Error('STORE_CONNECTION_STORE_REQUIRED');
  const requestedLimit = Number(input.limit ?? 50);
  const limit = Number.isSafeInteger(requestedLimit)
    ? Math.max(1, Math.min(100, requestedLimit))
    : 50;

  const proposalsSnapshot = await adminDb
    .collection(`stores/${storeId}/catalogSyncProposals`)
    .where('provider', '==', 'mercado_livre')
    .where('status', '==', 'review_required')
    .limit(limit)
    .get();

  const items: MercadoLivreSyncReviewItem[] = [];
  for (const document of proposalsSnapshot.docs) {
    const proposal = assertProposalForStore(storeId, document.data());
    const snapshotDocument = await adminDb.doc(snapshotPath(storeId, proposal.snapshotId)).get();
    if (!snapshotDocument.exists) throw new Error('MERCADO_LIVRE_EXTERNAL_SNAPSHOT_NOT_FOUND');
    const snapshot = assertSnapshotForProposal(storeId, proposal, snapshotDocument.data());
    items.push({ proposal, snapshot });
  }

  items.sort((a, b) => b.proposal.proposedAt.localeCompare(a.proposal.proposedAt));
  return { items };
};

export const decideMercadoLivreSyncProposal = async (input: {
  storeId: string;
  proposalId: string;
  decision: unknown;
  decidedByUserId: string;
}): Promise<{ proposalId: string; status: 'approved' | 'rejected' }> => {
  const storeId = input.storeId.trim();
  const proposalId = input.proposalId.trim();
  const decidedByUserId = input.decidedByUserId.trim();
  if (!storeId || !proposalId || !decidedByUserId) {
    throw new Error('MERCADO_LIVRE_SYNC_REVIEW_TARGET_INVALID');
  }
  if (decidedByUserId !== storeId) throw new Error('STORE_CONNECTION_FORBIDDEN');
  if (input.decision !== 'approve' && input.decision !== 'reject') {
    throw new Error('MERCADO_LIVRE_SYNC_REVIEW_DECISION_INVALID');
  }

  const nextStatus = input.decision === 'approve' ? 'approved' : 'rejected';
  const reference = adminDb.doc(proposalPath(storeId, proposalId));
  await adminDb.runTransaction(async transaction => {
    const current = await transaction.get(reference);
    if (!current.exists) throw new Error('MERCADO_LIVRE_SYNC_PROPOSAL_NOT_FOUND');
    const proposal = assertProposalForStore(storeId, current.data());
    if (proposal.status !== 'review_required') {
      throw new Error('MERCADO_LIVRE_SYNC_PROPOSAL_ALREADY_DECIDED');
    }
    transaction.update(reference, {
      status: nextStatus,
      decisionAuthority: 'store_owner_review',
      decidedByUserId,
      decidedAt: new Date().toISOString(),
      serverDecidedAt: FieldValue.serverTimestamp(),
      applyStatus: 'not_applied',
    });
  });

  return { proposalId, status: nextStatus };
};
