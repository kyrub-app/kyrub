import type { Auth } from 'firebase-admin/auth';
import { FieldPath, type Firestore, type Transaction, type DocumentData, type Query } from 'firebase-admin/firestore';
import { kyrubKCoinBalance, type KyrubRewardLedgerEntry } from '../../shared/gamification.js';
import { calculatePitangueiraJourney } from '../../shared/pitangueiraJourney.js';
import { semeaduraEconomicPilotEnabled } from './semeaduraEconomicPilot.js';
import { readIsolatedSemeaduraEvidenceInTransaction } from './semeaduraReviewEvidence.js';

const uid = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const LIMIT = 200;

async function authenticateIsolatedSupervisor(db:Firestore, auth:Auth, authorization:string):Promise<string> {
  if (!semeaduraEconomicPilotEnabled(db) || auth.app.options.projectId !== 'demo-kyrub-welcome')
    throw Error('GAMIFICATION_SUPERVISION_DISABLED');
  const token = typeof authorization === 'string' && /^Bearer (\S+)$/.exec(authorization)?.[1];
  if (!token) throw Error('GAMIFICATION_SUPERVISION_AUTH_REQUIRED');
  let reviewerId: string;
  try {
    const identity = await auth.verifyIdToken(token, true);
    if (!uid(identity.uid) || identity.aud !== 'demo-kyrub-welcome' ||
        !Number.isFinite(identity.exp) || identity.exp <= Date.now()/1000)
      throw Error('INVALID_SESSION');
    reviewerId = identity.uid;
  } catch {
    throw Error('GAMIFICATION_SUPERVISION_AUTH_REQUIRED');
  }
  return reviewerId;
}
async function requireIsolatedSupervisor(db:Firestore,tx:Transaction,reviewerId:string):Promise<void> {
    const [admin, reviewer] = await Promise.all([
      tx.get(db.doc('kyrub_admin/control_plane/admins/'+reviewerId)),
      tx.get(db.doc('systemControl/semeaduraEconomicReview/reviewers/'+reviewerId)),
    ]);
    if (admin.get('uid') !== reviewerId || admin.get('role') !== 'super_admin' ||
        admin.get('status') !== 'active' || reviewer.get('schemaVersion') !== 1 ||
        reviewer.get('reviewerId') !== reviewerId || reviewer.get('active') !== true ||
        reviewer.get('fixtureOnly') !== true)
      throw Error('GAMIFICATION_SUPERVISION_FORBIDDEN');
}

/** Authenticated account-scoped administrative read, only in disposable
 * Auth/Firestore emulators. No HTTP route, global scan, client SDK access
 * or mutation. Gross credits/debits are not synonymous with issuance/spend. */
export async function readIsolatedGamificationAccountSupervision(
  db: Firestore, auth: Auth, authorization: string, targetUid: string,
) {
  const reviewerId = await authenticateIsolatedSupervisor(db,auth,authorization);
  if (!uid(targetUid)) throw Error('GAMIFICATION_SUPERVISION_INPUT_INVALID');
  return db.runTransaction(async tx => {
    await requireIsolatedSupervisor(db,tx,reviewerId);
    return readAccountProjection(db,tx,targetUid);
  },{readOnly:true});
}

async function readAccountProjection(db:Firestore,tx:Transaction,targetUid:string) {
  const root=db.collection('users').doc(targetUid);
    const [balance, ledger, progress] = await Promise.all([
      tx.get(root.collection('pitangaBalance').doc('balance')),
      tx.get(root.collection('rewardLedger').limit(LIMIT+1)),
      tx.get(root.collection('semeaduraProgress').doc('summary')),
    ]);
    const findings: string[] = [];
    let economy: {credits:number;debits:number;balance:number}|null = null;
    const coverage = ledger.size > LIMIT ? 'partial' : 'complete';
    if (coverage === 'complete' && (balance.exists || ledger.size > 0)) {
      try {
        const entries = ledger.docs.map(doc => {
          const entry = doc.data() as KyrubRewardLedgerEntry & {economy?:string};
          if (entry.userId !== targetUid || entry.id !== doc.id || entry.economy !== 'k_coin')
            throw Error('LEDGER_SCOPE');
          return entry;
        });
        const net = kyrubKCoinBalance(entries);
        if (!balance.exists || balance.get('userId') !== targetUid || balance.get('availableKCoins') !== net)
          throw Error('BALANCE_MISMATCH');
        let credits = 0, debits = 0;
        for (const entry of entries) {
          if (entry.deltaKCoins > 0) credits += entry.deltaKCoins;
          else debits -= entry.deltaKCoins;
          if (!Number.isSafeInteger(credits) || !Number.isSafeInteger(debits)) throw Error('OVERFLOW');
        }
        economy = {credits,debits,balance:net};
      } catch {
        findings.push('PITANGA_LEDGER_OR_BALANCE_INVALID');
      }
    }
    let journey: {seeds:number;pitangueiras:number;bosques:number}|null = null;
    if (progress.exists) {
      const data = progress.data()!;
      if (data.authorId !== targetUid || !Number.isSafeInteger(data.acceptedSeeds) ||
          data.acceptedSeeds < 0 || data.pitangueiras !== Math.floor(data.acceptedSeeds/1000)) {
        findings.push('SEMEADURA_PROJECTION_INVALID');
      } else {
        const calculated=calculatePitangueiraJourney(data.acceptedSeeds);
        journey={seeds:calculated.totalSeeds,pitangueiras:calculated.pitangueiras,bosques:calculated.bosques};
      }
    }
    return {scope:'single-account' as const, environment:'isolated-emulator' as const,
      ledgerCoverage:coverage, observedEntries:ledger.size, economy, journey,
      hasCanonicalState:balance.exists||ledger.size>0||progress.exists,
      journeySource:'author-projection-not-receipt-reconciliation' as const, findings};
}



