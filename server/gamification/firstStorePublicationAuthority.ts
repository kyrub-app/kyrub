import type { Firestore } from 'firebase-admin/firestore';
import type { KyrubChallengeDefinition } from '../../shared/gamification.js';
import { FIRST_STORE_PUBLISHED_CHALLENGE_ID } from './firstStorePublishedReward.js';
import { awardVerifiedFirstStorePublicationInTransaction } from './firstStorePublishedAwardTransaction.js';

/**
 * Trusted-only first publication authority. A caller must authenticate the
 * user before invoking this function. This operation does not expose a route.
 * Store, listing, evidence and XP are committed atomically.
 */
export async function publishFirstStoreAndAwardXp(
  db: Firestore,
  input: { authenticatedUserId: string; canonicalStoreId: string },
): Promise<{ replay: boolean; pitangas: 0; xp: 2 }> {
  const { authenticatedUserId: uid, canonicalStoreId } = input;
  // Capture the trusted timestamp once, outside transaction retries.
  const publishedAt = new Date().toISOString();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(canonicalStoreId)) {
    throw Error('FIRST_STORE_PUBLICATION_INVALID_INPUT');
  }
  const storeRef = db.doc(`stores/${canonicalStoreId}`);
  const listingId = `s_${uid.length}_${uid}`;
  const listingRef = db.doc(`marketplace_listings/${listingId}`);
  const challengeRef = db.doc(`global_challenges/${FIRST_STORE_PUBLISHED_CHALLENGE_ID}`);
  const userRoot = db.collection('users').doc(uid);
  const eventRef = userRoot.collection('verifiedStoreEvents').doc(FIRST_STORE_PUBLISHED_CHALLENGE_ID);
  const awardId = `first_store_${uid}`;
  return db.runTransaction(async tx => {
    const [store, listing, event, challenge] = await Promise.all([
      tx.get(storeRef), tx.get(listingRef), tx.get(eventRef), tx.get(challengeRef),
    ]);
    if (!store.exists || store.get('id') !== canonicalStoreId ||
        store.get('ownerId') !== uid || store.get('firstStoreCreationVerified') !== true ||
        !listing.exists || listing.get('listingType') !== 'store' ||
        listing.get('storeId') !== uid || listing.get('ownerId') !== uid ||
        !challenge.exists) {
      throw Error('FIRST_STORE_PUBLICATION_AUTHORITY_INVALID');
    }
    const existingFirstAt = store.get('firstPublishedAt');
    if (existingFirstAt || event.exists) {
      if (typeof existingFirstAt !== 'string' || !event.exists ||
          store.get('publicationStatus') !== 'published' ||
          listing.get('publicationStatus') !== 'published' ||
          event.get('userId') !== uid || event.get('storeId') !== canonicalStoreId ||
          event.get('publishedAt') !== existingFirstAt ||
          event.get('challengeId') !== FIRST_STORE_PUBLISHED_CHALLENGE_ID) {
        throw Error('FIRST_STORE_PUBLICATION_MARKER_CONFLICT');
      }
      // A repeated first-publication request never changes the timestamp.
      const result = await awardVerifiedFirstStorePublicationInTransaction(tx, {
        challenge: challenge.data() as KyrubChallengeDefinition,
        event: { userId: uid, storeId: canonicalStoreId, publishedAt: existingFirstAt,
          isFirstPublication: true, isOwnerVerified: true, isMarketplaceVisible: true },
        receiptRef: userRoot.collection('challengeRewards').doc(awardId),
        xpLedgerRef: userRoot.collection('xpLedger').doc(`xp_${awardId}`),
        pitangaLedgerRef: userRoot.collection('rewardLedger').doc(`earn_${awardId}`),
      });
      return result;
    }
    const result = await awardVerifiedFirstStorePublicationInTransaction(tx, {
      challenge: challenge.data() as KyrubChallengeDefinition,
      event: { userId: uid, storeId: canonicalStoreId, publishedAt,
        isFirstPublication: true, isOwnerVerified: true, isMarketplaceVisible: true },
      receiptRef: userRoot.collection('challengeRewards').doc(awardId),
      xpLedgerRef: userRoot.collection('xpLedger').doc(`xp_${awardId}`),
      pitangaLedgerRef: userRoot.collection('rewardLedger').doc(`earn_${awardId}`),
    });
    tx.update(storeRef, { publicationStatus: 'published', firstPublishedAt: publishedAt });
    tx.update(listingRef, { publicationStatus: 'published', publishedAt });
    tx.create(eventRef, {
      id: FIRST_STORE_PUBLISHED_CHALLENGE_ID,
      challengeId: FIRST_STORE_PUBLISHED_CHALLENGE_ID,
      userId: uid, storeId: canonicalStoreId,
      status: 'pending', isFirstPublication: true, publishedAt,
    });
    return result;
  });
}
