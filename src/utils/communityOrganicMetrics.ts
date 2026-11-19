import {
  collection, doc, getDoc, onSnapshot, query, runTransaction, serverTimestamp,
  setDoc, where, type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import type { CloudCommunityPost } from './communityCloud';

export type CommunityEngagementType = 'view' | 'save' | 'share';
export interface CommunityOrganicEngagement {
  postId: string;
  postAuthorId: string;
  actorId: string;
  type: CommunityEngagementType;
}

const metricId = (postId: string, type: 'view' | 'save', actorId: string) =>
  `${postId}__${type}__${actorId}`;

const currentUserId = (): string => {
  const id = auth.currentUser?.uid;
  if (!id) throw new Error('Faça login para interagir com a publicação.');
  return id;
};

const newEngagement = (post: CloudCommunityPost, actorId: string, type: CommunityEngagementType, id: string) => ({
  engagementId: id,
  communityId: post.communityId,
  postId: post.id,
  postAuthorId: post.authorId,
  actorId,
  type,
  createdAt: serverTimestamp(),
});

/** Mirrors Praça's author-scoped organic metrics subscription, without
 * exposing cross-community engagement records to unrelated viewers. */
export const subscribeCommunityOrganicMetrics = (
  ownerId: string,
  onChange: (values: CommunityOrganicEngagement[]) => void,
  onError: (error: Error) => void,
): Unsubscribe => onSnapshot(
  query(collection(db, 'community_post_engagements'), where('postAuthorId', '==', ownerId)),
  snapshot => onChange(snapshot.docs.flatMap(item => {
    const data = item.data();
    if (data.postAuthorId !== ownerId || typeof data.postId !== 'string'
        || typeof data.actorId !== 'string'
        || (data.type !== 'view' && data.type !== 'save' && data.type !== 'share')) return [];
    return [{
      postId: data.postId as string,
      postAuthorId: ownerId,
      actorId: data.actorId as string,
      type: data.type as CommunityEngagementType,
    }];
  })),
  onError,
);

/** Exactly one observed view per authenticated person and post.
 * Visibility is checked with IntersectionObserver in the actual post card. */
export const recordCommunityPostView = async (post: CloudCommunityPost): Promise<void> => {
  const actorId = currentUserId();
  const id = metricId(post.id, 'view', actorId);
  const reference = doc(db, 'community_post_engagements', id);
  if ((await getDoc(reference)).exists()) return;
  try {
    await setDoc(reference, newEngagement(post, actorId, 'view', id));
  } catch (error) {
    // An overlapping view can win the create-only race. The existing receipt is sufficient.
    if (!(await getDoc(reference)).exists()) throw error;
  }
};

/** Save/unsave updates both the existing private Salvos record and the
 * organic count in ONE Firestore transaction; never count a failed save. */
export const toggleCommunityPostSaveWithMetrics = async (
  post: CloudCommunityPost,
  currentlySaved: boolean,
): Promise<void> => {
  const actorId = currentUserId();
  const savedId = ('community__' + post.id).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  const savedRef = doc(db, 'users', actorId, 'savedItems', savedId);
  const metricRef = doc(db, 'community_post_engagements', metricId(post.id, 'save', actorId));
  await runTransaction(db, async tx => {
    const [savedSnapshot, metricSnapshot] = await Promise.all([tx.get(savedRef), tx.get(metricRef)]);
    if (currentlySaved) {
      if (savedSnapshot.exists()) tx.delete(savedRef);
      if (metricSnapshot.exists()) tx.delete(metricRef);
      return;
    }
    tx.set(savedRef, {
      type: 'publication',
      sourceKind: 'community',
      sourceId: post.id,
      selectionIds: [],
      savedAtIso: new Date().toISOString(),
      savedAt: serverTimestamp(),
    });
    if (!metricSnapshot.exists()) {
      tx.set(metricRef, newEngagement(post, actorId, 'save', metricRef.id));
    }
  });
};

/** Only completed native-share or clipboard actions count, like Praça.
 * A share is not a guaranteed view and never generates rewards or revenue. */
export const shareCommunityPostWithMetrics = async (post: CloudCommunityPost): Promise<void> => {
  const actorId = currentUserId();
  const title = `Publicação de ${post.authorName} no Kyrub`;
  const text = post.content.trim()
    ? `${title}: ${post.content.trim().slice(0, 220)}`
    : `${title} com mídia. Conheça as Comunidades no Kyrub.`;
  const url = window.location.origin + window.location.pathname;
  let shared = false;
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      shared = true;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
  if (!shared) {
    const payload = `${text}\n${url}`;
    if (!navigator.clipboard?.writeText) {
      throw new Error('O compartilhamento não está disponível neste dispositivo.');
    }
    await navigator.clipboard.writeText(payload);
  }
  const reference = doc(collection(db, 'community_post_engagements'));
  await setDoc(reference, newEngagement(post, actorId, 'share', reference.id));
};
