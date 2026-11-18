import { FieldValue } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';

type ModeratorRole = 'super_admin' | 'operations' | 'compliance';
interface AuthorizedModerator { uid: string; role: ModeratorRole; }
export interface ModerationPost {
  id: string; authorId: string; authorName: string; content: string;
  publicationType: 'feed' | 'status'; visibility: string; createdAtIso: string; mediaUrls: string[];
}
const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const stringList = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
const bearerToken = (authorization: string): string => /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const authorizeModerator = async (authorization: string): Promise<AuthorizedModerator> => {
  const token = bearerToken(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const decoded = await verifyFirebaseIdToken(token);
  if (decoded.emailVerified !== true) throw new Error('EMAIL_NOT_VERIFIED');
  const snapshot = await adminDb.doc(`kyrub_admin/control_plane/admins/${decoded.uid}`).get();
  const data = snapshot.data() as Record<string, unknown> | undefined;
  const role = clean(data?.role);
  if (!snapshot.exists || clean(data?.uid) !== decoded.uid || clean(data?.status) !== 'active' || !['super_admin','operations','compliance'].includes(role)) throw new Error('FORBIDDEN');
  return { uid: decoded.uid, role: role as ModeratorRole };
};

export const listModerationPosts = async (authorization: string): Promise<ModerationPost[]> => {
  await authorizeModerator(authorization);
  const snapshot = await adminDb.collection('social_posts').orderBy('createdAt', 'desc').limit(100).get();
  return snapshot.docs.map(document => {
    const data = document.data() as Record<string, unknown>;
    return { id: document.id, authorId: clean(data.authorId), authorName: clean(data.authorName) || clean(data.user) || 'Usuário Kyrub', content: clean(data.content), publicationType: data.publicationType === 'status' ? 'status' : 'feed', visibility: clean(data.visibility), createdAtIso: clean(data.createdAtIso), mediaUrls: stringList(data.mediaUrls) };
  });
};

export interface ModerationReview {
  id: string; storeId: string; authorId: string; authorName: string;
  content: string; rating: number; postId: string;
}
export interface ModerationReport {
  id: string;
  kind: 'post' | 'user' | 'review';
  postId: string;
  targetUserId: string;
  reporterId: string;
  reason: string;
  createdAtIso: string;
  post: ModerationPost | null;
  storeId?: string;
  reviewId?: string;
  review?: ModerationReview | null;
}

const asModerationPost = (id: string, data: Record<string, unknown>): ModerationPost => ({
  id,
  authorId: clean(data.authorId),
  authorName: clean(data.authorName) || clean(data.user) || 'Usuário Kyrub',
  content: clean(data.content),
  publicationType: data.publicationType === 'status' ? 'status' : 'feed',
  visibility: clean(data.visibility),
  createdAtIso: clean(data.createdAtIso),
  mediaUrls: stringList(data.mediaUrls),
});

export const listModerationReports = async (authorization: string): Promise<ModerationReport[]> => {
  await authorizeModerator(authorization);
  const [postReports, userReports, reviewReports] = await Promise.all([
    adminDb.collection('social_post_reports').where('status', '==', 'pending').limit(100).get(),
    adminDb.collection('social_user_reports').where('status', '==', 'pending').limit(100).get(),
    adminDb.collection('store_review_reports').where('status', '==', 'pending').limit(100).get(),
  ]);
  const postIds = [...new Set(postReports.docs.map(document => clean(document.data().postId))
    .filter(id => id.length > 0 && id.length <= 500 && !id.includes('/')))];
  const snapshots = postIds.length > 0
    ? await adminDb.getAll(...postIds.map(id => adminDb.doc(`social_posts/${id}`)))
    : [];
  const postById = new Map(snapshots.filter(snapshot => snapshot.exists)
    .map(snapshot => [snapshot.id, asModerationPost(snapshot.id, snapshot.data() as Record<string, unknown>)]));
  const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(value);
  const reviewPaths = [...new Set(reviewReports.docs.map(document => {
    const data = document.data();
    const storeId = clean(data.storeId); const reviewId = clean(data.reviewId);
    return safeId(storeId) && safeId(reviewId)
      ? `store_reviews/${storeId}/reviews/${reviewId}` : '';
  }).filter(Boolean))];
  const reviewSnapshots = reviewPaths.length
    ? await adminDb.getAll(...reviewPaths.map(path => adminDb.doc(path)))
    : [];
  const reviewByPath = new Map(reviewSnapshots.filter(snapshot => snapshot.exists)
    .map(snapshot => {
      const data = snapshot.data() as Record<string, unknown>;
      return [snapshot.ref.path, {
        id: snapshot.id, storeId: clean(data.storeId), authorId: clean(data.authorId),
        authorName: clean(data.authorName) || 'Kairubido', content: clean(data.content),
        rating: typeof data.rating === 'number' ? data.rating : 0,
        postId: clean(data.postId),
      } as ModerationReview] as const;
    }));
  const toCreatedAt = (value: unknown): string => {
    const stamp = value as { toDate?: () => Date } | null;
    return typeof stamp?.toDate === 'function' ? stamp.toDate().toISOString() : '';
  };
  const reports: ModerationReport[] = [
    ...postReports.docs.map(document => {
      const data = document.data();
      const postId = clean(data.postId);
      return { id: document.id, kind: 'post' as const, postId, targetUserId: '',
        reporterId: clean(data.reporterId), reason: clean(data.reason), createdAtIso: toCreatedAt(data.createdAt),
        post: postById.get(postId) ?? null };
    }),
    ...userReports.docs.map(document => {
      const data = document.data();
      return { id: document.id, kind: 'user' as const, postId: '',
        targetUserId: clean(data.targetUserId), reporterId: clean(data.reporterId),
        reason: clean(data.reason), createdAtIso: toCreatedAt(data.createdAt), post: null };
    }),
    ...reviewReports.docs.map(document => {
      const data = document.data();
      const storeId = clean(data.storeId); const reviewId = clean(data.reviewId);
      const reviewPath = `store_reviews/${storeId}/reviews/${reviewId}`;
      return { id: document.id, kind: 'review' as const, postId: '',
        targetUserId: '', storeId, reviewId, reporterId: clean(data.reporterId),
        reason: clean(data.reason), createdAtIso: toCreatedAt(data.createdAt),
        post: null, review: reviewByPath.get(reviewPath) ?? null };
    }),
  ];
  return reports.sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso));
};

