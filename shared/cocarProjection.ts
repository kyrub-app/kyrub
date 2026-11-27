import { kyrubXpTotal, type KyrubXpEntry } from './gamification.js';

export type CocarProjection = {
  schemaVersion: 1;
  userId: string;
  epoch: string;
  total: number;
  entryCount: number;
  absoluteMagnitude: number;
  hasNegative: boolean;
  lastDocumentId: string;
};
type LedgerRow = KyrubXpEntry & { economy: string };
const safeId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(v);
const nonnegative = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export function validCocarProjection(value: unknown, uid: string, epoch: string): value is CocarProjection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as CocarProjection;
  return Object.keys(p).length === 8 && p.schemaVersion === 1 &&
    safeId(uid) && safeId(epoch) && p.userId === uid && p.epoch === epoch &&
    nonnegative(p.total) && nonnegative(p.entryCount) && nonnegative(p.absoluteMagnitude) &&
    p.total <= p.absoluteMagnitude && typeof p.hasNegative === 'boolean' &&
    (p.hasNegative || p.total === p.absoluteMagnitude) &&
    (p.entryCount === 0 ? p.lastDocumentId === '' && p.total === 0 && p.absoluteMagnitude === 0 && !p.hasNegative : safeId(p.lastDocumentId));
}
function checkedRow(uid: string, documentId: string, row: LedgerRow): void {
  if (!safeId(documentId) || row.id !== documentId || row.userId !== uid ||
      row.economy !== 'kyrub_xp' || !Number.isFinite(Date.parse(row.occurredAt)) ||
      !Number.isSafeInteger(row.deltaXp)) throw Error('COCAR_LEDGER_INVALID');
  kyrubXpTotal([row]);
}
/** Rebuild from a complete, consistent ledger snapshot in document-ID order.
 * ASCII IDs make this ordering identical to Firestore's document key order.
 * Unsupported IDs and malformed histories must remain on the exact read path.
 */
export function rebuildCocarProjection(uid: string, epoch: string, rows: readonly { documentId: string; entry: LedgerRow }[]): CocarProjection {
  let p: CocarProjection = { schemaVersion: 1, userId: uid, epoch, total: 0, entryCount: 0, absoluteMagnitude: 0, hasNegative: false, lastDocumentId: '' };
  if (!validCocarProjection(p, uid, epoch)) throw Error('COCAR_PROJECTION_SCOPE_INVALID');
  const seen = new Set<string>();
  for (const {documentId, entry} of rows) {
    checkedRow(uid, documentId, entry);
    if (documentId <= p.lastDocumentId || seen.has(entry.idempotencyKey)) throw Error('COCAR_LEDGER_ORDER_OR_KEY_INVALID');
    seen.add(entry.idempotencyKey);
    const next = advanceCocarProjection(p, uid, epoch, documentId, entry);
    if (!next) throw Error('COCAR_LEDGER_INVALID');
    p = next;
  }
  return p;
}
/** Pure transition, NOT a write authorization or duplicate detector.
 * Call ONLY after the writer has proven a genuinely new entry and global
 * per-user key uniqueness in the same transaction. Replay must skip this.
 * null requires invalidation in that transaction, not reuse of the old total.
 */
export function advanceCocarProjection(p: unknown, uid: string, epoch: string, documentId: string, row: LedgerRow): CocarProjection | null {
  if (!validCocarProjection(p, uid, epoch)) return null;
  try { checkedRow(uid, documentId, row); } catch { return null; }
  // Negative adjustments make the canonical zero floor order-sensitive.
  // An insertion anywhere is safe only when every delta is nonnegative.
  if ((p.hasNegative || row.deltaXp < 0) && documentId <= p.lastDocumentId) return null;
  const next: CocarProjection = {
    ...p,
    total: Math.max(0, p.total + row.deltaXp),
    entryCount: p.entryCount + 1,
    absoluteMagnitude: p.absoluteMagnitude + Math.abs(row.deltaXp),
    hasNegative: p.hasNegative || row.deltaXp < 0,
    lastDocumentId: documentId > p.lastDocumentId ? documentId : p.lastDocumentId,
  };
  return validCocarProjection(next, uid, epoch) ? next : null;
}
