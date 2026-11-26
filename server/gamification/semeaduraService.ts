import { evaluateStoredCapabilityAgeAccess } from '../../shared/ageEligibility.js';
import type { WelcomeAuth } from './signedSessionWelcomeService.js';
import { createHash } from 'node:crypto';
import { SEMEADURA_STATUS_BATCH_LIMIT, type SemeaduraStatusTarget } from './semeaduraRequestAuthority.js';
import type { Firestore, DocumentSnapshot } from 'firebase-admin/firestore';
import { SEMEADURA_DAILY_LIMIT, semeaduraDay, readSemeaduraDailyCount } from '../../shared/semeaduraDailyLimit.js';
import { assertSemeaduraReleaseOpenInTransaction } from './semeaduraReleaseControl.js';
import { noWelcomePilotEnabled } from './semeaduraNoWelcomeAuthority.js';
import { settleAcceptedSeedInTransaction } from './semeaduraEconomicPilot.js';
import { markIsolatedGamificationAuthorDirty } from './semeaduraAdminSupervision.js';
import { SEEDS_PER_BOSQUE, calculatePitangueiraJourney, planPostSemeadura, type SemeaduraPostKind } from '../../shared/pitangueiraJourney.js';

export class SemeaduraDailyLimitError extends Error {
  constructor(readonly day:string){super('SEMEADURA_DAILY_LIMIT_REACHED');}
}
const safeUid = (value: string): boolean => /^[A-Za-z0-9_-]{1,128}$/.test(value);
const safePostId = (value: string): boolean => /^[A-Za-z0-9_-]{1,500}$/.test(value);

/**
 * Trusted-only foundation. Persists immutable seed receipts and the authoritative
 * per-post accepted-seeds counter atomically. Normally visual only; an
 * explicitly enrolled local emulator pilot may settle a verified milestone.
 * No XP or production economic settlement is authorized here.
 */
