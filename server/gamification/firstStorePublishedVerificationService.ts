import type { Firestore } from 'firebase-admin/firestore';
import { FIRST_STORE_PUBLISHED_CHALLENGE_ID, planFirstStorePublishedReward } from './firstStorePublishedReward.js';
import type { KyrubChallengeDefinition } from '../../shared/gamification.js';
import { awardVerifiedFirstStorePublicationInTransaction } from './firstStorePublishedAwardTransaction.js';

/**
 * Server-only verification of persisted first-publication evidence.
 * This service does not create evidence, publish a store, or credit XP.
 * Call only from a trusted publication transition after the listing commit.
 */
export async function verifyFirstStorePublicationForReward(
  db: Firestore,
  input: { userId: string; canonicalStoreId: string },
): Promise<{ replay: boolean; pitangas: 0; xp: 2 }> {
  const { userId, canonicalStoreId } = input;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(userId) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(canonicalStoreId)) {
    throw new Error('FIRST_STORE_PUBLICATION_INVALID_INPUT');
  }
  const storeRef = db.doc(`stores/${canonicalStoreId}`);
  const eventRef = db.doc(`users/${userId}/verifiedStoreEvents/first_store_published`);
  const challengeRef = db.doc(`global_challenges/${FIRST_STORE_PUBLISHED_CHALLENGE_ID}`);
  // Deterministic store listing ID matches marketplacePaths.ts.
  const listingId = `s_${canonicalStoreId.length}_${canonicalStoreId}`;
  const listingRef = db.doc(`marketplace_listings/${listingId}`);
  return db.runTransaction(async tx => {
    const [store, event, challenge, listings] = await Promise.all([
      tx.get(storeRef), tx.get(eventRef), tx.get(challengeRef), tx.get(listingRef),
    ]);
    const visibleListing = listings.exists && listings.get('listingType') === 'store' &&
      listings.get('storeId') === canonicalStoreId &&
      listings.get('ownerId') === userId &&
      listings.get('publicationStatus') === 'published';
    if (!visibleListing || !store.exists || !event.exists || !challenge.exists ||
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
    const verifiedEvent = {
      userId, storeId: canonicalStoreId, publishedAt: timestamp.toISOString(),
      isFirstPublication: true, isOwnerVerified: true, isMarketplaceVisible: true,
    };
    const challengeData = challenge.data() as KyrubChallengeDefinition;
    planFirstStorePublishedReward(challengeData, verifiedEvent);
    const userRoot = db.collection('users').doc(userId);
    const awardId = `first_store_${userId}`;
    return awardVerifiedFirstStorePublicationInTransaction(tx, {
      challenge: challengeData, event: verifiedEvent,
      receiptRef: userRoot.collection('challengeRewards').doc(awardId),
      xpLedgerRef: userRoot.collection('xpLedger').doc(`xp_${awardId}`),
      pitangaLedgerRef: userRoot.collection('rewardLedger').doc(`earn_${awardId}`),
    });
  });
}
