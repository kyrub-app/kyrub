import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import {
  advanceOmnichannelCursor,
  type OmnichannelSyncCursor,
  type OmnichannelSyncDirection,
  type OmnichannelSyncEntityType,
} from '../../src/utils/omnichannelSyncEngine';
import { adminDb } from '../firebaseAdmin';

const CURSOR_COLLECTION = 'integrationSyncCursors';

export interface OmnichannelSyncCursorScope {
  storeId: string;
  channelId: string;
  direction: OmnichannelSyncDirection;
  entityType: OmnichannelSyncEntityType;
}

interface StoredOmnichannelSyncCursor extends OmnichannelSyncCursor {
  storeId: string;
  channelId: string;
  direction: OmnichannelSyncDirection;
  entityType: OmnichannelSyncEntityType;
  createdAt?: unknown;
}

const required = (label: string, value: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
};

const normalizeScope = (
  scope: OmnichannelSyncCursorScope
): OmnichannelSyncCursorScope => ({
  storeId: required('store id', scope.storeId),
  channelId: required('channel id', scope.channelId),
  direction: scope.direction,
  entityType: scope.entityType,
});

export const getOmnichannelSyncCursorDocumentId = (
  scope: OmnichannelSyncCursorScope
): string => {
  const normalized = normalizeScope(scope);
  return createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex');
};

const cursorReference = (scope: OmnichannelSyncCursorScope) =>
  adminDb.doc(
    `${CURSOR_COLLECTION}/${getOmnichannelSyncCursorDocumentId(scope)}`
  );

const parseStoredCursor = (
  value: unknown,
  scope: OmnichannelSyncCursorScope
): StoredOmnichannelSyncCursor | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.storeId !== scope.storeId ||
    candidate.channelId !== scope.channelId ||
    candidate.direction !== scope.direction ||
    candidate.entityType !== scope.entityType ||
    typeof candidate.checkpoint !== 'string' ||
    typeof candidate.observedAtMs !== 'number'
  ) {
    return null;
  }

  return candidate as unknown as StoredOmnichannelSyncCursor;
};

export const getOmnichannelSyncCursor = async (
  scopeInput: OmnichannelSyncCursorScope
): Promise<OmnichannelSyncCursor | null> => {
  const scope = normalizeScope(scopeInput);
  const snapshot = await cursorReference(scope).get();
  const stored = parseStoredCursor(snapshot.data(), scope);
  if (!stored) return null;
  return {
    checkpoint: stored.checkpoint,
    observedAtMs: stored.observedAtMs,
  };
};

export const advancePersistedOmnichannelSyncCursor = async (
  scopeInput: OmnichannelSyncCursorScope,
  next: OmnichannelSyncCursor
): Promise<OmnichannelSyncCursor> => {
  const scope = normalizeScope(scopeInput);
  const reference = cursorReference(scope);

  return adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    const stored = parseStoredCursor(snapshot.data(), scope);
    const current = stored
      ? { checkpoint: stored.checkpoint, observedAtMs: stored.observedAtMs }
      : null;
    const advanced = advanceOmnichannelCursor(current, next);

    transaction.set(reference, {
      ...scope,
      ...advanced,
      createdAt: stored?.createdAt ?? FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return advanced;
  });
};