type SeedInput={ authenticatedUserId: string; kind: SemeaduraPostKind; postId: string };
const seedPostTransaction = async (
  db: Firestore,
  input: SeedInput,
  releaseControlled: boolean,
  authorAuth?: WelcomeAuth,
  requireEconomicAdmission = false,
): Promise<{
  status: 'accepted' | 'already_seeded' | 'closed';
  count: number;
  closed: boolean;
  authorId: string;
  dailyDay?:string;
  dailyRemaining?:number;
}> => {
  const { authenticatedUserId: actor, kind, postId } = input;
  if (!safeUid(actor) || !safePostId(postId) ||
      (kind !== 'personal' && kind !== 'community')) {
    throw new Error('SEMEADURA_INVALID_INPUT');
  }

  // The SHA-256 key eliminates delimiter collisions across different post kinds.
  // The receipt is one-per-actor for the entire lifetime of this canonical post.
  const key = createHash('sha256').update(kind + '\0' + postId).digest('hex');
  const statsRef = db.collection('semeadura_post_stats').doc(key);
  const receiptRef = statsRef.collection('receipts').doc(actor);
  const postRef = db.doc(`${kind === 'community' ? 'community_posts' : 'social_posts'}/${postId}`);

  return db.runTransaction(async tx => {
    const [post, stats, receipt] = await Promise.all([
      tx.get(postRef), tx.get(statsRef), tx.get(receiptRef),
    ]);
    if (!post.exists) throw new Error('SEMEADURA_POST_UNAVAILABLE');
    const postData = post.data();
    if(postData?.institutionalChallengeId!==undefined)throw Error('SEMEADURA_POST_NOT_ELIGIBLE');
    const authorId = postData?.authorId;
    if (!safeUid(authorId) || postData?.postId !== postId) {
      throw new Error('SEMEADURA_POST_INVALID');
    }
    // Public personal posts only for this initial release. Friends-only,
    // private and expiring status posts require a separate visibility policy.
    if (kind === 'personal' &&
        (postData?.visibility !== 'public' || postData?.publicationType === 'status')) {
      throw new Error('SEMEADURA_POST_NOT_ELIGIBLE');
    }

    let communityId = '';
    if (kind === 'community') {
      communityId = postData?.communityId;
      if (!safeUid(communityId)) throw new Error('SEMEADURA_POST_INVALID');
      const communityRef = db.doc(`communities/${communityId}`);
      const memberRef = db.doc(`community_members/${communityId}__${actor}`);
      const [community, membership] = await Promise.all([
        tx.get(communityRef), tx.get(memberRef),
      ]);
      if (!community.exists || !['public', 'moderated', 'private'].includes(community.data()?.visibility) ||
          (community.data()?.ownerId !== actor &&
           (!membership.exists || membership.data()?.userId !== actor ||
            membership.data()?.communityId !== communityId || membership.data()?.status !== 'active'))) {
        throw new Error('SEMEADURA_COMMUNITY_ACCESS_DENIED');
      }
    }

    const authorProgressRef = db.doc(`users/${authorId}/semeaduraProgress/summary`);
    // Only the original author accumulates progress. Community identity
    // remains solely an access-control and canonical receipt attribute.
    const authorProgress = await tx.get(authorProgressRef);
    let authorTotal = 0;
    if (!authorProgress.exists) {
      if (stats.exists) throw Error('SEMEADURA_PROJECTION_UNAVAILABLE');
    } else {
      const value = authorProgress.data();
      if (value?.authorId !== authorId || !Number.isSafeInteger(value?.acceptedSeeds) ||
          value.acceptedSeeds < 0 || value.pitangueiras !== calculatePitangueiraJourney(value.acceptedSeeds).pitangueiras) {
        throw Error('SEMEADURA_PROJECTION_INVALID');
      }
      authorTotal = value.acceptedSeeds;
    }
    const data = stats.data();
    if (stats.exists && (
      data?.postId !== postId || data?.kind !== kind ||
      data?.authorId !== authorId || data?.communityId !== communityId ||
      !Number.isSafeInteger(data?.acceptedSeeds) || data.acceptedSeeds < 0 ||
      typeof data?.closed !== 'boolean'
    )) {
      throw new Error('SEMEADURA_STATS_INVALID');
    }
    if (stats.exists && data?.closed !== (data.acceptedSeeds === SEEDS_PER_BOSQUE)) {
      throw new Error('SEMEADURA_STATS_INVALID');
    }
    // A receipt without its canonical post counter is corrupt state. Never
    // silently treat this as a successful vote or infer an economic award.
    if (receipt.exists && !stats.exists) {
      throw new Error('SEMEADURA_ORPHAN_RECEIPT');
    }
    if (receipt.exists &&
        (receipt.data()?.actorId !== actor || receipt.data()?.postId !== postId ||
         receipt.data()?.kind !== kind || receipt.data()?.authorId !== authorId ||
         receipt.data()?.communityId !== communityId)) {
      throw new Error('SEMEADURA_RECEIPT_INVALID');
    }
    // Never trust the caller for a post's author or current count.
    const plan = planPostSemeadura({
      acceptedSeeds: stats.exists ? data!.acceptedSeeds : 0,
      closed: stats.exists ? data!.closed : false,
      alreadySeeded: receipt.exists,
      isAuthor: actor === authorId,
    });

    if (plan.status !== 'accepted') {
      return { status: plan.status, count: plan.count, closed: plan.nowClosed, authorId };
    }
    // Use the server clock within each transaction attempt. Day-specific
    // keys avoid carrying unused allowance or resetting lifetime receipts.
    const now = new Date();
    if(releaseControlled)await assertSemeaduraReleaseOpenInTransaction(db,tx,now);
    // Public acceptance must never fall back to a visual-only seed. The
    // isolated admission policy remains mandatory for every new receipt.
    if(requireEconomicAdmission&&(!authorAuth||authorAuth.app.options.projectId!=='demo-kyrub-welcome'||
      process.env.KYRUB_SEMEADURA_ZERO_START_PILOT!=='true'||!noWelcomePilotEnabled(db)))
      throw Error('SEMEADURA_RELEASE_UNAVAILABLE');
    // Staged only in the economic emulator pilot. Both decisions use private
    // server records in the same transaction as quota, receipts and rewards.
    if(requireEconomicAdmission&&process.env.KYRUB_SEMEADURA_AGE_PREVIEW_ENABLED==='true'){
      const [actorAge,authorAge]=await Promise.all([
        tx.get(db.doc('age_eligibility_private/'+actor)),
        tx.get(db.doc('age_eligibility_private/'+authorId)),
      ]);
      if(!evaluateStoredCapabilityAgeAccess({actorUid:actor,record:actorAge.data(),capability:'sowing',policy:'verified_adult_only'})||
         !evaluateStoredCapabilityAgeAccess({actorUid:authorId,record:authorAge.data(),capability:'rewards',policy:'verified_adult_only'}))
        throw Error('SEMEADURA_AGE_REQUIRED');
    }
    const occurredAt = now.toISOString();
    const day = semeaduraDay(now);
    const quotaRef = db.doc(`users/${actor}/semeaduraDailyUsage/${day}`);
    const quota = await tx.get(quotaRef);
    const used = readSemeaduraDailyCount(quota.data(),actor,day);
    if(used>=SEMEADURA_DAILY_LIMIT)throw new SemeaduraDailyLimitError(day);
    await settleAcceptedSeedInTransaction(db,tx,{authorId,actorId:actor,previousSeeds:authorTotal,occurredAt,postKey:key,
      authorAuth,strictCurrencyAuthority:requireEconomicAdmission,zeroStartRequired:requireEconomicAdmission||(releaseControlled&&process.env.KYRUB_SEMEADURA_ZERO_START_PILOT==='true')});
    const quotaData={schemaVersion:1,actorId:actor,day,count:used+1,updatedAt:occurredAt};
    if(quota.exists)tx.update(quotaRef,quotaData);
    else tx.create(quotaRef,quotaData);
    tx.create(receiptRef, {
      kind, postId, communityId, authorId, actorId: actor, occurredAt,
      quotaDay:day,
    });
    const nextStats = {
      kind, postId, communityId, authorId,
      acceptedSeeds: plan.count, closed: plan.nowClosed, updatedAt: occurredAt,
      ...(plan.nowClosed ? { closedAt: occurredAt } : {}),
    };
    if (stats.exists) tx.update(statsRef, nextStats);
    else tx.create(statsRef, { ...nextStats, createdAt: occurredAt });
    const nextAuthorTotal = authorTotal + 1;
    if (!Number.isSafeInteger(nextAuthorTotal)) {
      throw new Error('SEMEADURA_PROJECTION_OVERFLOW');
    }
    const authorData = {
      authorId, acceptedSeeds: nextAuthorTotal,
      pitangueiras: Math.floor(nextAuthorTotal / 1000),
      updatedAt: occurredAt,
    };
    if (authorProgress.exists) tx.update(authorProgressRef, authorData);
    else tx.create(authorProgressRef, { ...authorData, createdAt: occurredAt });
    if (plan.count > SEEDS_PER_BOSQUE) throw Error('SEMEADURA_CAP_BROKEN');
    markIsolatedGamificationAuthorDirty(db,tx,authorId,occurredAt);
    return { status: 'accepted' as const, count: plan.count, closed: plan.nowClosed, authorId,
      ...(releaseControlled?{dailyDay:day,dailyRemaining:SEMEADURA_DAILY_LIMIT-used-1}:{}) };
  });
};

