import { readFileSync } from 'node:fs';
import { before, after, beforeEach, test } from 'node:test';
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection, deleteDoc, doc, getDoc, getDocs, query,
  serverTimestamp, setDoc, Timestamp, where, writeBatch,
} from 'firebase/firestore';

const PROJECT_ID = 'kyrub-security-test';
const OWNER = 'review-owner';
const BUYER = 'review-buyer';
const STRANGER = 'review-stranger';
const STORE_ID = OWNER;
const POST_ID = 'review_' + STORE_ID + '_' + BUYER;
const REVIEW_PATH = ['store_reviews', STORE_ID, 'reviews', BUYER] as const;
let environment: RulesTestEnvironment;

function listing(status: 'published' | 'paused' = 'published') {
  const id = 's_' + STORE_ID.length + '_' + STORE_ID;
  const at = Timestamp.fromDate(new Date('2026-09-01T00:00:00Z'));
  return { listingId: id, listingType: 'store', storeId: STORE_ID, ownerId: OWNER,
    publicationStatus: status, name: 'Loja de Flores', slug: 'loja-flores',
    description: '', address: '', logo: '', banner: '', primaryColor: '',
    keywords: [], status: 'open', createdAt: at, updatedAt: at, publishedAt: at };
}

function review(options: { shared?: boolean; authorId?: string; storeName?: string } = {}) {
  const shared = options.shared ?? true;
  return {
    reviewId: BUYER, storeId: STORE_ID, storeName: options.storeName ?? 'Loja de Flores',
    authorId: options.authorId ?? BUYER, authorName: 'Comprador', authorAvatar: '',
    content: 'Atendimento excelente e muito cordial.', rating: 5, mediaUrl: '',
    publishedToFeed: shared, postId: shared ? POST_ID : '',
    status: 'published', createdAtIso: '2026-11-17T10:00:00.000Z',
    createdAt: serverTimestamp(),
  };
}
function post() {
  return {
    postId: POST_ID, sourcePostId: BUYER, authorId: BUYER,
    authorName: 'Comprador', authorAvatar: '',
    content: 'Atendimento excelente e muito cordial.',
    publicationType: 'feed', taggedUsers: [], taggedUserIds: [],
    mediaUrls: [], visibility: 'public', audienceIds: [],
    storeReview: { storeId: STORE_ID, reviewId: BUYER, rating: 5, storeName: 'Loja de Flores' },
    createdAtIso: '2026-11-17T10:00:00.000Z',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  };
}

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('.firebase/firestore.combined.rules', 'utf8'),
      host: '127.0.0.1', port: 8088,
    },
  });
});
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    const store = listing();
    await setDoc(doc(context.firestore(), 'marketplace_listings', store.listingId), store);
  });
});
after(async () => { await environment.cleanup(); });

test('a buyer atomically reviews a published store and cross-posts exactly one canonical Praça post', async () => {
  const buyer = environment.authenticatedContext(BUYER).firestore();
  const reviewRef = doc(buyer, ...REVIEW_PATH);
  const postRef = doc(buyer, 'social_posts', POST_ID);
  await assertSucceeds(getDoc(reviewRef)); // initial absence must not prevent idempotent UI preflight
  const batch = writeBatch(buyer);
  batch.set(reviewRef, review());
  batch.set(postRef, post());
  await assertSucceeds(batch.commit());
  const saved = await assertSucceeds(getDoc(reviewRef));
  const published = await assertSucceeds(getDoc(postRef));
  if (saved.data()?.postId !== published.data()?.postId) throw Error('Cross surface post ID drift.');
  if (published.data()?.storeReview?.reviewId !== BUYER) throw Error('Review linkage absent.');
  const viewer = environment.authenticatedContext(STRANGER).firestore();
  const reviews = await assertSucceeds(getDocs(query(
    collection(viewer, 'store_reviews', STORE_ID, 'reviews'), where('status', '==', 'published'),
  )));
  if (reviews.size !== 1) throw Error('Review not visible to another signed-in user.');
  const likeId = POST_ID + '__' + STRANGER;
  await assertSucceeds(setDoc(doc(viewer, 'social_post_likes', likeId), {
    postId: POST_ID, userId: STRANGER, createdAt: serverTimestamp(),
  }));
  const likes = await assertSucceeds(getDocs(query(collection(viewer, 'social_post_likes'), where('postId', '==', POST_ID))));
  if (likes.size !== 1) throw Error('Praça and review like count must share the same like collection.');
  await assertFails(setDoc(doc(viewer, 'social_post_likes', likeId), {
    postId: POST_ID, userId: STRANGER, createdAt: serverTimestamp(),
  }));
  await assertFails(setDoc(reviewRef, { ...review(), rating: 4 }));
});

