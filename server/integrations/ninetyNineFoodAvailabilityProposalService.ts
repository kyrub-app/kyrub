import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin';
import { resolveActiveNinetyNineFoodProductBinding } from './ninetyNineFoodProductBindingService';

const PROVIDER = '99food' as const;
const SNAPSHOT_AUTHORITY = 'kyrub_inventory_reservation_policy_snapshot' as const;
const PROPOSAL_AUTHORITY = 'kyrub_channel_availability_snapshot_and_store_owner_mapping' as const;

const clean = (value: unknown, maximum = 500): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().slice(0, maximum)
    : '';

const nonNegativeInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;

const proposalIdFor = (input: {
  canonicalStoreId: string;
  externalStoreId: string;
  externalProductId: string;
  snapshotId: string;
  sourceFingerprint: string;
  targetAvailableQuantity: number;
}): string => `99fav_${createHash('sha256')
  .update([
    input.canonicalStoreId,
    input.externalStoreId,
    input.externalProductId,
    input.snapshotId,
    input.sourceFingerprint,
    String(input.targetAvailableQuantity),
  ].join(':'))
  .digest('hex')
  .slice(0, 40)}`;

const proposalPath = (canonicalStoreId: string, proposalId: string): string =>
  `stores/${canonicalStoreId}/ninetyNineFoodAvailabilityProposals/${proposalId}`;

export interface NinetyNineFoodAvailabilityProposal {
  schemaVersion: 1;
  id: string;
  provider: typeof PROVIDER;
  tenantId: string;
  canonicalStoreId: string;
  externalStoreId: string;
  externalProductId: string;
  canonicalProductId: string;
  bindingId: string;
  channelAvailabilitySnapshotId: string;
  channelAvailabilitySourceFingerprint: string;
  policyRevision: number;
  availableToPromiseUnits: number;
  targetAvailableQuantity: number;
  status: 'review_required';
  executionStatus: 'not_authorized';
  providerReadStatus: 'not_requested';
  authority: typeof PROPOSAL_AUTHORITY;
  proposedByUserId: string;
  proposedAt: string;
}

const assertSnapshot = (input: {
  canonicalStoreId: string;
  canonicalProductId: string;
  snapshotId: string;
  ownerUserId: string;
  value: unknown;
}): {
  sourceFingerprint: string;
  policyRevision: number;
  availableToPromiseUnits: number;
  publishableUnits: number;
} => {
  if (!input.value || typeof input.value !== 'object' || Array.isArray(input.value)) {
    throw new Error('NINETY_NINE_FOOD_AVAILABILITY_SNAPSHOT_NOT_FOUND');
  }
  const snapshot = input.value as Record<string, unknown>;
  const policyRevision = nonNegativeInteger(snapshot.policyRevision);
  const availableToPromiseUnits = nonNegativeInteger(snapshot.availableToPromiseUnits);
  const publishableUnits = nonNegativeInteger(snapshot.publishableUnits);
  const sourceFingerprint = clean(snapshot.sourceFingerprint, 128);
  if (
    clean(snapshot.snapshotId, 160) !== input.snapshotId ||
    clean(snapshot.storeId, 160) !== input.canonicalStoreId ||
    clean(snapshot.productId, 160) !== input.canonicalProductId ||
    clean(snapshot.channel, 80) !== PROVIDER ||
    clean(snapshot.authority, 120) !== SNAPSHOT_AUTHORITY ||
    clean(snapshot.inventoryAuthorityOwnerUserId, 160) !== input.ownerUserId ||
    !sourceFingerprint ||
    policyRevision === null || policyRevision < 1 ||
    availableToPromiseUnits === null ||
    publishableUnits === null
  ) {
    throw new Error('NINETY_NINE_FOOD_AVAILABILITY_SNAPSHOT_INVALID');
  }
  return {
    sourceFingerprint,
    policyRevision,
    availableToPromiseUnits,
    publishableUnits,
  };
};

