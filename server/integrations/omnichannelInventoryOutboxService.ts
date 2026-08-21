import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin';
import type { StoreIntegrationId } from '../../src/utils/storeOperationalSettings';
import type { StoreChannelRegistryEntry } from '../../src/utils/channelRegistry';
import {
  planCanonicalInventoryPropagation,
  type CanonicalInventoryLedgerEntry,
} from '../../src/utils/canonicalInventoryLedger';

const LEDGER_COLLECTION = 'inventoryLedger';
const OUTBOX_COLLECTION = 'inventorySyncOutbox';
const MAPPING_COLLECTION = 'externalIdentityMappings';

export type InventoryOutboxStatus = 'pending' | 'missing_mapping';

export interface InventoryOutboxJob {
  id: string;
  storeId: string;
  productId: string;
  externalProductId: string;
  targetChannel: StoreIntegrationId;
  quantity: number;
  ledgerId: string;
  idempotencyKey: string;
  status: InventoryOutboxStatus;
  attempts: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PersistInventoryPropagationResult {
  duplicate: boolean;
  ledgerId: string;
  jobsCreated: number;
  jobsBlockedByMissingMapping: number;
}

const stableHash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const ledgerDocumentId = (entry: CanonicalInventoryLedgerEntry): string =>
  stableHash(entry.idempotencyKey);

const outboxDocumentId = (
  entry: CanonicalInventoryLedgerEntry,
  channelId: StoreIntegrationId
): string => stableHash(`${entry.idempotencyKey}\u0000${channelId}`);

const resolveExternalProductId = async (input: {
  storeId: string;
  channelId: StoreIntegrationId;
  canonicalProductId: string;
}): Promise<string | null> => {
  const snapshot = await adminDb
    .collection(`stores/${input.storeId}/${MAPPING_COLLECTION}`)
    .where('channelId', '==', input.channelId)
    .where('entityType', '==', 'product')
    .where('canonicalId', '==', input.canonicalProductId)
    .limit(2)
    .get();

  if (snapshot.size > 1) {
    throw new Error('AMBIGUOUS_PRODUCT_EXTERNAL_MAPPING');
  }
  if (snapshot.empty) return null;

  const externalId = snapshot.docs[0]?.data().externalId;
  return typeof externalId === 'string' && externalId.trim()
    ? externalId.trim()
    : null;
};

const externalTargets = (
  entry: CanonicalInventoryLedgerEntry,
  registry: StoreChannelRegistryEntry[]
): StoreIntegrationId[] =>
  planCanonicalInventoryPropagation(entry, registry)
    .targets
    .map(target => target.channelId)
    .filter((channelId): channelId is StoreIntegrationId => channelId !== 'kyrub-shop');

export const persistCanonicalInventoryPropagation = async (
  entry: CanonicalInventoryLedgerEntry,
  registry: StoreChannelRegistryEntry[]
): Promise<PersistInventoryPropagationResult> => {
  const targets = externalTargets(entry, registry);
  const mappings = new Map<StoreIntegrationId, string | null>();

  await Promise.all(targets.map(async channelId => {
    mappings.set(channelId, await resolveExternalProductId({
      storeId: entry.storeId,
      channelId,
      canonicalProductId: entry.productId,
    }));
  }));

  const ledgerId = ledgerDocumentId(entry);
  const ledgerRef = adminDb.doc(
    `stores/${entry.storeId}/${LEDGER_COLLECTION}/${ledgerId}`
  );

  let duplicate = false;
  let jobsCreated = 0;
  let jobsBlockedByMissingMapping = 0;

  await adminDb.runTransaction(async transaction => {
    const existingLedger = await transaction.get(ledgerRef);
    if (existingLedger.exists) {
      duplicate = true;
      return;
    }

    const now = FieldValue.serverTimestamp();
    transaction.create(ledgerRef, {
      ...entry,
      id: ledgerId,
      createdAt: now,
      updatedAt: now,
    });

    for (const channelId of targets) {
      const externalProductId = mappings.get(channelId) ?? null;
      const jobId = outboxDocumentId(entry, channelId);
      const jobRef = adminDb.doc(
        `stores/${entry.storeId}/${OUTBOX_COLLECTION}/${jobId}`
      );
      const status: InventoryOutboxStatus = externalProductId
        ? 'pending'
        : 'missing_mapping';

      transaction.create(jobRef, {
        id: jobId,
        storeId: entry.storeId,
        productId: entry.productId,
        externalProductId: externalProductId ?? '',
        targetChannel: channelId,
        quantity: entry.quantity,
        ledgerId,
        idempotencyKey: `${entry.idempotencyKey}:${channelId}`,
        status,
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      } satisfies InventoryOutboxJob);

      if (status === 'pending') jobsCreated += 1;
      else jobsBlockedByMissingMapping += 1;
    }
  });

  return {
    duplicate,
    ledgerId,
    jobsCreated: duplicate ? 0 : jobsCreated,
    jobsBlockedByMissingMapping: duplicate ? 0 : jobsBlockedByMissingMapping,
  };
};