const GLOBAL_ACCOUNT_LIMIT=100;
const GLOBAL_ENTRY_LIMIT=500;
const safeAdd=(a:number,b:number)=>{
  const result=a+b;
  if(!Number.isSafeInteger(result))throw Error('SUPERVISION_OVERFLOW');
  return result;
};

/** Canonical collection-group snapshot, NOT a platform-wide economic proof.
 * Only the emulator is permitted. Bounded reads, no collection-group writes,
 * no partial sums presented as totals. Includes orphan subcollection records
 * even when the parent users/{uid} document does not exist. */
export async function readIsolatedGamificationGlobalSupervision(
  db:Firestore,auth:Auth,authorization:string,
) {
  const reviewerId=await authenticateIsolatedSupervisor(db,auth,authorization);
  return db.runTransaction(async tx=>{
    await requireIsolatedSupervisor(db,tx,reviewerId);
    const [balances,ledger,progress]=await Promise.all([
      tx.get(db.collectionGroup('pitangaBalance').limit(GLOBAL_ACCOUNT_LIMIT+1)),
      tx.get(db.collectionGroup('rewardLedger').limit(GLOBAL_ENTRY_LIMIT+1)),
      tx.get(db.collectionGroup('semeaduraProgress').limit(GLOBAL_ACCOUNT_LIMIT+1)),
    ]);
    const economyCoverage=balances.size>GLOBAL_ACCOUNT_LIMIT||ledger.size>GLOBAL_ENTRY_LIMIT?'partial':'complete';
    const journeyCoverage=progress.size>GLOBAL_ACCOUNT_LIMIT?'partial':'complete';
    const findings:string[]=[];
    let economy:{credits:number;debits:number;balance:number;accounts:number}|null=null;
    let journey:{seeds:number;pitangueiras:number;bosques:number;authors:number}|null=null;
    const owner=(path:string,group:string)=>{
      const parts=path.split('/');
      if(parts.length!==4||parts[0]!=='users'||!uid(parts[1])||parts[2]!==group)
        throw Error('NON_CANONICAL_SCOPE');
      return parts[1];
    };
    if(economyCoverage==='complete'&&(balances.size>0||ledger.size>0)){
      try{
        const projections=new Map<string,number>();
        const entries=new Map<string,KyrubRewardLedgerEntry[]>();
        for(const doc of balances.docs){
          const user=owner(doc.ref.path,'pitangaBalance'), data=doc.data();
          if(doc.id!=='balance'||data.userId!==user||!Number.isSafeInteger(data.availableKCoins)||
             data.availableKCoins<0||projections.has(user))throw Error('INVALID_BALANCE');
          projections.set(user,data.availableKCoins);
        }
        for(const doc of ledger.docs){
          const user=owner(doc.ref.path,'rewardLedger');
          const entry=doc.data() as KyrubRewardLedgerEntry & {economy?:string};
          if(entry.id!==doc.id||entry.userId!==user||entry.economy!=='k_coin')throw Error('INVALID_LEDGER');
          if(!projections.has(user))throw Error('ORPHAN_LEDGER');
          const rows=entries.get(user)??[];rows.push(entry);entries.set(user,rows);
        }
        let credits=0,debits=0,balance=0;
        for(const [user,projection] of projections){
          const rows=entries.get(user)??[];
          if(kyrubKCoinBalance(rows)!==projection)throw Error('BALANCE_MISMATCH');
          balance=safeAdd(balance,projection);
          for(const row of rows){
            if(row.deltaKCoins>0)credits=safeAdd(credits,row.deltaKCoins);
            else debits=safeAdd(debits,-row.deltaKCoins);
          }
        }
        economy={credits,debits,balance,accounts:projections.size};
      }catch{findings.push('GLOBAL_CANONICAL_ECONOMY_INVALID');}
    }
    if(journeyCoverage==='complete'&&progress.size>0){
      try{
        let seeds=0,pitangueiras=0,bosques=0;
        for(const doc of progress.docs){
          const user=owner(doc.ref.path,'semeaduraProgress'), data=doc.data();
          if(doc.id!=='summary'||data.authorId!==user||!Number.isSafeInteger(data.acceptedSeeds)||
             data.acceptedSeeds<0||data.pitangueiras!==Math.floor(data.acceptedSeeds/1000))
            throw Error('INVALID_JOURNEY');
          const j=calculatePitangueiraJourney(data.acceptedSeeds);
          seeds=safeAdd(seeds,j.totalSeeds);pitangueiras=safeAdd(pitangueiras,j.pitangueiras);bosques=safeAdd(bosques,j.bosques);
        }
        // Sum milestones per author, not floor of platform-wide seeds.
        journey={seeds,pitangueiras,bosques,authors:progress.size};
      }catch{findings.push('GLOBAL_AUTHOR_PROJECTION_INVALID');}
    }
    return {scope:'canonical-collections' as const,environment:'isolated-emulator' as const,
      economyCoverage,journeyCoverage,observedBalances:balances.size,observedLedgerEntries:ledger.size,
      observedAuthorProjections:progress.size,economy,journey,
      externalWritersVerified:false,journeyReceiptReconciled:false,findings};
  },{readOnly:true});
}


const snapshotRoot='systemControl/gamificationIncrementalPilot';
const pendingRoot=snapshotRoot+'/pending';

/** Called only by the trusted accepted-seed transaction, after all reads.
 * One durable dirty marker per author, not one document per seed.
 * A concurrent refresh conflicts on this same document and cannot lose
 * an accepted update. Disabled in all real Firebase environments. */
