import { auth, db } from './firebase';
import {
  collection, doc, getDoc, onSnapshot, query, serverTimestamp, where,
  writeBatch, type Unsubscribe,
} from 'firebase/firestore';
import type { Store } from '../types';

export interface CanonicalStoreReview {
  id: string;
  storeId: string;
  storeName: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  content: string;
  rating: number;
  mediaUrl: string;
  createdAtIso: string;
  publishedToFeed: boolean;
  postId: string;
}

const validId = (id: string): boolean =>
  /^[a-zA-Z0-9_-]{1,128}$/.test(id);

export const reviewSocialPostId = (storeId: string, authorId: string) =>
  'review_' + storeId + '_' + authorId;

/**
 * A single canonical review per authenticated visitor and store.
 * Review + optional social post are created atomically. There is no client-side
 * reward or platform-wallet event in this operation.
 */
export async function publishStoreReview(store: Store, values: {
  content: string; rating: number; mediaUrl: string; publishedToPraca: boolean;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Entre no Kyrub para avaliar esta loja.');
  if (!validId(store.id) || store.name.trim().length === 0 || store.name.length > 160) {
    throw new Error('Esta loja não possui uma identidade válida para avaliações.');
  }
  const content = values.content.trim();
  if (content.length < 10 || content.length > 2000 ||
      !Number.isInteger(values.rating) || values.rating < 1 || values.rating > 5) {
    throw new Error('Escreva entre 10 e 2.000 caracteres e escolha uma nota de 1 a 5.');
  }
  const mediaUrl = values.mediaUrl.trim();
  if (mediaUrl.length > 2048) throw new Error('A imagem vinculada é muito longa.');
  const reviewId = user.uid;
  const reviewRef = doc(db, 'store_reviews', store.id, 'reviews', reviewId);
  const previous = await getDoc(reviewRef);
  if (previous.exists()) throw new Error('Você já avaliou esta loja. Não é possível enviar uma segunda avaliação.');
  const postId = values.publishedToPraca ? reviewSocialPostId(store.id, reviewId) : '';
  const nowIso = new Date().toISOString();
  const authorName = (user.displayName || user.email?.split('@')[0] || 'Kairubido').trim().slice(0, 160);
  const authorAvatar = (user.photoURL || '').slice(0, 2048);
  const batch = writeBatch(db);
  batch.set(reviewRef, {
    reviewId, storeId: store.id, storeName: store.name.trim(), authorId: reviewId,
    authorName, authorAvatar, content, rating: values.rating, mediaUrl,
    publishedToFeed: values.publishedToPraca, postId,
    status: 'published', createdAtIso: nowIso, createdAt: serverTimestamp(),
  });
  if (postId) {
    batch.set(doc(db, 'social_posts', postId), {
      postId, sourcePostId: reviewId, authorId: reviewId,
      authorName, authorAvatar, content, publicationType: 'feed',
      taggedUsers: [], taggedUserIds: [],
      mediaUrls: mediaUrl ? [mediaUrl] : [],
      visibility: 'public', audienceIds: [],
      storeReview: { storeId: store.id, reviewId, rating: values.rating, storeName: store.name.trim() },
      createdAtIso: nowIso, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
}

export function subscribeStoreReviews(
  storeId: string,
  callback: (reviews: CanonicalStoreReview[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  if (!validId(storeId) || !auth.currentUser) {
    callback([]);
    return () => undefined;
  }
  return onSnapshot(
    query(collection(db, 'store_reviews', storeId, 'reviews'), where('status', '==', 'published')),
    snapshot => {
      const reviews = snapshot.docs.map(item => {
        const d = item.data();
        return {
          id: item.id, storeId,
          storeName: typeof d.storeName === 'string' ? d.storeName : '',
          authorId: typeof d.authorId === 'string' ? d.authorId : '',
          authorName: typeof d.authorName === 'string' ? d.authorName : 'Kairubido',
          authorAvatar: typeof d.authorAvatar === 'string' ? d.authorAvatar : '',
          content: typeof d.content === 'string' ? d.content : '',
          rating: typeof d.rating === 'number' ? d.rating : 0,
          mediaUrl: typeof d.mediaUrl === 'string' ? d.mediaUrl : '',
          createdAtIso: typeof d.createdAtIso === 'string' ? d.createdAtIso : '',
          publishedToFeed: d.publishedToFeed === true,
          postId: typeof d.postId === 'string' ? d.postId : '',
        } as CanonicalStoreReview;
      }).filter(review => review.rating >= 1 && review.rating <= 5);
      callback(reviews.sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso)));
    },
    error => onError(error),
  );
}

/** Read the same like documents as the Praça; never maintain another counter. */
export function subscribeStoreReviewLikeCounts(
  postIds: string[],
  callback: (counts: Record<string, number>) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const ids = [...new Set(postIds.filter(Boolean))];
  if (!auth.currentUser || ids.length === 0) {
    callback({});
    return () => undefined;
  }
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10));
  const countsByChunk = new Map<number, Record<string, number>>();
  const subscriptions = chunks.map((values, index) => onSnapshot(
    query(collection(db, 'social_post_likes'), where('postId', 'in', values)),
    snapshot => {
      const counts: Record<string, number> = {};
      snapshot.docs.forEach(item => {
        const id = item.data().postId;
        if (typeof id === 'string') counts[id] = (counts[id] || 0) + 1;
      });
      countsByChunk.set(index, counts);
      callback(Object.assign({}, ...Array.from(countsByChunk.values())));
    },
    error => onError(error),
  ));
  return () => subscriptions.forEach(unsubscribe => unsubscribe());
}