/** Internal foundation retained for trusted test fixtures. Public transport
 * must use the economic-admission entry, never these fixture adapters. */
export const seedVerifiedPost=(db:Firestore,input:SeedInput)=>seedPostTransaction(db,input,false);
export const seedReleaseControlledPost=(db:Firestore,input:SeedInput,authorAuth?:WelcomeAuth)=>seedPostTransaction(db,input,true,authorAuth);

/** Only public mutation adapter. Still emulator-only; commercial authority
 * must be separately reviewed, never enabled by copying these flags. */
export const seedEconomicallyAdmittedPost=(db:Firestore,input:SeedInput,authorAuth:WelcomeAuth)=>seedPostTransaction(db,input,true,authorAuth,true);

/**
 * Authenticated, read-only view of a post's seed progress and the caller's
 * receipt. This never uses legacy client-managed like counts.
 */
const readPostStatus = async (
  db: Firestore,
  input: { authenticatedUserId: string; kind: SemeaduraPostKind; postId: string },
  readShared:(path:string)=>Promise<DocumentSnapshot>,
  dailyDay:string,
): Promise<{
  count: number; closed: boolean; seeded: boolean; canSemear: boolean;
  authorId: string; pitangueiras: number; bosqueCompleted: boolean;
  dailyDay:string; dailyRemaining:number;
}> => {
  const { authenticatedUserId: actor, kind, postId } = input;
  if (!safeUid(actor) || !safePostId(postId) || (kind !== 'personal' && kind !== 'community')) {
    throw new Error('SEMEADURA_INVALID_INPUT');
  }
  const key = createHash('sha256').update(kind + '\0' + postId).digest('hex');
  const postRef = db.doc(`${kind === 'community' ? 'community_posts' : 'social_posts'}/${postId}`);
  const statsRef = db.collection('semeadura_post_stats').doc(key);
  const receiptRef = statsRef.collection('receipts').doc(actor);
  const [post, stats, receipt, quota] = await Promise.all([
    postRef.get(), statsRef.get(), receiptRef.get(),
    readShared(`users/${actor}/semeaduraDailyUsage/${dailyDay}`),
  ]);
  if (!post.exists) throw new Error('SEMEADURA_POST_UNAVAILABLE');
  const postData = post.data();
  if(postData?.institutionalChallengeId!==undefined)throw Error('SEMEADURA_POST_NOT_ELIGIBLE');
  const authorId = postData?.authorId;
  if (!safeUid(authorId) || postData?.postId !== postId) throw new Error('SEMEADURA_POST_INVALID');
  let canParticipate = true;
  if (kind === 'personal') {
    if (postData?.visibility !== 'public' || postData?.publicationType === 'status') {
      throw new Error('SEMEADURA_POST_NOT_ELIGIBLE');
    }
  } else {
    const communityId = postData?.communityId;
    if (!safeUid(communityId)) throw new Error('SEMEADURA_POST_INVALID');
    const [community, membership] = await Promise.all([
      readShared(`communities/${communityId}`),
      readShared(`community_members/${communityId}__${actor}`),
    ]);
    if (!community.exists) throw new Error('SEMEADURA_POST_UNAVAILABLE');
    const isOwner = community.data()?.ownerId === actor;
    const isMember = membership.exists &&
      membership.data()?.userId === actor &&
      membership.data()?.communityId === communityId &&
      membership.data()?.status === 'active';
    const publicCommunity = ['public', 'moderated'].includes(community.data()?.visibility);
    if (!publicCommunity && !isOwner && !isMember) {
      throw new Error('SEMEADURA_COMMUNITY_ACCESS_DENIED');
    }
    canParticipate = isOwner || Boolean(isMember);
  }
  const statsData = stats.data();
  const count = stats.exists ? statsData?.acceptedSeeds : 0;
  if (!Number.isSafeInteger(count) || count < 0 || count > SEEDS_PER_BOSQUE ||
      (stats.exists && (statsData?.authorId !== authorId ||
        statsData?.kind !== kind || statsData?.postId !== postId ||
        statsData?.communityId !== (kind === 'community' ? postData?.communityId : '') ||
        statsData?.closed !== (count === SEEDS_PER_BOSQUE)))) {
    throw new Error('SEMEADURA_STATS_INVALID');
  }
  if (receipt.exists && (!stats.exists || receipt.data()?.actorId !== actor ||
      receipt.data()?.postId !== postId || receipt.data()?.kind !== kind ||
      receipt.data()?.authorId !== authorId ||
      receipt.data()?.communityId !== (kind === 'community' ? postData?.communityId : ''))) {
    throw new Error('SEMEADURA_RECEIPT_INVALID');
  }
  const dailyRemaining=SEMEADURA_DAILY_LIMIT-readSemeaduraDailyCount(quota.data(),actor,dailyDay);
  return {
    dailyDay,dailyRemaining,
    count, closed: count === SEEDS_PER_BOSQUE, seeded: receipt.exists,
    canSemear: canParticipate && actor !== authorId && !receipt.exists &&
      count < SEEDS_PER_BOSQUE && dailyRemaining>0,
    authorId, pitangueiras: Math.floor(count / 1000),
    bosqueCompleted: count === SEEDS_PER_BOSQUE,
  };
};