export function markIsolatedGamificationAuthorDirty(
 db:Firestore,tx:Transaction,authorId:string,occurredAt:string,
):void {
 if(!semeaduraEconomicPilotEnabled(db)||process.env.KYRUB_GAMIFICATION_INCREMENTAL_QUEUE!=='true')return;
 if(!uid(authorId)||!Number.isFinite(Date.parse(occurredAt)))throw Error('INCREMENTAL_DIRTY_INPUT_INVALID');
 tx.set(db.doc(pendingRoot+'/'+authorId),{schemaVersion:1,accountId:authorId,updatedAt:occurredAt,source:'accepted_seed'});
}

const metricKeys=['credits','debits','balance','seeds','pitangueiras','bosques','accounts','economyKnown','journeyKnown'] as const;
type Metrics=Record<typeof metricKeys[number],number>;
const zeroMetrics=():Metrics=>({credits:0,debits:0,balance:0,seeds:0,pitangueiras:0,bosques:0,accounts:0,economyKnown:0,journeyKnown:0});
function validatedMetrics(value:unknown):Metrics {
  if(!value||typeof value!=='object')throw Error('INCREMENTAL_STATE_INVALID');
  const data=value as Metrics;
  if(metricKeys.some(k=>!Number.isSafeInteger(data[k])||data[k]<0)||
     data.credits-data.debits!==data.balance||data.economyKnown>data.accounts||
     data.journeyKnown>data.accounts)throw Error('INCREMENTAL_STATE_INVALID');
  return Object.fromEntries(metricKeys.map(k=>[k,data[k]])) as Metrics;
}
function snapshotView(metrics:Metrics,updatedAt:string|null){
  return {scope:'refreshed-accounts-only' as const,environment:'isolated-emulator' as const,
    updatedAt,refreshedAccounts:metrics.accounts,economyKnown:metrics.economyKnown,
    journeyKnown:metrics.journeyKnown,
    reconciledEconomySubtotal:metrics.economyKnown?{credits:metrics.credits,debits:metrics.debits,balance:metrics.balance}:null,
    authorProjectionSubtotal:metrics.journeyKnown?{seeds:metrics.seeds,pitangueiras:metrics.pitangueiras,bosques:metrics.bosques}:null,
    globalCoverageVerified:false,automaticRefresh:false,mayBeStale:true};
}

/** Refresh one account from authoritative sources in the same transaction
 * as replacing its old contribution. Only derived admin cache is written.
 * No production writers, triggers, scheduler, or claims of global coverage.
 * A failed/incomplete reconciliation removes that account's old subtotal. */
export async function refreshIsolatedGamificationIncrementalAccount(
 db:Firestore,auth:Auth,authorization:string,targetUid:string,
){
 const reviewerId=await authenticateIsolatedSupervisor(db,auth,authorization);
 if(!uid(targetUid))throw Error('GAMIFICATION_SUPERVISION_INPUT_INVALID');
 return db.runTransaction(async tx=>{
  await requireIsolatedSupervisor(db,tx,reviewerId);
  const ref=db.doc(snapshotRoot), contributionRef=ref.collection('accounts').doc(targetUid);
  const dirtyRef=db.doc(pendingRoot+'/'+targetUid);
  const [summary,prior,source,dirty]=await Promise.all([tx.get(ref),tx.get(contributionRef),readAccountProjection(db,tx,targetUid),tx.get(dirtyRef)]);
  if(dirty.exists&&(dirty.get('schemaVersion')!==1||dirty.get('accountId')!==targetUid||
     dirty.get('source')!=='accepted_seed'||!Number.isFinite(Date.parse(dirty.get('updatedAt')))))
    throw Error('INCREMENTAL_DIRTY_STATE_INVALID');
  if(summary.exists&&summary.get('schemaVersion')!==1)throw Error('INCREMENTAL_STATE_INVALID');
  if(prior.exists&&(!summary.exists||prior.get('schemaVersion')!==1||prior.get('accountId')!==targetUid))
    throw Error('INCREMENTAL_STATE_INVALID');
  const total=summary.exists?validatedMetrics(summary.get('metrics')):zeroMetrics();
  const previous=prior.exists?validatedMetrics(prior.get('metrics')):zeroMetrics();
  if(prior.exists&&previous.accounts!==1)throw Error('INCREMENTAL_STATE_INVALID');
  if(!source.hasCanonicalState&&!prior.exists)throw Error('INCREMENTAL_ACCOUNT_UNAVAILABLE');
  const next:Metrics={...zeroMetrics(),accounts:source.hasCanonicalState?1:0,
    ...(source.economy?{...source.economy,economyKnown:1}:{}),
    ...(source.journey?{...source.journey,journeyKnown:1}:{})};
  const merged=zeroMetrics();
  for(const key of metricKeys){
    if(total[key]<previous[key])throw Error('INCREMENTAL_STATE_INVALID');
    merged[key]=safeAdd(total[key]-previous[key],next[key]);
  }
  validatedMetrics(merged);
  const updatedAt=new Date().toISOString();
  if(source.hasCanonicalState)tx.set(contributionRef,{schemaVersion:1,accountId:targetUid,metrics:next,updatedAt});
  else tx.delete(contributionRef);
  tx.set(ref,{schemaVersion:1,metrics:merged,updatedAt});
  if(dirty.exists)tx.delete(dirtyRef);
  return snapshotView(merged,updatedAt);
 });
}

/** Fixed-size read of the derived cache; the timestamp is the last refresh,
 * not proof that every account is current. Never used for economic decisions. */
