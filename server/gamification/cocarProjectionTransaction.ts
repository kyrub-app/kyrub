import { getApps } from 'firebase-admin/app';
import { getFirestore, FieldPath, type DocumentReference, type Firestore, type Transaction, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { advanceCocarProjection, rebuildCocarProjection, validCocarProjection, type CocarProjection } from '../../shared/cocarProjection.js';
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
/** Explicit, per-user history reconciliation under the isolated fixture gate.
 * All pages are read within one Firestore transaction, so a concurrent grant
 * forces a retry instead of publishing an obsolete projection. Page size is
 * not a lifetime XP cap. No batch across users, no client endpoint.
 * Very large histories can exceed Firestore transaction limits: never mark a
 * partial history certified; a resumable fenced migration is a separate gate.
 */
export async function reconcileCocarProjectionFixture(db: Firestore, uid: string, mode: 'preview' | 'apply') {
  const epoch = candidateEpoch(db);
  if (!epoch) throw Error('COCAR_PROJECTION_EMULATOR_ONLY');
  if (mode !== 'preview' && mode !== 'apply') throw Error('COCAR_PROJECTION_MODE_INVALID');
  const ref = projectionRef(db,uid);
  return db.runTransaction(async tx => {
    const current = await tx.get(ref);
    const pageSize = 128;
    const query = db.collection('users/'+uid+'/xpLedger').orderBy(FieldPath.documentId()).limit(pageSize);
    const rows: {documentId:string;entry:Row}[] = [];
    let cursor: QueryDocumentSnapshot | undefined;
    for (;;) {
      const page = await tx.get(cursor ? query.startAfter(cursor) : query);
      for (const doc of page.docs) rows.push({documentId:doc.id,entry:doc.data() as Row});
      if (page.size < pageSize) break;
      cursor = page.docs[page.docs.length-1];
    }
    let p: CocarProjection;
    try {
      p = rebuildCocarProjection(uid,epoch,rows);
    } catch {
      // A proven invalid history cannot keep a previously certified total.
      // Preview remains strictly read-only; apply removes only the derived
      // document, not one entry of the canonical ledger.
      if (mode === 'apply' && current.exists) tx.delete(ref);
      return {status:'invalid' as const, projection:null, changed:mode==='apply' && current.exists};
    }
    const old = current.data();
    const matches = validCocarProjection(old,uid,epoch) &&
      (Object.keys(p) as (keyof CocarProjection)[]).every(key=>old[key]===p[key]);
    if (mode === 'apply' && !matches) tx.set(ref,p);
    return {status:matches?'unchanged' as const:'reconciled' as const, projection:p, changed:mode==='apply' && !matches};
  });
}
/** Backwards-compatible fixture entry point. Invalid history is reported
 * only after the transaction has committed any necessary invalidation. */
export async function rebuildCocarProjectionFixture(db: Firestore, uid: string) {
  const result = await reconcileCocarProjectionFixture(db,uid,'apply');
  if (!result.projection) throw Error('COCAR_LEDGER_ORDER_OR_KEY_INVALID');
  return result.projection;
}
