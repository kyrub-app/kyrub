import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { SEEDS_PER_BOSQUE, planPostSemeadura, type SemeaduraPostKind } from '../../shared/pitangueiraJourney.js';

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

    const data = stats.data();
    if (stats.exists && (
      data?.postId !== postId || data?.kind !== kind ||
      data?.authorId !== authorId || data?.communityId !== communityId ||
      !Number.isSafeInteger(data?.acceptedSeeds) || data.acceptedSeeds < 0 ||
      typeof data?.closed !== 'boolean'
    )) {
      throw new Error('SEMEADURA_STATS_INVALID');
    }
    if (receipt.exists &&
        (receipt.data()?.actorId !== actor || receipt.data()?.postId !== postId ||
         receipt.data()?.kind !== kind || receipt.data()?.authorId !== authorId)) {
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
    if (plan.count > SEEDS_PER_BOSQUE) throw Error('SEMEADURA_CAP_BROKEN');
    return { status: 'accepted' as const, count: plan.count, closed: plan.nowClosed, authorId };
  });
};