export async function readIsolatedGamificationIncrementalSnapshot(
 db:Firestore,auth:Auth,authorization:string,
){
 const reviewerId=await authenticateIsolatedSupervisor(db,auth,authorization);
 return db.runTransaction(async tx=>{
  await requireIsolatedSupervisor(db,tx,reviewerId);
  const summary=await tx.get(db.doc(snapshotRoot));
  if(!summary.exists)return snapshotView(zeroMetrics(),null);
  const updatedAt=summary.get('updatedAt');
  if(summary.get('schemaVersion')!==1||typeof updatedAt!=='string'||!Number.isFinite(Date.parse(updatedAt)))
    throw Error('INCREMENTAL_STATE_INVALID');
  return snapshotView(validatedMetrics(summary.get('metrics')),updatedAt);
 },{readOnly:true});
}


/** Bounded authenticated drain entry point for an isolated future worker.
 * No scheduler or HTTP endpoint. Each refresh rereads canonical data and
 * consumes the dirty marker atomically. Repeated drains do not add credits. */
export async function drainIsolatedGamificationDirtyAccounts(
 db:Firestore,auth:Auth,authorization:string,limit=10,
){
 const reviewerId=await authenticateIsolatedSupervisor(db,auth,authorization);
 if(process.env.KYRUB_GAMIFICATION_INCREMENTAL_QUEUE!=='true')throw Error('INCREMENTAL_QUEUE_DISABLED');
 if(!Number.isSafeInteger(limit)||limit<1||limit>20)throw Error('INCREMENTAL_QUEUE_LIMIT_INVALID');
 const pending=await db.runTransaction(async tx=>{
  await requireIsolatedSupervisor(db,tx,reviewerId);
  return tx.get(db.collection(pendingRoot).limit(limit+1));
 },{readOnly:true});
 let refreshed=0;
 for(const item of pending.docs.slice(0,limit)){
  if(!uid(item.id))throw Error('INCREMENTAL_DIRTY_STATE_INVALID');
  await refreshIsolatedGamificationIncrementalAccount(db,auth,authorization,item.id);
  refreshed++;
 }
 return {scope:'isolated-seed-dirty-queue' as const,refreshed,moreObserved:pending.size>limit,
  globalCoverageVerified:false,automaticWorkerInstalled:false};
}


/** One bounded invocation for future worker integration. Never starts a
 * scheduler, keeps a server alive, or grants a machine administrator role.
 * The caller supplies a verified isolated supervisor session; a real
 * scheduled worker needs a separate service identity and release review.
 * Failures propagate, preserving unprocessed markers for a later invocation. */
export async function runIsolatedGamificationQueueCycle(
 db:Firestore,auth:Auth,authorization:string,
 options:{batchSize:number;maxBatches:number}={batchSize:10,maxBatches:3},
){
 if(!options||!Number.isSafeInteger(options.batchSize)||options.batchSize<1||options.batchSize>20||
    !Number.isSafeInteger(options.maxBatches)||options.maxBatches<1||options.maxBatches>5)
   throw Error('INCREMENTAL_QUEUE_CYCLE_LIMIT_INVALID');
 let processed=0,batches=0,moreObserved=false;
 for(let i=0;i<options.maxBatches;i++){
  const result=await drainIsolatedGamificationDirtyAccounts(db,auth,authorization,options.batchSize);
  batches++;
  processed+=result.refreshed;
  moreObserved=result.moreObserved;
  if(!moreObserved)break;
 }
 return {scope:'isolated-queue-cycle' as const,processed,batches,moreObserved,
   stopReason:moreObserved?'batch-budget-reached' as const:'no-more-in-last-snapshot' as const,
   globalCoverageVerified:false,schedulerInstalled:false};
}


/** Authenticated technical suspicion inspection; no automatic case or sanction.
 * Administrative authorization and evidence share one read-only snapshot. */
export async function readIsolatedGamificationSuspicionEvidence(
 db:Firestore,auth:Auth,authorization:string,input:{kind:'personal'|'community';postId:string},
){
 const reviewerId=await authenticateIsolatedSupervisor(db,auth,authorization);
 return db.runTransaction(async tx=>{
  await requireIsolatedSupervisor(db,tx,reviewerId);
  const evidence=await readIsolatedSemeaduraEvidenceInTransaction(db,tx,input);
  return {...evidence,classification:'technical-indicator-not-fraud-verdict' as const,
    automaticSanction:false,caseCreated:false};
 },{readOnly:true});
}


const suspicionRoot='systemControl/semeaduraSuspicionPilot';

/** Explicit human intake, with evidence recomputed by the server in the
 * same transaction. One open case per canonical post; request replay does
 * not reopen a closed case. No hold, fraud verdict or economic mutation. */
export async function openIsolatedGamificationSuspicionCase(
 db:Firestore,auth:Auth,authorization:string,
 input:{caseId:string;kind:'personal'|'community';postId:string},
){
 const reviewerId=await authenticateIsolatedSupervisor(db,auth,authorization);
 if(!input||!uid(input.caseId))throw Error('SUSPICION_CASE_INPUT_INVALID');
 return db.runTransaction(async tx=>{
  await requireIsolatedSupervisor(db,tx,reviewerId);
  const evidence=await readIsolatedSemeaduraEvidenceInTransaction(db,tx,input);
  const caseRef=db.doc(suspicionRoot+'/cases/'+input.caseId);
  const activeRef=db.doc(suspicionRoot+'/active/'+evidence.postKey);
  const [existing,active]=await Promise.all([tx.get(caseRef),tx.get(activeRef)]);
  if(existing.exists){
   const data=existing.data()!;
   if(data.schemaVersion!==1||data.caseId!==input.caseId||data.postKey!==evidence.postKey||
      data.openedBy!==reviewerId||!['open','closed'].includes(data.status))
     throw Error('SUSPICION_CASE_ID_CONFLICT');
   return {caseId:input.caseId,status:data.status as 'open'|'closed',replayed:true};
  }
  if(active.exists)throw Error('SUSPICION_CASE_ALREADY_OPEN');
  if(!evidence.requiresTechnicalReview)throw Error('SUSPICION_CASE_NO_INDICATORS');
  const openedAt=new Date().toISOString();
  tx.create(caseRef,{schemaVersion:1,caseId:input.caseId,postKey:evidence.postKey,
    kind:input.kind,postId:input.postId,status:'open',openedBy:reviewerId,openedAt,
    openingEvidence:evidence,classification:'technical-indicator-not-fraud-verdict'});
  tx.create(activeRef,{schemaVersion:1,caseId:input.caseId,postKey:evidence.postKey});
  return {caseId:input.caseId,status:'open' as const,replayed:false};
 });
}

