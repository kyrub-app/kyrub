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
  const migration = process.env.KYRUB_COCAR_MIGRATION_FIXTURE_UID === row.userId ? ref.parent.doc('migration') : null;
  const checkpoint = migration ? await tx.get(migration) : null;
  const invalidateMigration = () => { if (migration && checkpoint?.exists) tx.delete(migration); };
  const saved = await tx.get(ref);
  if (!saved.exists) return invalidateMigration;
  if (!validCocarProjection(saved.data(),row.userId,epoch)) return () => { invalidateMigration(); tx.delete(ref); };
  // Ledger IDs alone do not guarantee globally unique idempotency keys.
  const existing = await tx.get(ledgerRef.parent.where('idempotencyKey','==',row.idempotencyKey).limit(1));
  const next = existing.empty ? advanceCocarProjection(saved.data(),row.userId,epoch,ledgerRef.id,row) : null;
  return () => { invalidateMigration(); if (next) tx.set(ref,next); else tx.delete(ref); };
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


/** Isolated read-path experiment. Only a deliberately enrolled fixture UID
 * can use the candidate, and the test harness must guarantee no unobserved
 * writes for that epoch. Neither a flag nor a fixture epoch certifies real
 * deployed writer coverage. Missing/invalid projections return null so the
 * caller can reconstruct from the canonical ledger. No public endpoint.
 */
export async function readCocarProjectionFixtureInTransaction(tx: Transaction, db: Firestore, uid: string): Promise<number|null> {
  if (process.env.KYRUB_COCAR_PROJECTION_READ_TEST_ONLY !== 'true' ||
      process.env.KYRUB_COCAR_PROJECTION_READ_FIXTURE_UID !== uid) return null;
  const epoch = candidateEpoch(db);
  if (!epoch) return null;
  const saved = (await tx.get(projectionRef(db,uid))).data();
  return validCocarProjection(saved,uid,epoch) ? saved.total : null;
}


type MigrationCheckpoint = {
  runId: string; epoch: string; userId: string; phase: 'ledger'|'keys';
  candidate: CocarProjection; keyCount: number; lastKey: string; lastKeyId: string;
};
function migrationScope(db: Firestore, uid: string, runId: string) {
  const epoch = candidateEpoch(db);
  if (!epoch || process.env.KYRUB_COCAR_MIGRATION_FIXTURE_UID !== uid ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(runId)) throw Error('COCAR_MIGRATION_EMULATOR_ONLY');
  const ref = projectionRef(db,uid);
  return {epoch,ref,checkpoint:ref.parent.doc('migration'),ledger:db.collection('users/'+uid+'/xpLedger')};
}
/** Explicit fixture enrollment only. A new grant atomically deletes the
 * checkpoint via the four observed writers; the caller starts a fresh run.
 * Never lock the ledger or deny a grant. Not evidence of external coverage.
 */
export async function startCocarMigrationFixture(db: Firestore, uid: string, runId: string) {
  const {epoch,ref,checkpoint}=migrationScope(db,uid,runId);
  return db.runTransaction(async tx=>{
    const existing=await tx.get(checkpoint);
    if(existing.exists)throw Error('COCAR_MIGRATION_ALREADY_RUNNING');
    const state:MigrationCheckpoint={runId,epoch,userId:uid,phase:'ledger',candidate:rebuildCocarProjection(uid,epoch,[]),keyCount:0,lastKey:'',lastKeyId:''};
    tx.delete(ref);
    tx.create(checkpoint,state);
    return {status:'started' as const};
  });
}
/** Read at most 64 rows per transaction. Pass one folds in document order;
 * pass two verifies globally unique idempotency keys in key order, including
 * across page boundaries. Publish only after both passes finish. Checkpoint
 * identity is bound to UID, epoch and runId. No direct fixture edits allowed
 * between steps; all real writers would need an independently certified fence.
 */
export async function stepCocarMigrationFixture(db: Firestore,uid:string,runId:string) {
  const {epoch,ref,checkpoint,ledger}=migrationScope(db,uid,runId);
  return db.runTransaction(async tx=>{
    const snap=await tx.get(checkpoint);
    if(!snap.exists)return {status:'restart_required' as const};
    const s=snap.data() as MigrationCheckpoint;
    if(s.runId!==runId||s.epoch!==epoch||s.userId!==uid)return {status:'restart_required' as const};
    const invalid=()=>{tx.delete(checkpoint);tx.delete(ref);return {status:'invalid' as const};};
    if(!validCocarProjection(s.candidate,uid,epoch)||
       !Number.isSafeInteger(s.keyCount)||s.keyCount<0||s.keyCount>s.candidate.entryCount||
       typeof s.lastKey!=='string'||typeof s.lastKeyId!=='string'||
       (s.keyCount===0?(s.lastKey!==''||s.lastKeyId!==''):(!s.lastKey||!s.lastKeyId)))return invalid();
    const pageSize=64;
    if(s.phase==='ledger'){
      if(s.keyCount!==0)return invalid();
      let p=s.candidate;
      const q=ledger.orderBy(FieldPath.documentId()).limit(pageSize);
      const page=await tx.get(p.lastDocumentId?q.startAfter(p.lastDocumentId):q);
      for(const d of page.docs){
        if(d.id<=p.lastDocumentId)return invalid();
        const next=advanceCocarProjection(p,uid,epoch,d.id,d.data() as Row);
        if(!next)return invalid();
        p=next;
      }
      tx.set(checkpoint,{...s,candidate:p,phase:page.size<pageSize?'keys':'ledger'});
      return {status:'progress' as const,entries:p.entryCount};
    }
    if(s.phase!=='keys')return invalid();
    const q=ledger.orderBy('idempotencyKey').orderBy(FieldPath.documentId()).limit(pageSize);
    const page=await tx.get(s.lastKeyId?q.startAfter(s.lastKey,s.lastKeyId):q);
    let count=s.keyCount,key=s.lastKey,id=s.lastKeyId;
    for(const d of page.docs){
      const value=d.get('idempotencyKey');
      if(typeof value!=='string'||!value||value===key)return invalid();
      key=value;id=d.id;count++;
    }
    if(count>s.candidate.entryCount)return invalid();
    if(page.size<pageSize){
      if(count!==s.candidate.entryCount)return invalid();
      tx.set(ref,s.candidate);
      tx.delete(checkpoint);
      return {status:'complete' as const,total:s.candidate.total,entries:count};
    }
    tx.set(checkpoint,{...s,keyCount:count,lastKey:key,lastKeyId:id});
    return {status:'progress' as const,entries:count};
  });
}