export const createNinetyNineFoodAvailabilityProposal = async (input: {
  tenantId: string;
  externalProductId: string;
  channelAvailabilitySnapshotId: string;
  proposedByUserId: string;
}): Promise<{ proposal: NinetyNineFoodAvailabilityProposal; alreadyExisted: boolean }> => {
  const tenantId = clean(input.tenantId, 160);
  const externalProductId = clean(input.externalProductId, 500);
  const snapshotId = clean(input.channelAvailabilitySnapshotId, 160);
  const proposedByUserId = clean(input.proposedByUserId, 160);
  if (!tenantId || !externalProductId || !snapshotId || proposedByUserId !== tenantId) {
    throw new Error('NINETY_NINE_FOOD_AVAILABILITY_PROPOSAL_INPUT_INVALID');
  }

  const binding = await resolveActiveNinetyNineFoodProductBinding({ tenantId, externalProductId });
  if (!binding) throw new Error('NINETY_NINE_FOOD_AVAILABILITY_ACTIVE_BINDING_REQUIRED');

  const snapshotReference = adminDb.doc(
    `stores/${binding.canonicalStoreId}/channelAvailabilitySnapshots/${snapshotId}`
  );
  const snapshotDocument = await snapshotReference.get();
  if (!snapshotDocument.exists) {
    throw new Error('NINETY_NINE_FOOD_AVAILABILITY_SNAPSHOT_NOT_FOUND');
  }
  const snapshot = assertSnapshot({
    canonicalStoreId: binding.canonicalStoreId,
    canonicalProductId: binding.canonicalProductId,
    snapshotId,
    ownerUserId: proposedByUserId,
    value: snapshotDocument.data(),
  });

  const proposalId = proposalIdFor({
    canonicalStoreId: binding.canonicalStoreId,
    externalStoreId: binding.externalStoreId,
    externalProductId: binding.externalProductId,
    snapshotId,
    sourceFingerprint: snapshot.sourceFingerprint,
    targetAvailableQuantity: snapshot.publishableUnits,
  });
  const reference = adminDb.doc(proposalPath(binding.canonicalStoreId, proposalId));
  let alreadyExisted = false;
  let proposal: NinetyNineFoodAvailabilityProposal | null = null;

  await adminDb.runTransaction(async transaction => {
    const existing = await transaction.get(reference);
    if (existing.exists) {
      const data = existing.data() as NinetyNineFoodAvailabilityProposal;
      if (
        data.provider !== PROVIDER ||
        data.tenantId !== tenantId ||
        data.externalProductId !== externalProductId ||
        data.channelAvailabilitySnapshotId !== snapshotId ||
        data.channelAvailabilitySourceFingerprint !== snapshot.sourceFingerprint ||
        data.targetAvailableQuantity !== snapshot.publishableUnits
      ) {
        throw new Error('NINETY_NINE_FOOD_AVAILABILITY_PROPOSAL_CONFLICT');
      }
      alreadyExisted = true;
      proposal = data;
      return;
    }

    const now = new Date().toISOString();
    const document: NinetyNineFoodAvailabilityProposal = {
      schemaVersion: 1,
      id: proposalId,
      provider: PROVIDER,
      tenantId,
      canonicalStoreId: binding.canonicalStoreId,
      externalStoreId: binding.externalStoreId,
      externalProductId: binding.externalProductId,
      canonicalProductId: binding.canonicalProductId,
      bindingId: binding.id,
      channelAvailabilitySnapshotId: snapshotId,
      channelAvailabilitySourceFingerprint: snapshot.sourceFingerprint,
      policyRevision: snapshot.policyRevision,
      availableToPromiseUnits: snapshot.availableToPromiseUnits,
      targetAvailableQuantity: snapshot.publishableUnits,
      status: 'review_required',
      executionStatus: 'not_authorized',
      providerReadStatus: 'not_requested',
      authority: PROPOSAL_AUTHORITY,
      proposedByUserId,
      proposedAt: now,
    };
    transaction.create(reference, {
      ...document,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    proposal = document;
  });

  if (!proposal) throw new Error('NINETY_NINE_FOOD_AVAILABILITY_PROPOSAL_FAILED');
  return { proposal, alreadyExisted };
};

export const listNinetyNineFoodAvailabilityProposals = async (input: {
  tenantId: string;
  requestedByUserId: string;
}): Promise<NinetyNineFoodAvailabilityProposal[]> => {
  const tenantId = clean(input.tenantId, 160);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  if (!tenantId || requestedByUserId !== tenantId) {
    throw new Error('NINETY_NINE_FOOD_AVAILABILITY_PROPOSAL_FORBIDDEN');
  }
  const tenant = await adminDb.doc(`tenants/${tenantId}`).get();
  const canonicalStoreId = clean(tenant.data()?.canonicalStoreId, 160);
  if (!canonicalStoreId) throw new Error('NINETY_NINE_FOOD_AVAILABILITY_CANONICAL_STORE_REQUIRED');
  const snapshot = await adminDb
    .collection(`stores/${canonicalStoreId}/ninetyNineFoodAvailabilityProposals`)
    .get();
  return snapshot.docs.flatMap(document => {
    const value = document.data() as Partial<NinetyNineFoodAvailabilityProposal>;
    return value.provider === PROVIDER && value.tenantId === tenantId
      ? [value as NinetyNineFoodAvailabilityProposal]
      : [];
  }).sort((left, right) => right.proposedAt.localeCompare(left.proposedAt));
};
