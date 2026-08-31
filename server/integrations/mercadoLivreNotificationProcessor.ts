import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { mercadoLivreGetJson } from './mercadoLivreOauthService.js';
import { getStoreConnectionRegistryRecord } from './storeConnectionRegistry.js';

interface MercadoLivreInboxRecord {
  provider: 'mercado_livre';
  notificationId: string;
  topic: string;
  resource: string;
  externalAccountId: string;
  storeId: string;
  connectionId: string;
  disposition: 'pending_fetch';
  processingStatus: 'pending' | 'processed' | 'failed';
  authority: 'provider_notification_trigger';
}

export interface MercadoLivreExternalCatalogSnapshot {
  id: string;
  provider: 'mercado_livre';
  storeId: string;
  connectionId: string;
  externalAccountId: string;
  externalItemId: string;
  sourceNotificationId: string;
  sourceTopic: string;
  sourceResource: string;
  authority: 'provider_api_refetch';
  fetchedAt: string;
  item: {
    externalId: string;
    title: string;
    price: number | null;
    availableQuantity: number | null;
    status: string;
    categoryId: string;
    sellerSku?: string;
  };
}

export interface MercadoLivreCatalogSyncProposal {
  id: string;
  provider: 'mercado_livre';
  storeId: string;
  connectionId: string;
  externalItemId: string;
  snapshotId: string;
  sourceNotificationId: string;
  status: 'review_required';
  authority: 'provider_api_refetch';
  proposedAt: string;
  proposal: 'external_change_detected';
}

const clean = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

const finiteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const externalItemIdFromMercadoLivreResource = (resourceInput: string): string => {
  const resource = resourceInput.trim();
  const match = resource.match(/^\/items\/([^/?#]+)/i);
  const externalItemId = clean(match?.[1]);
  if (!externalItemId || !/^[A-Za-z0-9_-]{3,80}$/.test(externalItemId)) {
    throw new Error('MERCADO_LIVRE_NOTIFICATION_RESOURCE_UNSUPPORTED');
  }
  return externalItemId;
};

const parseFetchedItem = (value: unknown, expectedExternalItemId: string) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_ITEM_RESPONSE_INVALID');
  }
  const candidate = value as Record<string, unknown>;
  const externalId = clean(candidate.id);
  const title = clean(candidate.title);
  if (externalId !== expectedExternalItemId || !title) {
    throw new Error('MERCADO_LIVRE_ITEM_RESPONSE_INVALID');
  }
  const sellerSku = clean(candidate.seller_custom_field);
  return {
    externalId,
    title,
    price: finiteNumber(candidate.price),
    availableQuantity: finiteNumber(candidate.available_quantity),
    status: clean(candidate.status),
    categoryId: clean(candidate.category_id),
    ...(sellerSku ? { sellerSku } : {}),
  };
};

const assertPendingInbox = (value: unknown): MercadoLivreInboxRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_NOTIFICATION_INBOX_INVALID');
  }
  const record = value as Partial<MercadoLivreInboxRecord>;
  if (
    record.provider !== 'mercado_livre' ||
    record.disposition !== 'pending_fetch' ||
    record.authority !== 'provider_notification_trigger' ||
    !clean(record.notificationId) ||
    !clean(record.resource) ||
    !clean(record.storeId) ||
    !clean(record.connectionId) ||
    !clean(record.externalAccountId)
  ) throw new Error('MERCADO_LIVRE_NOTIFICATION_INBOX_INVALID');
  if (record.processingStatus !== 'pending' && record.processingStatus !== 'processed' && record.processingStatus !== 'failed') {
    throw new Error('MERCADO_LIVRE_NOTIFICATION_INBOX_INVALID');
  }
  return record as MercadoLivreInboxRecord;
};

