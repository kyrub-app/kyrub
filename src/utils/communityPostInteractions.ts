import {
  collection, deleteDoc, doc, getDoc, onSnapshot, query, serverTimestamp, setDoc, where,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import type { CloudCommunityPost } from './communityCloud';
import type { SocialReportReason, SocialReportOutcome } from './socialReports';

export interface CommunityPostLike {
  postId: string;
  userId: string;
}

export interface CommunityPostComment {
  id: string;
  communityId: string;
  postId: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  text: string;
  createdAt: string;
}

const currentUid = (): string => {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Faça login para interagir com a comunidade.');
  return uid;
};

export const subscribeCommunityPostInteractions = (
  communityId: string,
  onLikes: (likes: CommunityPostLike[]) => void,
  onComments: (comments: CommunityPostComment[]) => void,
  onError: (error: Error) => void,
): Unsubscribe => {
  const stopLikes = onSnapshot(
    query(collection(db, 'community_post_likes'), where('communityId', '==', communityId)),
    snapshot => onLikes(snapshot.docs.flatMap(item => {
      const data = item.data();
      return data.communityId === communityId && typeof data.postId === 'string'
        && typeof data.userId === 'string'
        ? [{ postId: data.postId, userId: data.userId }] : [];
    })),
    onError,
  );
  const stopComments = onSnapshot(
    query(collection(db, 'community_post_comments'), where('communityId', '==', communityId)),
    snapshot => onComments(snapshot.docs.flatMap(item => {
      const data = item.data();
      if (data.communityId !== communityId || typeof data.postId !== 'string'
          || typeof data.authorId !== 'string' || typeof data.text !== 'string') return [];
      return [{
        id: item.id,
        communityId,
        postId: data.postId,
        authorId: data.authorId,
        authorName: typeof data.authorName === 'string' ? data.authorName : 'Kairubido',
        authorAvatar: typeof data.authorAvatar === 'string' ? data.authorAvatar : '',
        text: data.text,
        createdAt: typeof data.createdAtIso === 'string' ? data.createdAtIso : '',
      }];
    }).sort((a, b) => a.createdAt.localeCompare(b.createdAt))),
    onError,
  );
  return () => { stopLikes(); stopComments(); };
};

export const toggleCommunityPostLike = async (
  post: CloudCommunityPost, isLiked: boolean,
): Promise<void> => {
  const uid = currentUid();
  const reference = doc(db, 'community_post_likes', `${post.id}__${uid}`);
  if (isLiked) {
    await deleteDoc(reference);
  } else {
    await setDoc(reference, {
      communityId: post.communityId,
      postId: post.id,
      userId: uid,
      createdAt: serverTimestamp(),
    });
  }
};

export const addCommunityPostComment = async (
  post: CloudCommunityPost, value: string,
): Promise<void> => {
  const uid = currentUid();
  const user = auth.currentUser!;
  const text = value.trim();
  if (!text || text.length > 1000) throw new Error('Escreva um comentário de até 1.000 caracteres.');
  const reference = doc(collection(db, 'community_post_comments'));
  await setDoc(reference, {
    commentId: reference.id,
    communityId: post.communityId,
    postId: post.id,
    authorId: uid,
    authorName: (user.displayName || user.email?.split('@')[0] || 'Kairubido').slice(0, 160),
    authorAvatar: (user.photoURL || '').slice(0, 2048),
    text,
    createdAtIso: new Date().toISOString(),
    createdAt: serverTimestamp(),
  });
};

export const deleteCommunityPostComment = async (commentId: string): Promise<void> => {
  currentUid();
  await deleteDoc(doc(db, 'community_post_comments', commentId));
};

export const submitCommunityPostReport = async (
  post: CloudCommunityPost,
  reason: SocialReportReason,
): Promise<SocialReportOutcome> => {
  const uid = currentUid();
  if (uid === post.authorId) throw new Error('Você não pode denunciar sua própria publicação.');
  if (!['spam', 'abuse', 'fraud', 'unsafe', 'other'].includes(reason)) throw new Error('Motivo inválido.');
  const snapshot = await getDoc(doc(db, 'community_posts', post.id));
  if (!snapshot.exists() || snapshot.data().communityId !== post.communityId
    || snapshot.data().authorId !== post.authorId) throw new Error('Publicação não encontrada.');
  const reportId = `${post.id}__${uid}`;
  const reference = doc(db, 'community_post_reports', reportId);
  try {
    await setDoc(reference, {
      reportId,
      postId: post.id,
      communityId: post.communityId,
      reporterId: uid,
      authorId: post.authorId,
      reason,
      status: 'pending',
      createdAt: serverTimestamp(),
    });
    return 'submitted';
  } catch (error) {
    try { if ((await getDoc(reference)).exists()) return 'already_reported'; }
    catch { /* preserve original failure */ }
    throw error;
  }
};
