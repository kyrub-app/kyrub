import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { SEEDS_PER_BOSQUE, calculatePitangueiraJourney, planPostSemeadura, type SemeaduraPostKind } from '../../shared/pitangueiraJourney.js';

const safeUid = (value: string): boolean => /^[A-Za-z0-9_-]{1,128}$/.test(value);
const safePostId = (value: string): boolean => /^[A-Za-z0-9_-]{1,500}$/.test(value);

/**
 * Trusted-only foundation. Persists immutable seed receipts and the authoritative
 * per-post accepted-seeds counter atomically. It NEVER writes Pitangas or XP.
 *
 * Economic settlement is a separate release-gated, auditable step: do not
 * infer money-like rewards from display counts or legacy client-side likes.
 */
export const seedVerifiedPost = async (
  db: Firestore,
  input: { authenticatedUserId: string; kind: SemeaduraPostKind; postId: string },
): Promise<{
  status: 'accepted' | 'already_seeded' | 'closed';
  count: number;
  closed: boolean;
  authorId: string;
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
    const communityProgressRef = communityId
      ? db.doc(`communities/${communityId}/semeaduraProgress/summary`) : null;
    const [authorProgress, communityProgress] = await Promise.all([
      tx.get(authorProgressRef),
      communityProgressRef ? tx.get(communityProgressRef) : Promise.resolve(null),
    ]);
    // These are display counters, NOT balances or rewards. Reject corruption,
    // missing projections on already active posts, and mismatched ownership.
    const verifyProgress = (
      snapshot: { exists: boolean; data: () => Record<string, unknown> | undefined } | null,
      scopeId: string, field: 'authorId' | 'communityId',
    ): number => {
      if (!snapshot?.exists) {
        if (stats.exists) throw new Error('SEMEADURA_PROJECTION_UNAVAILABLE');
        return 0;
      }
      const value = snapshot.data();
      if (value?.[field] !== scopeId ||
          !Number.isSafeInteger(value?.acceptedSeeds) ||
          !Number.isSafeInteger(value?.[field === 'authorId' ? 'pitangueiras' : 'bosques']) ||
          Number(value?.acceptedSeeds) < 0) {
        throw new Error('SEMEADURA_PROJECTION_INVALID');
      }
      const progress = calculatePitangueiraJourney(Number(value.acceptedSeeds));
      if ((field === 'authorId' && value.pitangueiras !== progress.pitangueiras) ||
          (field === 'communityId' && value.bosques !== progress.bosques)) {
        throw new Error('SEMEADURA_PROJECTION_INVALID');
      }
      return Number(value.acceptedSeeds);
    };
    const authorTotal = verifyProgress(authorProgress, authorId, 'authorId');
    const communityTotal = communityProgressRef
      ? verifyProgress(communityProgress, communityId, 'communityId') : 0;
    const data = stats.data();
    if (stats.exists && (
      data?.postId !== postId || data?.kind !== kind ||
      data?.authorId !== authorId || data?.communityId !== communityId ||
      !Number.isSafeInteger(data?.acceptedSeeds) || data.acceptedSeeds < 0 ||
      typeof data?.closed !== 'boolean'
    )) {
      throw new Error('SEMEADURA_STATS_INVALID');
    }
    if (stats.exists && data?.closed === true && data.acceptedSeeds !== SEEDS_PER_BOSQUE) {
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
    const occurredAt = new Date().toISOString();
    tx.create(receiptRef, {
      kind, postId, communityId, authorId, actorId: actor, occurredAt,
    });
    const nextStats = {
      kind, postId, communityId, authorId,
      acceptedSeeds: plan.count, closed: plan.nowClosed, updatedAt: occurredAt,
      ...(plan.nowClosed ? { closedAt: occurredAt } : {}),
    };
    if (stats.exists) tx.update(statsRef, nextStats);
    else tx.create(statsRef, { ...nextStats, createdAt: occurredAt });
    const nextAuthorTotal = authorTotal + 1;
    const nextCommunityTotal = communityTotal + 1;
    if (!Number.isSafeInteger(nextAuthorTotal) || !Number.isSafeInteger(nextCommunityTotal)) {
      throw new Error('SEMEADURA_PROJECTION_OVERFLOW');
    }
    const authorData = {
      authorId, acceptedSeeds: nextAuthorTotal,
      pitangueiras: Math.floor(nextAuthorTotal / 1000),
      updatedAt: occurredAt,
    };
    if (authorProgress.exists) tx.update(authorProgressRef, authorData);
    else tx.create(authorProgressRef, { ...authorData, createdAt: occurredAt });
    if (communityProgressRef) {
      const communityData = {
        communityId, acceptedSeeds: nextCommunityTotal,
        bosques: Math.floor(nextCommunityTotal / SEEDS_PER_BOSQUE),
        updatedAt: occurredAt,
      };
      if (communityProgress?.exists) tx.update(communityProgressRef, communityData);
      else tx.create(communityProgressRef, { ...communityData, createdAt: occurredAt });
    }
    if (plan.count > SEEDS_PER_BOSQUE) throw Error('SEMEADURA_CAP_BROKEN');
    return { status: 'accepted' as const, count: plan.count, closed: plan.nowClosed, authorId };
  });
};

/**
 * Authenticated, read-only view of a post's seed progress and the caller's
 * receipt. This never uses legacy client-managed like counts.
 */
export const readVerifiedPostSemeadura = async (
  db: Firestore,
  input: { authenticatedUserId: string; kind: SemeaduraPostKind; postId: string },
): Promise<{
  count: number; closed: boolean; seeded: boolean; canSemear: boolean;
  authorId: string; pitangueiras: number; bosqueCompleted: boolean;
}> => {
  const { authenticatedUserId: actor, kind, postId } = input;
  if (!safeUid(actor) || !safePostId(postId) || (kind !== 'personal' && kind !== 'community')) {
    throw new Error('SEMEADURA_INVALID_INPUT');
  }
  const key = createHash('sha256').update(kind + '\\0' + postId).digest('hex');
  const postRef = db.doc(`${kind === 'community' ? 'community_posts' : 'social_posts'}/${postId}`);
  const statsRef = db.collection('semeadura_post_stats').doc(key);
  const receiptRef = statsRef.collection('receipts').doc(actor);
  const [post, stats, receipt] = await Promise.all([
    postRef.get(), statsRef.get(), receiptRef.get(),
  ]);
  if (!post.exists) throw new Error('SEMEADURA_POST_UNAVAILABLE');
  const postData = post.data();
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
      db.doc(`communities/${communityId}`).get(),
      db.doc(`community_members/${communityId}__${actor}`).get(),
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
        statsData?.closed !== (count === SEEDS_PER_BOSQUE)))) {
    throw new Error('SEMEADURA_STATS_INVALID');
  }
  if (receipt.exists && (!stats.exists || receipt.data()?.actorId !== actor ||
      receipt.data()?.postId !== postId || receipt.data()?.kind !== kind ||
      receipt.data()?.authorId !== authorId)) {
    throw new Error('SEMEADURA_RECEIPT_INVALID');
  }
  return {
    count, closed: count === SEEDS_PER_BOSQUE, seeded: receipt.exists,
    canSemear: canParticipate && actor !== authorId && !receipt.exists &&
      count < SEEDS_PER_BOSQUE,
    authorId, pitangueiras: Math.floor(count / 1000),
    bosqueCompleted: count === SEEDS_PER_BOSQUE,
  };
};

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
