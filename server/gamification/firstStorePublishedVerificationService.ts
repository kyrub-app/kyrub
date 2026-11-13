import type { Firestore } from 'firebase-admin/firestore';
import { FIRST_STORE_PUBLISHED_CHALLENGE_ID, planFirstStorePublishedReward } from './firstStorePublishedReward.js';
import type { KyrubChallengeDefinition } from '../../shared/gamification.js';

/**
 * Server-only verification of persisted first-publication evidence.
 * This service does not create evidence, publish a store, or credit XP.
 * Call only from a trusted publication transition after the listing commit.
 */
export async function verifyFirstStorePublicationForReward(
  db: Firestore,
  input: { userId: string; canonicalStoreId: string },
): Promise<ReturnType<typeof planFirstStorePublishedReward>> {
  const { userId, canonicalStoreId } = input;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(userId) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(canonicalStoreId)) {
    throw new Error('FIRST_STORE_PUBLICATION_INVALID_INPUT');
  }
  const storeRef = db.doc(`stores/${canonicalStoreId}`);
  const eventRef = db.doc(`users/${userId}/verifiedStoreEvents/first_store_published`);
  const challengeRef = db.doc(`global_challenges/${FIRST_STORE_PUBLISHED_CHALLENGE_ID}`);
  const listingQuery = db.collection('marketplace_listings')\n    .where('storeId', '==', canonicalStoreId)\n    .where('publicationStatus', '==', 'published')\n    .limit(20);\n  return db.runTransaction(async tx => {
    const [store, event, challenge, listings] = await Promise.all([
      tx.get(storeRef), tx.get(eventRef), tx.get(challengeRef), tx.get(listingQuery),
    ]);
    const visibleListing = listings.docs.some(listing => {\n      const data = listing.data();\n      return data.listingType === 'store' && data.storeId === canonicalStoreId &&\n        data.publicationStatus === 'published';\n    });\n    if (!visibleListing || !store.exists || !event.exists || !challenge.exists ||
        store.get('id') !== canonicalStoreId ||
        store.get('ownerId') !== userId ||
        store.get('publicationStatus') !== 'published' ||
        event.get('id') !== FIRST_STORE_PUBLISHED_CHALLENGE_ID ||
        event.get('challengeId') !== FIRST_STORE_PUBLISHED_CHALLENGE_ID ||
        event.get('userId') !== userId ||
        event.get('storeId') !== canonicalStoreId ||
        event.get('status') !== 'pending' ||
        event.get('isFirstPublication') !== true) {
      throw new Error('FIRST_STORE_PUBLICATION_UNVERIFIED');
    }
    const publishedAt = event.get('publishedAt');
    const timestamp = typeof publishedAt === 'string'
      ? new Date(publishedAt) : publishedAt?.toDate?.();
    if (!(timestamp instanceof Date) || !Number.isFinite(timestamp.getTime())) {
      throw new Error('FIRST_STORE_PUBLICATION_TIMESTAMP_INVALID');
    }
    // A trusted writer must atomically establish the first-publication event
    // and canonical publication marker. A client-written status is insufficient.
    const canonicalPublishedAt = store.get('firstPublishedAt');
    const canonicalDate = typeof canonicalPublishedAt === 'string'
      ? new Date(canonicalPublishedAt) : canonicalPublishedAt?.toDate?.();
    if (!(canonicalDate instanceof Date) || canonicalDate.getTime() !== timestamp.getTime()) {
      throw new Error('FIRST_STORE_PUBLICATION_MARKER_CONFLICT');
    }
    return planFirstStorePublishedReward(challenge.data() as KyrubChallengeDefinition, {
      userId, storeId: canonicalStoreId, publishedAt: timestamp.toISOString(),
      isFirstPublication: true, isOwnerVerified: true, isMarketplaceVisible: true,
    });
  });
}