/** Conclude technical triage, not economic review. No automatic referral
 * writes, penalties or release of holds. An inconclusive observation may
 * be investigated in a new case later, without overwriting the old one. */
export async function closeIsolatedGamificationSuspicionCase(
 db:Firestore,auth:Auth,authorization:string,
 input:{caseId:string;outcome:'resolved'|'inconclusive'|'referred_for_review'},
){
 const reviewerId=await authenticateIsolatedSupervisor(db,auth,authorization);
 if(!input||!uid(input.caseId)||!['resolved','inconclusive','referred_for_review'].includes(input.outcome))
   throw Error('SUSPICION_CASE_INPUT_INVALID');
 return db.runTransaction(async tx=>{
  await requireIsolatedSupervisor(db,tx,reviewerId);
  const caseRef=db.doc(suspicionRoot+'/cases/'+input.caseId);
  const closingRef=db.doc(suspicionRoot+'/closures/'+input.caseId);
  const [record,closure]=await Promise.all([tx.get(caseRef),tx.get(closingRef)]);
  const data=record.data();
  if(!data||data.schemaVersion!==1||data.caseId!==input.caseId||
     typeof data.postKey!=='string'||! /^[a-f0-9]{64}$/.test(data.postKey))
   throw Error('SUSPICION_CASE_UNAVAILABLE');
  if(data.status==='closed'){
   if(!closure.exists||closure.get('caseId')!==input.caseId||
      closure.get('postKey')!==data.postKey||closure.get('closedBy')!==reviewerId||
      closure.get('outcome')!==input.outcome||data.closedAt!==closure.get('closedAt')||
      data.outcome!==input.outcome)throw Error('SUSPICION_CASE_CLOSE_CONFLICT');
   return {caseId:input.caseId,status:'closed' as const,replayed:true};
  }
  if(data.status!=='open'||closure.exists)throw Error('SUSPICION_CASE_STATE_INVALID');
  const activeRef=db.doc(suspicionRoot+'/active/'+data.postKey);
  const [active,evidence]=await Promise.all([tx.get(activeRef),
    readIsolatedSemeaduraEvidenceInTransaction(db,tx,{kind:data.kind,postId:data.postId})]);
  if(active.get('schemaVersion')!==1||active.get('caseId')!==input.caseId||
     active.get('postKey')!==data.postKey||evidence.postKey!==data.postKey)
   throw Error('SUSPICION_CASE_STATE_INVALID');
  if(input.outcome==='resolved'&&(evidence.coverage!=='complete'||evidence.requiresTechnicalReview))
   throw Error('SUSPICION_CASE_NOT_RESOLVED');
  const closedAt=new Date().toISOString();
  tx.create(closingRef,{schemaVersion:1,caseId:input.caseId,postKey:data.postKey,
    outcome:input.outcome,closedBy:reviewerId,closedAt,closingEvidence:evidence});
  tx.update(caseRef,{status:'closed',outcome:input.outcome,closedAt});
  tx.delete(activeRef);
  return {caseId:input.caseId,status:'closed' as const,replayed:false};
 });
}


const suspicionOutcomes=['resolved','inconclusive','referred_for_review'] as const;
const validIso=(value:unknown):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value));
function projectSuspicionCase(id:string,data:DocumentData){
 if(data.schemaVersion!==1||!uid(id)||data.caseId!==id||
    !['personal','community'].includes(data.kind)||typeof data.postId!=='string'||
    !/^[A-Za-z0-9_-]{1,500}$/.test(data.postId)||
    typeof data.postKey!=='string'||! /^[a-f0-9]{64}$/.test(data.postKey)||
    !uid(data.openedBy)||!validIso(data.openedAt)||
    data.classification!=='technical-indicator-not-fraud-verdict'||
    !['open','closed'].includes(data.status))
   throw Error('SUSPICION_CASE_STATE_INVALID');
 if(data.status==='closed'&&(!suspicionOutcomes.includes(data.outcome)||!validIso(data.closedAt)||
    Date.parse(data.closedAt)<Date.parse(data.openedAt)))throw Error('SUSPICION_CASE_STATE_INVALID');
 if(data.status==='open'&&(data.outcome!==undefined||data.closedAt!==undefined))
   throw Error('SUSPICION_CASE_STATE_INVALID');
 return {caseId:id,kind:data.kind as 'personal'|'community',postId:data.postId as string,
  postKey:data.postKey as string,openedBy:data.openedBy as string,openedAt:data.openedAt as string,
  status:data.status as 'open'|'closed',
  outcome:data.status==='closed'?data.outcome as typeof suspicionOutcomes[number]:null,
  closedAt:data.status==='closed'?data.closedAt as string:null,
  classification:'technical-indicator-not-fraud-verdict' as const};
}
const findingCodes=['INVALID_COUNTER','ORPHAN_RECEIPTS','COUNTER_BELOW_OBSERVED',
 'COUNTER_RECEIPT_MISMATCH','INVALID_RECEIPT','SELF_SEED_RECEIPT'];
