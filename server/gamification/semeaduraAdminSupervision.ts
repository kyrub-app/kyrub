import type { Auth } from 'firebase-admin/auth';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { kyrubKCoinBalance, type KyrubRewardLedgerEntry } from '../../shared/gamification.js';
import { calculatePitangueiraJourney } from '../../shared/pitangueiraJourney.js';
import { semeaduraEconomicPilotEnabled } from './semeaduraEconomicPilot.js';

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
  const [summary,prior,source]=await Promise.all([tx.get(ref),tx.get(contributionRef),readAccountProjection(db,tx,targetUid)]);
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