export const readVerifiedPostSemeadura=(db:Firestore,input:{authenticatedUserId:string;kind:SemeaduraPostKind;postId:string})=>
 readPostStatus(db,input,path=>db.doc(path).get(),semeaduraDay(new Date()));

/** Share only quota and membership lookups within this authenticated request.
 * Each target independently validates its canonical visibility and receipt.
 * Errors expose no private post metadata, and never trigger writes. */
export async function readVerifiedPostSemeaduraBatch(db:Firestore,actor:string,targets:SemeaduraStatusTarget[]){
 if(!safeUid(actor)||!Array.isArray(targets)||targets.length<1||targets.length>SEMEADURA_STATUS_BATCH_LIMIT||
  targets.some(t=>!t||!safePostId(t.postId)||(t.kind!=='personal'&&t.kind!=='community'))||
  new Set(targets.map(t=>JSON.stringify([t.kind,t.postId]))).size!==targets.length)
  throw Error('SEMEADURA_INVALID_INPUT');
 const reads=new Map<string,Promise<DocumentSnapshot>>();
 const shared=(path:string)=>{
  let pending=reads.get(path);
  if(!pending){pending=db.doc(path).get();reads.set(path,pending);}
  return pending;
 };
 const day=semeaduraDay(new Date());
 return {results:await Promise.all(targets.map(async target=>{
  try{return {...target,status:await readPostStatus(db,{...target,authenticatedUserId:actor},shared,day)};}
  catch{return {...target,status:null};}
 }))};
}

/**
 * The personal view is scoped to the verified logged-in UID.
 * Lifetime seed counters are informative and NEVER spendable balances.
 */
export const readPersonalSemeaduraJourney = async (db: Firestore, uid: string) => {
  if (!safeUid(uid)) throw new Error('SEMEADURA_INVALID_INPUT');
  const snap = await db.doc(`users/${uid}/semeaduraProgress/summary`).get();
  if (!snap.exists) return calculatePitangueiraJourney(0);
  const data = snap.data();
  if (data?.authorId !== uid ||
      !Number.isSafeInteger(data.acceptedSeeds) || data.acceptedSeeds < 0 ||
      data.pitangueiras !== Math.floor(data.acceptedSeeds / 1000)) {
    throw new Error('SEMEADURA_PROJECTION_INVALID');
  }
  return calculatePitangueiraJourney(data.acceptedSeeds);
};