function projectSuspicionEvidence(data:DocumentData|undefined,postKey:string){
 const count=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
 if(!data||data.postKey!==postKey||!['complete','partial'].includes(data.coverage)||
    !(data.projectedSeeds===null||count(data.projectedSeeds))||
    !count(data.observedReceipts)||data.observedReceipts>501||
    (data.coverage==='partial')!==(data.observedReceipts===501)||
    !count(data.invalidReceipts)||data.invalidReceipts>data.observedReceipts||
    !count(data.selfReceipts)||data.selfReceipts>data.observedReceipts||
    !count(data.legacyWithoutQuotaDay)||data.legacyWithoutQuotaDay>data.observedReceipts||
    !Array.isArray(data.findings)||data.findings.some((v:unknown)=>typeof v!=='string'||!findingCodes.includes(v))||
    new Set(data.findings).size!==data.findings.length||
    data.requiresTechnicalReview!==(data.findings.length>0))throw Error('SUSPICION_CASE_EVIDENCE_INVALID');
 return {postKey,coverage:data.coverage as 'complete'|'partial',projectedSeeds:data.projectedSeeds as number|null,
   observedReceipts:data.observedReceipts,invalidReceipts:data.invalidReceipts,selfReceipts:data.selfReceipts,
   legacyWithoutQuotaDay:data.legacyWithoutQuotaDay,findings:[...data.findings] as string[],
   requiresTechnicalReview:data.requiresTechnicalReview as boolean};
}

/** Authenticated bounded listing. Stable document-ID order (not chronology).
 * Each page is a separate snapshot; concurrent changes may affect later pages.
 * No global counts, raw documents, automatic classification or mutations. */
export async function listIsolatedGamificationSuspicionCases(
 db:Firestore,auth:Auth,authorization:string,
 input:{status:'all'|'open'|'closed';limit:number;afterCaseId?:string},
){
 const reviewerId=await authenticateIsolatedSupervisor(db,auth,authorization);
 if(!input||!['all','open','closed'].includes(input.status)||!Number.isSafeInteger(input.limit)||
    input.limit<1||input.limit>20||(input.afterCaseId!==undefined&&!uid(input.afterCaseId)))
   throw Error('SUSPICION_CASE_LIST_INPUT_INVALID');
 return db.runTransaction(async tx=>{
  await requireIsolatedSupervisor(db,tx,reviewerId);
  let query:Query=db.collection(suspicionRoot+'/cases');
  if(input.status!=='all')query=query.where('status','==',input.status);
  query=query.orderBy(FieldPath.documentId());
  if(input.afterCaseId!==undefined)query=query.startAfter(input.afterCaseId);
  const rows=await tx.get(query.limit(input.limit+1));
  const cases=rows.docs.slice(0,input.limit).map(doc=>projectSuspicionCase(doc.id,doc.data()));
  return {scope:'isolated-suspicion-cases' as const,status:input.status,cases,
    nextAfterCaseId:rows.size>input.limit?cases[cases.length-1].caseId:null,
    ordering:'case-id-ascending' as const,consistentAcrossPages:false};
 },{readOnly:true});
}

/** Detail reads preserved opening/closing evidence, not a fresh fraud verdict. */
export async function readIsolatedGamificationSuspicionCase(
 db:Firestore,auth:Auth,authorization:string,caseId:string,
){
 const reviewerId=await authenticateIsolatedSupervisor(db,auth,authorization);
 if(!uid(caseId))throw Error('SUSPICION_CASE_INPUT_INVALID');
 return db.runTransaction(async tx=>{
  await requireIsolatedSupervisor(db,tx,reviewerId);
  const [record,closure]=await Promise.all([tx.get(db.doc(suspicionRoot+'/cases/'+caseId)),
    tx.get(db.doc(suspicionRoot+'/closures/'+caseId))]);
  if(!record.exists)throw Error('SUSPICION_CASE_UNAVAILABLE');
  const data=record.data()!;
  const summary=projectSuspicionCase(caseId,data);
  const openingEvidence=projectSuspicionEvidence(data.openingEvidence,summary.postKey);
  if(!openingEvidence.requiresTechnicalReview)throw Error('SUSPICION_CASE_EVIDENCE_INVALID');
  let closing=null;
  if(summary.status==='closed'){
   const end=closure.data();
   if(!end||end.schemaVersion!==1||end.caseId!==caseId||end.postKey!==summary.postKey||
      end.outcome!==summary.outcome||end.closedAt!==summary.closedAt||!uid(end.closedBy))
      throw Error('SUSPICION_CASE_STATE_INVALID');
   const evidence=projectSuspicionEvidence(end.closingEvidence,summary.postKey);
   if(summary.outcome==='resolved'&&(evidence.coverage!=='complete'||evidence.requiresTechnicalReview))
      throw Error('SUSPICION_CASE_EVIDENCE_INVALID');
   closing={closedBy:end.closedBy as string,evidence};
  }else{
   const active=await tx.get(db.doc(suspicionRoot+'/active/'+summary.postKey));
   if(closure.exists||active.get('schemaVersion')!==1||active.get('caseId')!==caseId||
      active.get('postKey')!==summary.postKey)throw Error('SUSPICION_CASE_STATE_INVALID');
  }
  return {scope:'isolated-suspicion-case-history' as const,...summary,openingEvidence,closing,
    automaticSanction:false};
 },{readOnly:true});
}


