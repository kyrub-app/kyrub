import { FieldValue } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';

type ModeratorRole = 'super_admin' | 'operations' | 'compliance';
interface AuthorizedModerator { uid: string; role: ModeratorRole; }
export interface ModerationPost {
  id: string; authorId: string; authorName: string; content: string;
  publicationType: 'feed' | 'status'; visibility: string; createdAtIso: string;
}
const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
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
    return { id: document.id, authorId: clean(data.authorId), authorName: clean(data.authorName) || clean(data.user) || 'Usuário Kyrub', content: clean(data.content), publicationType: data.publicationType === 'status' ? 'status' : 'feed', visibility: clean(data.visibility), createdAtIso: clean(data.createdAtIso) };
  });
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
  const dependencies = ['social_post_likes','social_post_comments','social_post_reports','social_post_engagements'];
  const deleted: Record<string, number> = {};
  for (const name of dependencies) deleted[name] = await deleteByPostId(name, postId);
  await postRef.delete();
  const auditId = `moderation_${Date.now()}_${Math.random().toString(36).slice(2,12)}`;
  await adminDb.doc(`kyrub_admin/control_plane/audit_logs/${auditId}`).set({
    id: auditId, action: 'admin.social.post.removed', actorId: admin.uid, actorRole: admin.role,
    targetType: 'social_post', targetId: postId, source: 'server', reason,
    targetAuthorId: clean(postData.authorId), deletedDependencies: deleted, createdAt: FieldValue.serverTimestamp(),
  });
  return { status: 'removed' as const, postId, deletedDependencies: deleted };
};

export const mapSocialModerationError = (error: unknown) => {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'AUTH_REQUIRED') return { status: 401, body: { error: 'Faça login novamente.', code } };
  if (code === 'EMAIL_NOT_VERIFIED' || code === 'FORBIDDEN') return { status: 403, body: { error: 'Acesso de moderação não autorizado.', code } };
  if (code === 'POST_NOT_FOUND') return { status: 404, body: { error: 'Publicação não encontrada.', code } };
  if (code === 'INVALID_POST' || code === 'INVALID_REASON') return { status: 400, body: { error: 'Revise a publicação e o motivo informado.', code } };
  console.error('[Admin Social Moderation]', error);
  return { status: 503, body: { error: 'Não foi possível concluir a moderação agora.', code: 'SOCIAL_MODERATION_FAILED' } };
};