export const processMercadoLivreNotificationInboxItem = async (input: {
  inboxId: string;
  expectedStoreId?: string;
}): Promise<{
  alreadyProcessed: boolean;
  snapshot?: MercadoLivreExternalCatalogSnapshot;
  proposal?: MercadoLivreCatalogSyncProposal;
}> => {
  const inboxId = input.inboxId.trim();
  if (!inboxId || !/^mercado_livre__[a-f0-9]{64}$/.test(inboxId)) {
    throw new Error('MERCADO_LIVRE_NOTIFICATION_INBOX_ID_INVALID');
  }
  const inboxRef = adminDb.doc(`integrationWebhookInbox/${inboxId}`);
  const inboxSnapshot = await inboxRef.get();
  if (!inboxSnapshot.exists) throw new Error('MERCADO_LIVRE_NOTIFICATION_INBOX_NOT_FOUND');
  const inbox = assertPendingInbox(inboxSnapshot.data());

  const expectedStoreId = input.expectedStoreId?.trim();
  if (expectedStoreId && inbox.storeId !== expectedStoreId) {
    throw new Error('STORE_CONNECTION_FORBIDDEN');
  }
  if (inbox.processingStatus === 'processed') return { alreadyProcessed: true };
  if (inbox.processingStatus !== 'pending') {
    throw new Error('MERCADO_LIVRE_NOTIFICATION_INBOX_NOT_PENDING');
  }

  const connection = await getStoreConnectionRegistryRecord({
    storeId: inbox.storeId,
    connectionId: inbox.connectionId,
  });
  if (
    !connection ||
    connection.provider !== 'mercado_livre' ||
    connection.status !== 'connected' ||
    connection.externalAccountId !== inbox.externalAccountId ||
    connection.syncAuthority !== 'manual_review'
  ) throw new Error('MERCADO_LIVRE_CONNECTION_INVALID');

  const externalItemId = externalItemIdFromMercadoLivreResource(inbox.resource);
  const fetched = await mercadoLivreGetJson<unknown>(
    inbox.storeId,
    `/items/${encodeURIComponent(externalItemId)}`
  );
  const item = parseFetchedItem(fetched, externalItemId);
  const fetchedAt = new Date().toISOString();
  const snapshotId = `${inboxId}__snapshot`;
  const proposalId = `${inboxId}__proposal`;
  const snapshot: MercadoLivreExternalCatalogSnapshot = {
    id: snapshotId,
    provider: 'mercado_livre',
    storeId: inbox.storeId,
    connectionId: inbox.connectionId,
    externalAccountId: inbox.externalAccountId,
    externalItemId,
    sourceNotificationId: inbox.notificationId,
    sourceTopic: inbox.topic,
    sourceResource: inbox.resource,
    authority: 'provider_api_refetch',
    fetchedAt,
    item,
  };
  const proposal: MercadoLivreCatalogSyncProposal = {
    id: proposalId,
    provider: 'mercado_livre',
    storeId: inbox.storeId,
    connectionId: inbox.connectionId,
    externalItemId,
    snapshotId,
    sourceNotificationId: inbox.notificationId,
    status: 'review_required',
    authority: 'provider_api_refetch',
    proposedAt: fetchedAt,
    proposal: 'external_change_detected',
  };

  const snapshotRef = adminDb.doc(`stores/${inbox.storeId}/externalCatalogSnapshots/${snapshotId}`);
  const proposalRef = adminDb.doc(`stores/${inbox.storeId}/catalogSyncProposals/${proposalId}`);

  await adminDb.runTransaction(async transaction => {
    const current = await transaction.get(inboxRef);
    if (!current.exists) throw new Error('MERCADO_LIVRE_NOTIFICATION_INBOX_NOT_FOUND');
    const currentInbox = assertPendingInbox(current.data());
    if (currentInbox.processingStatus === 'processed') return;
    if (currentInbox.processingStatus !== 'pending') {
      throw new Error('MERCADO_LIVRE_NOTIFICATION_INBOX_NOT_PENDING');
    }
    transaction.create(snapshotRef, {
      ...snapshot,
      serverCreatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(proposalRef, {
      ...proposal,
      serverCreatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(inboxRef, {
      processingStatus: 'processed',
      processedAt: FieldValue.serverTimestamp(),
      processedSnapshotId: snapshotId,
      syncProposalId: proposalId,
      processingAuthority: 'provider_api_refetch',
    });
  });

  return { alreadyProcessed: false, snapshot, proposal };
};