const referralRoot='systemControl/semeaduraEconomicReview';
const reviewDispositions=['no_action','insufficient_evidence','requires_separate_corrective_review'] as const;
type ReviewDisposition=typeof reviewDispositions[number];

/** Load the immutable technical closure and evidence in the same transaction
 * as the economic referral operation. An explicit referral is not a hold. */
async function readReferralSource(db:Firestore,tx:Transaction,caseId:string){
 const [record,closure]=await Promise.all([
  tx.get(db.doc(suspicionRoot+'/cases/'+caseId)),
  tx.get(db.doc(suspicionRoot+'/closures/'+caseId)),
 ]);
 if(!record.exists)throw Error('ECONOMIC_REFERRAL_SOURCE_UNAVAILABLE');
 const raw=record.data()!;
 const source=projectSuspicionCase(caseId,raw);
 const end=closure.data();
 if(source.status!=='closed'||source.outcome!=='referred_for_review'||
    !end||end.schemaVersion!==1||end.caseId!==caseId||end.postKey!==source.postKey||
    end.outcome!==source.outcome||end.closedAt!==source.closedAt||!uid(end.closedBy))
   throw Error('ECONOMIC_REFERRAL_SOURCE_INVALID');
 const initial=projectSuspicionEvidence(raw.openingEvidence,source.postKey);
 const final=projectSuspicionEvidence(end.closingEvidence,source.postKey);
 if(!initial.requiresTechnicalReview)throw Error('ECONOMIC_REFERRAL_SOURCE_INVALID');
 return {source,initial,final,referredBy:end.closedBy as string};
}
function validateReferral(data:DocumentData|undefined,caseId:string,source:Awaited<ReturnType<typeof readReferralSource>>){
 if(!data||data.schemaVersion!==1||data.caseId!==caseId||data.postKey!==source.source.postKey||
    data.sourceClosedAt!==source.source.closedAt||data.referredBy!==source.referredBy||
    !uid(data.acceptedBy)||!validIso(data.acceptedAt)||
    Date.parse(data.acceptedAt)<Date.parse(source.source.closedAt!)||
    !['pending','decided'].includes(data.status))throw Error('ECONOMIC_REFERRAL_STATE_INVALID');
 if(data.status==='pending'&&(data.decision!==undefined||data.decidedAt!==undefined))
   throw Error('ECONOMIC_REFERRAL_STATE_INVALID');
 if(data.status==='decided'&&(!reviewDispositions.includes(data.decision)||!validIso(data.decidedAt)||
    Date.parse(data.decidedAt)<Date.parse(data.acceptedAt)))throw Error('ECONOMIC_REFERRAL_STATE_INVALID');
 return data;
}

/** Separate explicit administrative intake. Stable case ID prevents duplicate
 * reviews. No mutation of the original investigation, holds or ledger. */
export async function acceptIsolatedGamificationEconomicReferral(
 db:Firestore,auth:Auth,authorization:string,caseId:string,
){
 const reviewerId=await authenticateIsolatedSupervisor(db,auth,authorization);
 if(!uid(caseId))throw Error('ECONOMIC_REFERRAL_INPUT_INVALID');
 return db.runTransaction(async tx=>{
  await requireIsolatedSupervisor(db,tx,reviewerId);
  const ref=db.doc(referralRoot+'/referrals/'+caseId);
  const [source,prior]=await Promise.all([readReferralSource(db,tx,caseId),tx.get(ref)]);
  if(prior.exists){
   const data=validateReferral(prior.data(),caseId,source);
   return {caseId,status:data.status as 'pending'|'decided',replayed:true};
  }
  tx.create(ref,{schemaVersion:1,caseId,postKey:source.source.postKey,
   sourceClosedAt:source.source.closedAt,referredBy:source.referredBy,
   acceptedBy:reviewerId,acceptedAt:new Date().toISOString(),status:'pending'});
  return {caseId,status:'pending' as const,replayed:false};
 });
}

/** Human disposition of a referral, deliberately non-economic. Even
 * requires_separate_corrective_review grants no authority to apply a hold,
 * debit Pitangas or declare fraud. One immutable decision per referral. */
export async function decideIsolatedGamificationEconomicReferral(
 db:Firestore,auth:Auth,authorization:string,
 input:{caseId:string;decision:ReviewDisposition;reason:string},
){
 const reviewerId=await authenticateIsolatedSupervisor(db,auth,authorization);
 if(!input||!uid(input.caseId)||!reviewDispositions.includes(input.decision)||
    typeof input.reason!=='string'||input.reason.trim().length<10||input.reason.length>500)
   throw Error('ECONOMIC_REFERRAL_INPUT_INVALID');
 const reason=input.reason.trim();
 return db.runTransaction(async tx=>{
  await requireIsolatedSupervisor(db,tx,reviewerId);
  const ref=db.doc(referralRoot+'/referrals/'+input.caseId);
  const eventRef=db.doc(referralRoot+'/referralDecisions/'+input.caseId);
  const [source,record,event]=await Promise.all([readReferralSource(db,tx,input.caseId),tx.get(ref),tx.get(eventRef)]);
  const data=validateReferral(record.data(),input.caseId,source);
  if(data.status==='decided'){
   const prior=event.data();
   if(!prior||prior.schemaVersion!==1||prior.caseId!==input.caseId||prior.postKey!==data.postKey||
      prior.decision!==data.decision||prior.decidedAt!==data.decidedAt||prior.decidedBy!==reviewerId||
      prior.decision!==input.decision||prior.reason!==reason)throw Error('ECONOMIC_REFERRAL_DECISION_CONFLICT');
   return {caseId:input.caseId,status:'decided' as const,replayed:true};
  }
  if(event.exists)throw Error('ECONOMIC_REFERRAL_STATE_INVALID');
  const decidedAt=new Date().toISOString();
  tx.create(eventRef,{schemaVersion:1,caseId:input.caseId,postKey:data.postKey,
   decision:input.decision,reason,decidedBy:reviewerId,decidedAt});
  tx.update(ref,{status:'decided',decision:input.decision,decidedAt});
  return {caseId:input.caseId,status:'decided' as const,replayed:false};
 });
}

