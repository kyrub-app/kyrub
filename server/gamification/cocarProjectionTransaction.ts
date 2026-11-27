import { getApps } from 'firebase-admin/app';
import { getFirestore, FieldPath, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { advanceCocarProjection, rebuildCocarProjection, validCocarProjection } from '../../shared/cocarProjection.js';
import type { KyrubXpEntry } from '../../shared/gamification.js';

type Row = KyrubXpEntry & { economy: string };
const noop = () => {};
const flag = 'KYRUB_COCAR_PROJECTION_TEST_ONLY';
function candidateEpoch(db: Firestore): string | null {
  if (process.env[flag] !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.KYRUB_FREELANCE_LOCAL_HOMOLOGATION !== 'true' ||
      process.env.VERCEL || process.env.VERCEL_ENV || process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8088' ||
      process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' ||
      process.env.FIREBASE_PROJECT_ID !== 'kyrub-security-test' ||
      process.env.GCLOUD_PROJECT !== 'kyrub-security-test' ||
      process.env.GOOGLE_CLOUD_PROJECT !== 'kyrub-security-test' ||
      !getApps().some(app => app.options.projectId === 'kyrub-security-test' && getFirestore(app) === db)) return null;
  const epoch = process.env.KYRUB_COCAR_PROJECTION_TEST_EPOCH;
  return epoch && /^[A-Za-z0-9_-]{1,128}$/.test(epoch) ? epoch : null;
}
function projectionRef(db: Firestore, uid: string) {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(uid)) throw Error('COCAR_PROJECTION_USER_INVALID');
  return db.doc('users/'+uid+'/cocarProjectionV1/current');
}
/** Call only after the original writer has verified a new grant, never on replay.
 * Prepare before any transaction writes; execute returned closure after other
 * reads. An absent projection stays absent. Never expose this candidate to
 * the public read path; the epoch is a fixture, not evidence of writer coverage.
 */
export async function prepareCocarProjectionForNewXp(tx: Transaction, ledgerRef: DocumentReference, row: Row): Promise<() => void> {
  if (process.env[flag] !== 'true') return noop;
  const db = ledgerRef.firestore;
  const epoch = candidateEpoch(db);
  if (!epoch) return noop;
  if (ledgerRef.path !== 'users/'+row.userId+'/xpLedger/'+row.id) throw Error('COCAR_PROJECTION_REFERENCE_INVALID');
  const ref = projectionRef(db,row.userId);
  const saved = await tx.get(ref);
  if (!saved.exists) return noop;
  if (!validCocarProjection(saved.data(),row.userId,epoch)) return () => { tx.delete(ref); };
  // Ledger IDs alone do not guarantee globally unique idempotency keys.
  const existing = await tx.get(ledgerRef.parent.where('idempotencyKey','==',row.idempotencyKey).limit(1));
  const next = existing.empty ? advanceCocarProjection(saved.data(),row.userId,epoch,ledgerRef.id,row) : null;
  return next ? () => { tx.set(ref,next); } : () => { tx.delete(ref); };
}
/** One-time explicit rebuild for emulator fixtures, not a public API.
 * No automatic migration or production writes. Caller must rotate the epoch
 * and rebuild after any interval with unobserved writers.
 */
export async function rebuildCocarProjectionFixture(db: Firestore, uid: string) {
  const epoch = candidateEpoch(db);
  if (!epoch) throw Error('COCAR_PROJECTION_EMULATOR_ONLY');
  const ref = projectionRef(db,uid);
  return db.runTransaction(async tx => {
    const ledger = await tx.get(db.collection('users/'+uid+'/xpLedger').orderBy(FieldPath.documentId()));
    const p = rebuildCocarProjection(uid,epoch,ledger.docs.map(d=>({documentId:d.id,entry:d.data() as Row})));
    tx.set(ref,p);
    return p;
  });
}