test('a buyer may publish a store-only review without creating a social post', async () => {
  const buyer = environment.authenticatedContext(BUYER).firestore();
  await assertSucceeds(setDoc(doc(buyer, ...REVIEW_PATH), review({ shared: false })));
  await assertFails(setDoc(doc(buyer, 'social_posts', POST_ID), post()));
  await assertSucceeds(deleteDoc(doc(buyer, ...REVIEW_PATH)));
});

test('review does not accept a missing cross-post or a post with forged review author', async () => {
  const buyer = environment.authenticatedContext(BUYER).firestore();
  await assertFails(setDoc(doc(buyer, ...REVIEW_PATH), review()));
  await assertFails(setDoc(doc(buyer, 'social_posts', POST_ID), post()));
  const wrong = writeBatch(buyer);
  wrong.set(doc(buyer, ...REVIEW_PATH), review());
  wrong.set(doc(buyer, 'social_posts', POST_ID), { ...post(), storeReview: {
    storeId: STORE_ID, reviewId: BUYER, rating: 4, storeName: 'Loja de Flores',
  } });
  await assertFails(wrong.commit());
});

test('store owner, unlisted store and forged store name cannot create a review', async () => {
  const owner = environment.authenticatedContext(OWNER).firestore();
  await assertFails(setDoc(doc(owner, 'store_reviews', STORE_ID, 'reviews', OWNER), {
    ...review({ shared: false }), reviewId: OWNER, authorId: OWNER,
  }));
  const buyer = environment.authenticatedContext(BUYER).firestore();
  await assertFails(setDoc(doc(buyer, ...REVIEW_PATH), review({ shared: false, storeName: 'Loja Falsa' })));
  await environment.withSecurityRulesDisabled(async context => {
    const store = listing('paused');
    await setDoc(doc(context.firestore(), 'marketplace_listings', store.listingId), store);
  });
  await assertFails(setDoc(doc(buyer, ...REVIEW_PATH), review({ shared: false })));
});

test('cross-posted review cannot be retracted leaving an orphan social post', async () => {
  const buyer = environment.authenticatedContext(BUYER).firestore();
  const reviewRef = doc(buyer, ...REVIEW_PATH);
  const postRef = doc(buyer, 'social_posts', POST_ID);
  const batch = writeBatch(buyer);
  batch.set(reviewRef, review());
  batch.set(postRef, post());
  await assertSucceeds(batch.commit());
  await assertFails(deleteDoc(reviewRef));
  const retract = writeBatch(buyer);
  retract.delete(postRef);
  retract.delete(reviewRef);
  await assertSucceeds(retract.commit());
});

test('reviews hidden by a moderator are not readable by the public audience', async () => {
  const buyer = environment.authenticatedContext(BUYER).firestore();
  await assertSucceeds(setDoc(doc(buyer, ...REVIEW_PATH), review({ shared: false })));
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), ...REVIEW_PATH), { ...review({ shared: false }),
      createdAt: Timestamp.now(), status: 'hidden', reviewedBy: 'moderator' });
  });
  const viewer = environment.authenticatedContext(STRANGER).firestore();
  await assertFails(getDoc(doc(viewer, ...REVIEW_PATH)));
  const visible = await assertSucceeds(getDocs(query(
    collection(viewer, 'store_reviews', STORE_ID, 'reviews'), where('status', '==', 'published'),
  )));
  if (!visible.empty) throw Error('A moderated review leaked into public results.');
});