export const dismissModerationReport = async (
  authorization: string, kindValue: unknown, reportIdValue: unknown, reasonValue: unknown
) => {
  const admin = await authorizeModerator(authorization);
  const kind = clean(kindValue);
  const reportId = clean(reportIdValue);
  const reason = clean(reasonValue);
  if (kind !== 'post' && kind !== 'user' && kind !== 'review') throw new Error('INVALID_REPORT');
  if (!reportId || reportId.length > 650 || reportId.includes('/')) throw new Error('INVALID_REPORT');
  if (reason.length < 3 || reason.length > 500) throw new Error('INVALID_REASON');
  const collectionName = kind === 'post' ? 'social_post_reports'
    : kind === 'user' ? 'social_user_reports' : 'store_review_reports';
  const reference = adminDb.doc(`${collectionName}/${reportId}`);
  const auditId = `report_review_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  return adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new Error('REPORT_NOT_FOUND');
    if (snapshot.data()?.status !== 'pending') return { status: 'already_reviewed' as const };
    transaction.update(reference, {
      status: 'reviewed', resolution: 'dismissed', reviewedBy: admin.uid,
      reviewReason: reason, reviewedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(adminDb.doc(`kyrub_admin/control_plane/audit_logs/${auditId}`), {
      id: auditId, action: 'admin.social.report.dismissed', actorId: admin.uid, actorRole: admin.role,
      targetType: kind === 'post' ? 'social_post_report'
        : kind === 'user' ? 'social_user_report' : 'store_review_report',
      targetId: reportId, source: 'server', reason,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { status: 'reviewed' as const };
  });
};

const isValidReviewId = (value: string): boolean => /^[a-zA-Z0-9_-]{1,128}$/.test(value);

/** A completed moderation action closes pending review reports, not their evidence. */
const resolvePendingReviewReports = async (
  admin: AuthorizedModerator, storeId: string, reviewId: string, reason: string
): Promise<number> => {
  const snapshot = await adminDb.collection('store_review_reports').where('reviewId', '==', reviewId).get();
  const pending = snapshot.docs.filter(document =>
    document.data().storeId === storeId && document.data().status === 'pending');
  for (let offset = 0; offset < pending.length; offset += 400) {
    const batch = adminDb.batch();
    for (const report of pending.slice(offset, offset + 400)) {
      batch.update(report.ref, {
        status: 'reviewed', resolution: 'hidden', reviewedBy: admin.uid,
        reviewReason: reason, reviewedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }
  return pending.length;
};

const deleteByPostId = async (collectionName: string, postId: string): Promise<number> => {
  const snapshot = await adminDb.collection(collectionName).where('postId', '==', postId).get();
  if (snapshot.empty) return 0;
  const batch = adminDb.batch();
  snapshot.docs.forEach(document => batch.delete(document.ref));
  await batch.commit();
  return snapshot.size;
};

export const removeModeratedPost = async (authorization: string, postIdValue: unknown, reasonValue: unknown) => {
  const admin = await authorizeModerator(authorization);
  const postId = clean(postIdValue); const reason = clean(reasonValue);
  if (!postId || postId.length > 500) throw new Error('INVALID_POST');
  if (reason.length < 3 || reason.length > 500) throw new Error('INVALID_REASON');
  const postRef = adminDb.doc(`social_posts/${postId}`);
  const post = await postRef.get();
  if (!post.exists) throw new Error('POST_NOT_FOUND');
  const postData = post.data() as Record<string, unknown>;
  const dependencies = ['social_post_likes','social_post_comments','social_post_engagements','social_post_campaigns'];
  const deleted: Record<string, number> = {};
  for (const name of dependencies) deleted[name] = await deleteByPostId(name, postId);
  // If this post is a store review, hide its canonical review with the same
  // authoritative moderation decision. Never leave removed harmful text on a
  // storefront while suppressing only the Praça copy.
  let hiddenReview = false;
  const postRemoval = adminDb.batch();
  postRemoval.delete(postRef);
  const linked = postData.storeReview as Record<string, unknown> | undefined;
  const linkedStoreId = clean(linked?.storeId);
  const linkedReviewId = clean(linked?.reviewId);
  if (/^[a-zA-Z0-9_-]{1,128}$/.test(linkedStoreId)
      && /^[a-zA-Z0-9_-]{1,128}$/.test(linkedReviewId)) {
    const reviewRef = adminDb.doc(`store_reviews/${linkedStoreId}/reviews/${linkedReviewId}`);
    const reviewSnapshot = await reviewRef.get();
    if (reviewSnapshot.exists && reviewSnapshot.data()?.postId === postId
        && reviewSnapshot.data()?.authorId === clean(postData.authorId)
        && reviewSnapshot.data()?.status === 'published') {
      postRemoval.update(reviewRef, {
        status: 'hidden', reviewedBy: admin.uid, reviewReason: reason,
        reviewedAt: FieldValue.serverTimestamp(),
      });
      hiddenReview = true;
    }
  }
  await postRemoval.commit();
  const resolvedReviewReports = hiddenReview
    ? await resolvePendingReviewReports(admin, linkedStoreId, linkedReviewId, reason)
    : 0;
  // Keep reported content evidence and outcome for audit; never erase the complaint ledger.
  const reportSnapshots = await adminDb.collection('social_post_reports').where('postId', '==', postId).get();
  let resolvedReports = 0;
  const pending = reportSnapshots.docs.filter(document => document.data().status === 'pending');
  for (let offset = 0; offset < pending.length; offset += 400) {
    const batch = adminDb.batch();
    const chunk = pending.slice(offset, offset + 400);
    for (const report of chunk) batch.update(report.ref, {
      status: 'reviewed', resolution: 'removed', reviewedBy: admin.uid,
      reviewReason: reason, reviewedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
    resolvedReports += chunk.length;
  }
  const auditId = `moderation_${Date.now()}_${Math.random().toString(36).slice(2,12)}`;
  await adminDb.doc(`kyrub_admin/control_plane/audit_logs/${auditId}`).set({
    id: auditId, action: 'admin.social.post.removed', actorId: admin.uid, actorRole: admin.role,
    targetType: 'social_post', targetId: postId, source: 'server', reason,
    targetAuthorId: clean(postData.authorId), deletedDependencies: deleted, resolvedReports,
    hiddenReview, resolvedReviewReports, createdAt: FieldValue.serverTimestamp(),
  });
  return { status: 'removed' as const, postId, deletedDependencies: deleted,
    resolvedReports, hiddenReview, resolvedReviewReports };
};

/**
 * A human moderator hides a canonical review. If it was shared in the Praça,
 * use the existing cross-surface removal operation to clean related likes,
 * comments, reports, and the linked storefront review together.
 */
export const hideModeratedStoreReview = async (
  authorization: string,
  storeIdValue: unknown,
  reviewIdValue: unknown,
  reasonValue: unknown,
) => {
  const admin = await authorizeModerator(authorization);
  const storeId = clean(storeIdValue);
  const reviewId = clean(reviewIdValue);
  const reason = clean(reasonValue);
  if (!isValidReviewId(storeId) || !isValidReviewId(reviewId)) throw new Error('INVALID_REVIEW');
  if (reason.length < 3 || reason.length > 500) throw new Error('INVALID_REASON');
  const reviewRef = adminDb.doc(`store_reviews/${storeId}/reviews/${reviewId}`);
  const snapshot = await reviewRef.get();
  if (!snapshot.exists) throw new Error('REVIEW_NOT_FOUND');
  const data = snapshot.data() as Record<string, unknown>;
  if (clean(data.storeId) !== storeId || clean(data.authorId) !== reviewId) {
    throw new Error('REVIEW_NOT_FOUND');
  }
  if (data.status === 'hidden') {
    const resolvedReports = await resolvePendingReviewReports(admin, storeId, reviewId, reason);
    return { status: 'already_hidden' as const, storeId, reviewId, resolvedReports };
  }
  if (data.status !== 'published') throw new Error('REVIEW_NOT_FOUND');
  const postId = clean(data.postId);
  let removedLinkedPost = false;
  if (postId) {
    if (postId !== `review_${storeId}_${reviewId}`) throw new Error('REVIEW_POST_LINK_MISMATCH');
    const postSnapshot = await adminDb.doc(`social_posts/${postId}`).get();
    if (postSnapshot.exists) {
      const postData = postSnapshot.data() as Record<string, unknown>;
      const metadata = postData.storeReview as Record<string, unknown> | undefined;
      if (clean(metadata?.storeId) !== storeId ||
          clean(metadata?.reviewId) !== reviewId ||
          clean(postData.authorId) !== reviewId) {
        throw new Error('REVIEW_POST_LINK_MISMATCH');
      }
      const result = await removeModeratedPost(authorization, postId, reason);
      if (!result.hiddenReview) throw new Error('REVIEW_POST_LINK_MISMATCH');
      removedLinkedPost = true;
    }
  }
  if (!removedLinkedPost) {
    await reviewRef.update({
      status: 'hidden', reviewedBy: admin.uid, reviewReason: reason,
      reviewedAt: FieldValue.serverTimestamp(),
    });
  }
  const resolvedReports = await resolvePendingReviewReports(admin, storeId, reviewId, reason);
  const auditId = `store_review_moderation_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  await adminDb.doc(`kyrub_admin/control_plane/audit_logs/${auditId}`).set({
    id: auditId, action: 'admin.social.store_review.hidden', actorId: admin.uid,
    actorRole: admin.role, targetType: 'store_review',
    targetId: `${storeId}/${reviewId}`, storeId, reviewId,
    removedLinkedPost, resolvedReports, reason, source: 'server',
    createdAt: FieldValue.serverTimestamp(),
  });
  return { status: 'hidden' as const, storeId, reviewId, removedLinkedPost, resolvedReports };
};

export const mapSocialModerationError = (error: unknown) => {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'AUTH_REQUIRED') return { status: 401, body: { error: 'Faça login novamente.', code } };
  if (code === 'EMAIL_NOT_VERIFIED' || code === 'FORBIDDEN') return { status: 403, body: { error: 'Acesso de moderação não autorizado.', code } };
  if (code === 'POST_NOT_FOUND' || code === 'REPORT_NOT_FOUND' || code === 'REVIEW_NOT_FOUND') return { status: 404, body: { error: 'Publicação ou denúncia não encontrada.', code } };
  if (code === 'INVALID_POST' || code === 'INVALID_REPORT' || code === 'INVALID_REVIEW' || code === 'INVALID_REASON') return { status: 400, body: { error: 'Revise a publicação e o motivo informado.', code } };
  if (code === 'REVIEW_POST_LINK_MISMATCH') return { status: 409,
    body: { error: 'Vínculo entre avaliação e publicação inconsistente. Requer análise manual.', code } };
  console.error('[Admin Social Moderation]', error);
  return { status: 503, body: { error: 'Não foi possível concluir a moderação agora.', code: 'SOCIAL_MODERATION_FAILED' } };
};
