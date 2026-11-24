import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { SEEDS_PER_BOSQUE, type SemeaduraPostKind } from '../../shared/pitangueiraJourney.js';
import { semeaduraDay } from '../../shared/semeaduraDailyLimit.js';
import { semeaduraEconomicPilotEnabled } from './semeaduraEconomicPilot.js';

const root = 'systemControl/semeaduraEconomicReview';
const SAMPLE_LIMIT = 500;
const uid = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
type Finding = 'INVALID_COUNTER' | 'ORPHAN_RECEIPTS' | 'COUNTER_BELOW_OBSERVED' |
  'COUNTER_RECEIPT_MISMATCH' | 'INVALID_RECEIPT' | 'SELF_SEED_RECEIPT';

/**
 * Read-only technical reconciliation, scoped to one canonical post and
 * limited to at most 501 receipt reads. No fraud score or automatic hold.
 * Partial coverage cannot establish integrity of the full publication.
 * No receipt identifiers or personal details leave this report.
 * Fixture authorization is not real administrative authentication.
 */
export async function inspectIsolatedSemeaduraEvidence(
  db: Firestore, reviewerId: string, input: {kind:SemeaduraPostKind;postId:string},
) {
  if (!semeaduraEconomicPilotEnabled(db)) throw Error('SEMEADURA_REVIEW_PILOT_DISABLED');
  if (!uid(reviewerId) || !input || !['personal','community'].includes(input.kind) ||
      typeof input.postId !== 'string' || !/^[A-Za-z0-9_-]{1,500}$/.test(input.postId))
    throw Error('SEMEADURA_REVIEW_INPUT_INVALID');
  const {kind,postId}=input;
  const key=createHash('sha256').update(kind+'\0'+postId).digest('hex');
  const statsRef=db.doc('semeadura_post_stats/'+key);
  return db.runTransaction(async tx=>{
    const reviewer=await tx.get(db.doc(root+'/reviewers/'+reviewerId));
    if(reviewer.get('schemaVersion')!==1||reviewer.get('reviewerId')!==reviewerId||
       reviewer.get('active')!==true||reviewer.get('fixtureOnly')!==true)
      throw Error('SEMEADURA_REVIEW_NOT_AUTHORIZED');
    const [stats,receipts]=await Promise.all([
      tx.get(statsRef),tx.get(statsRef.collection('receipts').limit(SAMPLE_LIMIT+1)),
    ]);
    const complete=receipts.size<=SAMPLE_LIMIT;
    const findings=new Set<Finding>();
    const data=stats.data();
    const projected=data?.acceptedSeeds;
    const counterValid=stats.exists&&data?.kind===kind&&data?.postId===postId&&uid(data?.authorId)&&
      (kind==='personal'?data?.communityId==='':uid(data?.communityId))&&
      Number.isSafeInteger(projected)&&projected>=0&&projected<=SEEDS_PER_BOSQUE&&
      data?.closed===(projected===SEEDS_PER_BOSQUE);
    if(stats.exists&&!counterValid)findings.add('INVALID_COUNTER');
    if(!stats.exists&&receipts.size>0)findings.add('ORPHAN_RECEIPTS');
    if(counterValid){
      if(projected<receipts.size)findings.add('COUNTER_BELOW_OBSERVED');
      else if(complete&&projected!==receipts.size)findings.add('COUNTER_RECEIPT_MISMATCH');
    }
    let invalidReceipts=0,selfReceipts=0,legacyWithoutQuotaDay=0;
    for(const receipt of receipts.docs){
      const r=receipt.data();
      const timestamp=typeof r.occurredAt==='string'?new Date(r.occurredAt):null;
      const validTime=timestamp!==null&&Number.isFinite(timestamp.getTime());
      if(r.quotaDay===undefined)legacyWithoutQuotaDay++;
      if(!uid(r.actorId)||r.actorId!==receipt.id||!uid(r.authorId)||r.kind!==kind||r.postId!==postId||
         (kind==='personal'?r.communityId!=='':!uid(r.communityId))||
         (counterValid&&(r.authorId!==data!.authorId||r.communityId!==data!.communityId))||
         !validTime||(r.quotaDay!==undefined&&(!validTime||r.quotaDay!==semeaduraDay(timestamp!)))){
        invalidReceipts++;findings.add('INVALID_RECEIPT');
      }
      if(uid(r.actorId)&&r.actorId===r.authorId){selfReceipts++;findings.add('SELF_SEED_RECEIPT');}
    }
    return {postKey:key,coverage:complete?'complete' as const:'partial' as const,
      projectedSeeds:counterValid?Number(projected):stats.exists?null:0,
      observedReceipts:receipts.size,invalidReceipts,selfReceipts,legacyWithoutQuotaDay,
      findings:[...findings].sort(),
      // This is a data-integrity signal, never an attribution of misconduct.
      requiresTechnicalReview:findings.size>0};
  },{readOnly:true});
}
