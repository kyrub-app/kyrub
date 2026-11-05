import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { kyrubXpTotal, type KyrubXpEntry } from '../../shared/gamification.js';

const safeId = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(normalized)) throw new Error(`${label}_INVALID`);
  return normalized;
};

/** Called only by trusted, event-validating server code. Never expose as an unauthenticated public endpoint. */
export const persistVerifiedKyrubXp = async (input: {
  userId: string;
  sourceType: KyrubXpEntry['sourceType'];
  sourceId: string;
  deltaXp: number;
  correlationId: string;
  idempotencyKey: string;
  occurredAt: string;
}): Promise<KyrubXpEntry> => {
  const userId = safeId(input.userId, 'XP_USER');
  const sourceId = safeId(input.sourceId, 'XP_SOURCE');
  const idempotencyKey = safeId(input.idempotencyKey, 'XP_IDEMPOTENCY');
  const correlationId = safeId(input.correlationId, 'XP_CORRELATION');
  if (!['challenge', 'achievement', 'community', 'admin_adjustment'].includes(input.sourceType)) {
    throw new Error('XP_SOURCE_TYPE_INVALID');
  }
  if (!Number.isSafeInteger(input.deltaXp) || input.deltaXp <= 0) throw new Error('XP_DELTA_INVALID');
  if (!Number.isFinite(Date.parse(input.occurredAt))) throw new Error('XP_DATE_INVALID');
  const id = `xp_${idempotencyKey}`;
  const entry: KyrubXpEntry = {
    id, userId, sourceType: input.sourceType, sourceId,
    deltaXp: input.deltaXp, correlationId, idempotencyKey,
    occurredAt: input.occurredAt,
  };
  const ref = adminDb.doc(`users/${userId}/xpLedger/${id}`);
  return adminDb.runTransaction(async transaction => {
    const existing = await transaction.get(ref);
    if (existing.exists) {
      const previous = existing.data() as KyrubXpEntry;
      if (JSON.stringify(previous && {
        id: previous.id, userId: previous.userId, sourceType: previous.sourceType,
        sourceId: previous.sourceId, deltaXp: previous.deltaXp,
        correlationId: previous.correlationId, idempotencyKey: previous.idempotencyKey,
        occurredAt: previous.occurredAt,
      }) !== JSON.stringify(entry)) throw new Error('XP_IDEMPOTENCY_CONFLICT');
      return entry;
    }
    transaction.create(ref, { ...entry, economy: 'kyrub_xp', persistedAt: FieldValue.serverTimestamp() });
    return entry;
  });
};

export const readVerifiedKyrubXpTotal = async (userId: string): Promise<{ total: number | null; entryCount: number }> => {
  const normalizedUserId = safeId(userId, 'XP_USER');
  const snapshot = await adminDb.collection(`users/${normalizedUserId}/xpLedger`).get();
  const entries = snapshot.docs.map(doc => {
    const entry = doc.data() as KyrubXpEntry;
    if (entry.id !== doc.id || entry.userId !== normalizedUserId) throw new Error('XP_LEDGER_SCOPE_INVALID');
    return entry;
  });
  return { total: entries.length ? kyrubXpTotal(entries) : null, entryCount: entries.length };
};
