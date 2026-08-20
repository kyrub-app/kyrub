import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import {
  decideOmnichannelReconciliation,
  type OmnichannelSyncEntityType,
  type OmnichannelVersionState,
} from '../../src/utils/omnichannelSyncEngine';
import { adminDb } from '../firebaseAdmin';

const DIVERGENCE_COLLECTION = 'integrationSyncDivergences';

export interface OmnichannelDivergenceInput {
  storeId: string;
  channelId: string;
  entityType: OmnichannelSyncEntityType;
  canonicalId: string;
  externalId: string;
  versions: OmnichannelVersionState;
}

const required = (label: string, value: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
};

const normalizeInput = (
  input: OmnichannelDivergenceInput
): OmnichannelDivergenceInput => ({
  ...input,
  storeId: required('store id', input.storeId),
  channelId: required('channel id', input.channelId),
  canonicalId: required('canonical id', input.canonicalId),
  externalId: required('external id', input.externalId),
});

export const getOmnichannelDivergenceDocumentId = (
  input: OmnichannelDivergenceInput
): string => {
  const normalized = normalizeInput(input);
  return createHash('sha256')
    .update(JSON.stringify({
      storeId: normalized.storeId,
      channelId: normalized.channelId,
      entityType: normalized.entityType,
      canonicalId: normalized.canonicalId,
      externalId: normalized.externalId,
      canonicalVersion: normalized.versions.canonicalVersion,
      externalVersion: normalized.versions.externalVersion,
    }))
    .digest('hex');
};

export const recordOmnichannelDivergenceIfNeeded = async (
  input: OmnichannelDivergenceInput
): Promise<{ conflict: boolean; divergenceId: string | null }> => {
  const normalized = normalizeInput(input);
  const action = decideOmnichannelReconciliation(normalized.versions);
  if (action !== 'conflict') {
    return { conflict: false, divergenceId: null };
  }

  const divergenceId = getOmnichannelDivergenceDocumentId(normalized);
  const reference = adminDb.doc(`${DIVERGENCE_COLLECTION}/${divergenceId}`);

  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    transaction.set(reference, {
      id: divergenceId,
      storeId: normalized.storeId,
      channelId: normalized.channelId,
      entityType: normalized.entityType,
      canonicalId: normalized.canonicalId,
      externalId: normalized.externalId,
      canonicalVersion: normalized.versions.canonicalVersion,
      externalVersion: normalized.versions.externalVersion,
      lastSyncedCanonicalVersion:
        normalized.versions.lastSyncedCanonicalVersion,
      lastSyncedExternalVersion:
        normalized.versions.lastSyncedExternalVersion,
      status: 'open',
      firstSeenAt: snapshot.data()?.firstSeenAt ?? FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp(),
      occurrences: FieldValue.increment(1),
    }, { merge: true });
  });

  return { conflict: true, divergenceId };
};
