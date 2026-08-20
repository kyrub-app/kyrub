import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin';
import {
  buildExternalIdentityMapping,
  type ExternalIdentityMapping,
  type ExternalIdentityEntityType,
} from '../../src/utils/externalIdentityMapping';
import type { StoreIntegrationId } from '../../src/utils/storeOperationalSettings';

const MAPPING_COLLECTION = 'externalIdentityMappings';
const LOOKUP_COLLECTION = 'externalIdentityLookup';

interface StoredExternalIdentityMapping extends ExternalIdentityMapping {
  id: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

interface ExternalIdentityLookupDocument {
  storeId: string;
  channelId: StoreIntegrationId;
  entityType: ExternalIdentityEntityType;
  canonicalId: string;
  externalId: string;
  mappingPath: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

const stableHash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

export const externalIdentityMappingDocumentId = (
  mapping: ExternalIdentityMapping
): string => {
  const normalized = buildExternalIdentityMapping(mapping);
  return stableHash([
    normalized.channelId,
    normalized.entityType,
    normalized.canonicalId,
  ].join('\u0000'));
};

export const externalIdentityLookupDocumentId = (
  mapping: ExternalIdentityMapping
): string => {
  const normalized = buildExternalIdentityMapping(mapping);
  return stableHash([
    normalized.storeId,
    normalized.channelId,
    normalized.entityType,
    normalized.externalId,
  ].join('\u0000'));
};

const mappingPath = (mapping: ExternalIdentityMapping): string =>
  `stores/${mapping.storeId}/${MAPPING_COLLECTION}/${externalIdentityMappingDocumentId(mapping)}`;

const lookupPath = (mapping: ExternalIdentityMapping): string =>
  `${LOOKUP_COLLECTION}/${externalIdentityLookupDocumentId(mapping)}`;

const assertOwnerOrManager = async (
  transaction: FirebaseFirestore.Transaction,
  storeId: string,
  actorUserId: string
): Promise<void> => {
  const storeRef = adminDb.doc(`stores/${storeId}`);
  const memberRef = adminDb.doc(`stores/${storeId}/members/${actorUserId}`);
  const [storeSnapshot, memberSnapshot] = await Promise.all([
    transaction.get(storeRef),
    transaction.get(memberRef),
  ]);

  if (!storeSnapshot.exists) {
    throw new Error('STORE_NOT_FOUND');
  }

  const storeData = storeSnapshot.data() ?? {};
  if (storeData.ownerId === actorUserId) return;

  const memberData = memberSnapshot.data() ?? {};
  if (memberData.status === 'active' && memberData.role === 'manager') return;

  throw new Error('FORBIDDEN');
};

const parseStoredMapping = (value: unknown): StoredExternalIdentityMapping | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.storeId !== 'string' ||
    typeof candidate.channelId !== 'string' ||
    typeof candidate.entityType !== 'string' ||
    typeof candidate.canonicalId !== 'string' ||
    typeof candidate.externalId !== 'string'
  ) {
    return null;
  }

  try {
    const normalized = buildExternalIdentityMapping(candidate as unknown as ExternalIdentityMapping);
    return {
      ...normalized,
      id: candidate.id,
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
    };
  } catch {
    return null;
  }
};

export const persistExternalIdentityMapping = async (
  actorUserId: string,
  input: ExternalIdentityMapping
): Promise<ExternalIdentityMapping> => {
  const mapping = buildExternalIdentityMapping(input);
  const actorId = actorUserId.trim();
  if (!actorId) throw new Error('AUTH_REQUIRED');

  await adminDb.runTransaction(async transaction => {
    await assertOwnerOrManager(transaction, mapping.storeId, actorId);

    const canonicalRef = adminDb.doc(mappingPath(mapping));
    const reverseRef = adminDb.doc(lookupPath(mapping));
    const [canonicalSnapshot, reverseSnapshot] = await Promise.all([
      transaction.get(canonicalRef),
      transaction.get(reverseRef),
    ]);

    const previous = parseStoredMapping(canonicalSnapshot.data());
    const reverseData = reverseSnapshot.data() as
      | ExternalIdentityLookupDocument
      | undefined;

    if (
      reverseSnapshot.exists &&
      (
        reverseData?.storeId !== mapping.storeId ||
        reverseData?.channelId !== mapping.channelId ||
        reverseData?.entityType !== mapping.entityType ||
        reverseData?.canonicalId !== mapping.canonicalId
      )
    ) {
      throw new Error('EXTERNAL_ID_COLLISION');
    }

    if (previous && previous.externalId !== mapping.externalId) {
      const previousLookupRef = adminDb.doc(lookupPath(previous));
      if (previousLookupRef.path !== reverseRef.path) {
        const previousLookupSnapshot = await transaction.get(previousLookupRef);
        const previousLookup = previousLookupSnapshot.data() as
          | ExternalIdentityLookupDocument
          | undefined;
        if (
          previousLookupSnapshot.exists &&
          previousLookup?.canonicalId === mapping.canonicalId &&
          previousLookup?.storeId === mapping.storeId
        ) {
          transaction.delete(previousLookupRef);
        }
      }
    }

    const now = FieldValue.serverTimestamp();
    transaction.set(canonicalRef, {
      id: canonicalRef.id,
      ...mapping,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    });

    transaction.set(reverseRef, {
      storeId: mapping.storeId,
      channelId: mapping.channelId,
      entityType: mapping.entityType,
      canonicalId: mapping.canonicalId,
      externalId: mapping.externalId,
      mappingPath: canonicalRef.path,
      createdAt: reverseData?.createdAt ?? now,
      updatedAt: now,
    });
  });

  return mapping;
};

export const resolveCanonicalIdentityFromExternal = async (input: {
  storeId: string;
  channelId: StoreIntegrationId;
  entityType: ExternalIdentityEntityType;
  externalId: string;
}): Promise<string | null> => {
  const probe = buildExternalIdentityMapping({
    ...input,
    canonicalId: '__lookup__',
  });
  const snapshot = await adminDb.doc(lookupPath(probe)).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() as ExternalIdentityLookupDocument | undefined;
  if (
    data?.storeId !== probe.storeId ||
    data?.channelId !== probe.channelId ||
    data?.entityType !== probe.entityType ||
    data?.externalId !== probe.externalId
  ) {
    throw new Error('EXTERNAL_ID_LOOKUP_CORRUPTED');
  }
  return data.canonicalId;
};