/** Read both histories with integrity checks, without exposing raw documents. */
export async function readIsolatedGamificationEconomicReferral(
 db:Firestore,auth:Auth,authorization:string,caseId:string,
){
 const reviewerId=await authenticateIsolatedSupervisor(db,auth,authorization);
 if(!uid(caseId))throw Error('ECONOMIC_REFERRAL_INPUT_INVALID');
 return db.runTransaction(async tx=>{
  await requireIsolatedSupervisor(db,tx,reviewerId);
  const [source,record,event]=await Promise.all([readReferralSource(db,tx,caseId),
   tx.get(db.doc(referralRoot+'/referrals/'+caseId)),
   tx.get(db.doc(referralRoot+'/referralDecisions/'+caseId))]);
  if(!record.exists){
   if(event.exists)throw Error('ECONOMIC_REFERRAL_STATE_INVALID');
   return {scope:'isolated-economic-referral' as const,caseId,postKey:source.source.postKey,
    sourceClosedAt:source.source.closedAt,referredBy:source.referredBy,acceptedBy:null,acceptedAt:null,
    status:'awaiting_acceptance' as const,openingEvidence:source.initial,closingEvidence:source.final,decision:null,
    economicMutationApplied:false,fraudVerdict:false};
  }
  const data=validateReferral(record.data(),caseId,source);
  let decision=null;
  if(data.status==='decided'){
   const end=event.data();
   if(!end||end.schemaVersion!==1||end.caseId!==caseId||end.postKey!==data.postKey||
      end.decision!==data.decision||end.decidedAt!==data.decidedAt||!uid(end.decidedBy)||
      typeof end.reason!=='string'||end.reason.trim().length<10||end.reason.length>500)
     throw Error('ECONOMIC_REFERRAL_STATE_INVALID');
   decision={outcome:end.decision as ReviewDisposition,reason:end.reason as string,
    decidedBy:end.decidedBy as string,decidedAt:end.decidedAt as string};
  }else if(event.exists)throw Error('ECONOMIC_REFERRAL_STATE_INVALID');
  return {scope:'isolated-economic-referral' as const,caseId,postKey:source.source.postKey,
   sourceClosedAt:source.source.closedAt,referredBy:source.referredBy,acceptedBy:data.acceptedBy as string,
   acceptedAt:data.acceptedAt as string,status:data.status as 'pending'|'decided',
   openingEvidence:source.initial,closingEvidence:source.final,decision,
   economicMutationApplied:false,fraudVerdict:false};
 },{readOnly:true});
}


/** List technical referrals, including those not yet accepted. Bounded
 * by source-case IDs; status reflects the same read-only snapshot.
 * No global count or promise of consistency across separate pages. */
export async function listIsolatedGamificationEconomicReferrals(
 db:Firestore,auth:Auth,authorization:string,input:{limit:number;afterCaseId?:string},
){
 const reviewerId=await authenticateIsolatedSupervisor(db,auth,authorization);
 if(!input||!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>10||
    (input.afterCaseId!==undefined&&!uid(input.afterCaseId)))
   throw Error('ECONOMIC_REFERRAL_INPUT_INVALID');
 return db.runTransaction(async tx=>{
  await requireIsolatedSupervisor(db,tx,reviewerId);
  let query:Query=db.collection(suspicionRoot+'/cases').where('outcome','==','referred_for_review').orderBy(FieldPath.documentId());
  if(input.afterCaseId!==undefined)query=query.startAfter(input.afterCaseId);
  const page=await tx.get(query.limit(input.limit+1));
  const rows=await Promise.all(page.docs.slice(0,input.limit).map(async doc=>{
   const caseId=doc.id;
   const [source,record,event]=await Promise.all([readReferralSource(db,tx,caseId),
    tx.get(db.doc(referralRoot+'/referrals/'+caseId)),tx.get(db.doc(referralRoot+'/referralDecisions/'+caseId))]);
   if(!record.exists){
    if(event.exists)throw Error('ECONOMIC_REFERRAL_STATE_INVALID');
    return {caseId,status:'awaiting_acceptance' as const,sourceClosedAt:source.source.closedAt,decision:null};
   }
   const data=validateReferral(record.data(),caseId,source);
   if(data.status==='decided'){
    const end=event.data();
    if(!end||end.schemaVersion!==1||end.caseId!==caseId||end.postKey!==data.postKey||
       end.decision!==data.decision||end.decidedAt!==data.decidedAt||!uid(end.decidedBy)||
       typeof end.reason!=='string'||end.reason.trim().length<10||end.reason.length>500)
      throw Error('ECONOMIC_REFERRAL_STATE_INVALID');
   }else if(event.exists)throw Error('ECONOMIC_REFERRAL_STATE_INVALID');
   return {caseId,status:data.status as 'pending'|'decided',sourceClosedAt:source.source.closedAt,
    decision:data.status==='decided'?data.decision as ReviewDisposition:null};
  }));
  return {scope:'isolated-economic-referrals' as const,rows,
   nextAfterCaseId:page.size>input.limit?rows[rows.length-1].caseId:null,
   consistentAcrossPages:false};
 },{readOnly:true});
}
