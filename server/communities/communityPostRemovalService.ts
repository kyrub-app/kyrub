import { FieldValue } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb, adminStorage } from '../firebaseAdmin.js';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const validId = (value: string): boolean => /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const mediaValues = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

export interface CommunityPostCleanup {
  deletedInteractions: Record<string, number>;
  deletedMedia: number;
  failedMediaCleanup: number;
}

/** Shared post cleanup for human moderation and author-initiated removal.
 * No new public Firestore/Storage rule is needed: server checks author identity
 * before the post is removed, and Admin SDK only cleans bounded references. */
export const cleanupRemovedCommunityPost = async (
  postId: string,
  postData: Record<string, unknown>
): Promise<CommunityPostCleanup> => {
  const deletedInteractions: Record<string, number> = {};
  for (const name of ['community_post_likes', 'community_post_comments', 'community_post_engagements']) {
    const entries = await adminDb.collection(name).where('postId', '==', postId).get();
    deletedInteractions[name] = 0;
    for (let offset = 0; offset < entries.docs.length; offset += 400) {
      const part = entries.docs.slice(offset, offset + 400);
      const batch = adminDb.batch();
      part.forEach(item => batch.delete(item.ref));
      await batch.commit();
      deletedInteractions[name] += part.length;
    }
  }

  // Author removal and moderator removal must also retract Praça discovery.
  // The canonical post is already gone; keep a stale pointer from resurfacing.
  await adminDb.collection('community_square_posts').doc(postId).delete();

  const communityId = clean(postData.communityId);
  const authorId = clean(postData.authorId);
  const bucketName = 'kyrub-b8d0e.firebasestorage.app';
  const prefix = `community-post-media/${communityId}/${authorId}/`;
  let deletedMedia = 0;
  let failedMediaCleanup = 0;
  if (validId(communityId) && validId(authorId)) {
    for (const mediaUrl of mediaValues(postData.mediaUrls).slice(0, 9)) {
      try {
        const url = new URL(mediaUrl);
        const match = /^\/v0\/b\/([^/]+)\/o\/(.+)$/.exec(url.pathname);
        const objectName = match ? decodeURIComponent(match[2]) : '';
        // Do not accept lookalike prefixes: every path belongs to this author/community.
        if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com'
          || match?.[1] !== bucketName || !objectName.startsWith(prefix)
          || objectName.slice(prefix.length).includes('/')) continue;
        await adminStorage.bucket(bucketName).file(objectName).delete({ ignoreNotFound: true });
        deletedMedia += 1;
      } catch {
        failedMediaCleanup += 1;
        console.error('[Community Posts] Media cleanup failed', { postId });
      }
    }
  }
  return { deletedInteractions, deletedMedia, failedMediaCleanup };
};

/** For the author's three-dot menu, not the moderator/admin endpoint. */
export const removeOwnCommunityPost = async (
  authorization: string,
  postIdValue: unknown,
): Promise<{ status: 'removed'; postId: string; cleanup: CommunityPostCleanup }> => {
  const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';
  if (!token) throw new Error('AUTH_REQUIRED');
  const actor = await verifyFirebaseIdToken(token);
  const postId = clean(postIdValue);
  if (!validId(postId)) throw new Error('INVALID_POST');

  const postRef = adminDb.doc(`community_posts/${postId}`);
  const auditRef = adminDb.doc(`kyrub_admin/control_plane/audit_logs/community_author_removal_${postId}`);
  const data = await adminDb.runTransaction(async tx => {
    const snapshot = await tx.get(postRef);
    if (!snapshot.exists) throw new Error('POST_NOT_FOUND');
    const post = snapshot.data() as Record<string, unknown>;
    if (post.authorId !== actor.uid) throw new Error('FORBIDDEN');
    tx.delete(postRef);
    tx.set(auditRef, {
      id: auditRef.id, action: 'community.post.author_removed',
      actorId: actor.uid, actorRole: 'author', targetType: 'community_post',
      targetId: postId, communityId: clean(post.communityId),
      source: 'server', createdAt: FieldValue.serverTimestamp(),
      cleanupStatus: 'pending',
    });
    return post;
  });

  // Complaints stay available to human moderators; author deletion never
  // dismisses a report or fabricates a human moderation decision.
  let cleanup: CommunityPostCleanup;
  try {
    cleanup = await cleanupRemovedCommunityPost(postId, data);
  } catch (error) {
    await auditRef.update({ cleanupStatus: 'failed', cleanupUpdatedAt: FieldValue.serverTimestamp() });
    console.error('[Community Posts] Post removed but associated records require cleanup', { postId });
    throw new Error('POST_REMOVED_CLEANUP_FAILED', { cause: error });
  }
  await auditRef.update({
    cleanupStatus: cleanup.failedMediaCleanup ? 'partial' : 'complete',
    ...cleanup,
    cleanupUpdatedAt: FieldValue.serverTimestamp(),
  });
  return { status: 'removed', postId, cleanup };
};
