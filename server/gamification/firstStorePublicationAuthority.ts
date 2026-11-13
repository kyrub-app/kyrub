import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { KyrubChallengeDefinition } from '../../shared/gamification.js';
import { FIRST_STORE_PUBLISHED_CHALLENGE_ID, planFirstStorePublishedReward } from './firstStorePublishedReward.js';
import { awardVerifiedFirstStorePublicationInTransaction } from './firstStorePublishedAwardTransaction.js';

/**
 * Trusted-only first publication authority. A caller must authenticate the
 * user before invoking this function. This operation does not expose a route.
 * Store, listing, evidence and XP are committed atomically.
 */
export async function publishFirstStoreAndAwardXp(
  db: Firestore,
  input: { authenticatedUserId: string; canonicalStoreId: string },
): Promise<{ replay: boolean; pitangas: 0; xp: 0 | 2 }> {
  const { authenticatedUserId: uid, canonicalStoreId } = input;
  // Capture the trusted timestamp once, outside transaction retries.
  const publishedAt = new Date().toISOString();
  const publicationTimestamp = Timestamp.fromDate(new Date(publishedAt));
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(canonicalStoreId)) {
    throw Error('FIRST_STORE_PUBLICATION_INVALID_INPUT');
  }
  const storeRef = db.doc(`stores/${canonicalStoreId}`);
  const listingId = `s_${uid.length}_${uid}`;
  const listingRef = db.doc(`marketplace_listings/${listingId}`);
  const primaryRef = db.doc(`users/${uid}/stores/${uid}`);
  const tenantRef = db.doc(`tenants/${uid}`);
  const challengeRef = db.doc(`global_challenges/${FIRST_STORE_PUBLISHED_CHALLENGE_ID}`);
  const userRoot = db.collection('users').doc(uid);
  const eventRef = userRoot.collection('verifiedStoreEvents').doc(FIRST_STORE_PUBLISHED_CHALLENGE_ID);
  const awardId = `first_store_${uid}`;
  const receiptRef = userRoot.collection('challengeRewards').doc(awardId);
  const xpLedgerRef = userRoot.collection('xpLedger').doc(`xp_${awardId}`);
  const pitangaLedgerRef = userRoot.collection('rewardLedger').doc(`earn_${awardId}`);
  return db.runTransaction(async tx => {
    const [store, listing, event, challenge, primary, tenant] = await Promise.all([
      tx.get(storeRef), tx.get(listingRef), tx.get(eventRef), tx.get(challengeRef), tx.get(primaryRef), tx.get(tenantRef),
    ]);
    if (!store.exists || store.get('id') !== canonicalStoreId ||
        store.get('ownerId') !== uid || store.get('firstStoreCreationVerified') !== true ||
        !primary.exists || primary.get('id') !== uid || primary.get('ownerId') !== uid ||
        (listing.exists && (listing.get('listingType') !== 'store' ||
        listing.get('storeId') !== uid || listing.get('ownerId') !== uid))) {
      throw Error('FIRST_STORE_PUBLICATION_AUTHORITY_INVALID');
    }
    if (tenant.exists && (tenant.get('id') !== uid || tenant.get('ownerId') !== uid)) {
      throw Error('FIRST_STORE_PUBLICATION_TENANT_CONFLICT');
    }
    const syncTenant = () => {
      if (tenant.exists && tenant.get('publicationStatus') !== 'published') {
        tx.update(tenantRef, { publicationStatus: 'published', updatedAt: Timestamp.now() });
      }
    };
    const existingFirstAt = store.get('firstPublishedAt');
    if (existingFirstAt || event.exists) {
      if (typeof existingFirstAt !== 'string' || !event.exists ||
          !['published', 'paused'].includes(store.get('publicationStatus')) ||
          !listing.exists ||
          (listing.get('publishedAt') instanceof Timestamp
            ? listing.get('publishedAt').toDate().toISOString() !== existingFirstAt
            : listing.get('publishedAt') !== existingFirstAt) ||
          !['published', 'paused'].includes(listing.get('publicationStatus')) ||
          event.get('id') !== FIRST_STORE_PUBLISHED_CHALLENGE_ID ||
          !['pending', 'unrewarded'].includes(event.get('status')) ||
          event.get('isFirstPublication') !== true ||
          event.get('userId') !== uid || event.get('storeId') !== canonicalStoreId ||
          event.get('publishedAt') !== existingFirstAt ||
          event.get('challengeId') !== FIRST_STORE_PUBLISHED_CHALLENGE_ID) {
        throw Error('FIRST_STORE_PUBLICATION_MARKER_CONFLICT');
      }
      // Never grant XP retroactively when the first publication was unrewarded.
      if (event.get('status') === 'unrewarded') {
        if (store.get('publicationStatus') !== 'published') tx.update(storeRef, { publicationStatus: 'published' });
        if (listing.get('publicationStatus') !== 'published') tx.update(listingRef, { publicationStatus: 'published' });
        syncTenant();
        return { replay: true, pitangas: 0, xp: 0 };
      }
      if (!challenge.exists) {
        // Existing verified rewards remain valid after the challenge is removed.
        // Never mint an award from a missing configuration.
        const [receipt, xpEntry, pitangaEntry] = await Promise.all([
          tx.get(receiptRef), tx.get(xpLedgerRef), tx.get(pitangaLedgerRef),
        ]);
        const saved = receipt.data();
        const ledger = xpEntry.data();
        if (!receipt.exists || !xpEntry.exists || pitangaEntry.exists ||
            saved?.userId !== uid || saved?.storeId !== canonicalStoreId ||
            saved?.idempotencyKey !== awardId || saved?.xp !== 2 || saved?.pitangas !== 0 ||
            !['first_store_published', 'first_store_created'].includes(saved?.challengeId) ||
            saved?.occurredAt !== existingFirstAt ||
            ledger?.userId !== uid || ledger?.deltaXp !== 2 ||
            ledger?.economy !== 'kyrub_xp' || ledger?.sourceType !== 'challenge' ||
            ledger?.sourceId !== saved?.challengeId ||
            ledger?.correlationId !== awardId || ledger?.idempotencyKey !== awardId ||
            ledger?.occurredAt !== existingFirstAt) {
          throw Error('FIRST_STORE_PUBLICATION_REWARD_IDEMPOTENCY_CONFLICT');
        }
        if (store.get('publicationStatus') !== 'published') tx.update(storeRef, { publicationStatus: 'published' });
        if (listing.get('publicationStatus') !== 'published') tx.update(listingRef, { publicationStatus: 'published' });
        syncTenant();
        return { replay: true, pitangas: 0, xp: 2 };
      }
      const replayResult = await awardVerifiedFirstStorePublicationInTransaction(tx, {
        challenge: challenge.data() as KyrubChallengeDefinition,
        event: { userId: uid, storeId: canonicalStoreId, publishedAt: existingFirstAt,
          isFirstPublication: true, isOwnerVerified: true, isMarketplaceVisible: true },
        receiptRef: userRoot.collection('challengeRewards').doc(awardId),
        xpLedgerRef: userRoot.collection('xpLedger').doc(`xp_${awardId}`),
        pitangaLedgerRef: userRoot.collection('rewardLedger').doc(`earn_${awardId}`),
      });
      if (store.get('publicationStatus') !== 'published') tx.update(storeRef, { publicationStatus: 'published' });
      if (listing.get('publicationStatus') !== 'published') tx.update(listingRef, { publicationStatus: 'published' });
      syncTenant();
      return replayResult;
    }
    // A pre-published record without immutable server evidence is not a
    // verifiable first-publication transition. Never mint XP retroactively.
    if (store.get('publicationStatus') === 'published' ||
        (listing.exists && listing.get('publicationStatus') === 'published')) {
      throw Error('FIRST_STORE_PUBLICATION_PREEXISTING_UNVERIFIED');
    }
    const publicationEvent = { userId: uid, storeId: canonicalStoreId, publishedAt,
      isFirstPublication: true, isOwnerVerified: true, isMarketplaceVisible: true };
    let eligible = false;
    if (challenge.exists) {
      try {
        planFirstStorePublishedReward(challenge.data() as KyrubChallengeDefinition, publicationEvent);
        eligible = true;
      } catch (error) {
        const code = error instanceof Error ? error.message : '';
        if (!['FIRST_STORE_PUBLICATION_CHALLENGE_NOT_ELIGIBLE',
          'FIRST_STORE_PUBLICATION_OUTSIDE_WINDOW'].includes(code)) throw error;
      }
    }
    const result = eligible
      ? await awardVerifiedFirstStorePublicationInTransaction(tx, {
          challenge: challenge.data() as KyrubChallengeDefinition,
          event: publicationEvent,
          receiptRef: userRoot.collection('challengeRewards').doc(awardId),
          xpLedgerRef: userRoot.collection('xpLedger').doc(`xp_${awardId}`),
          pitangaLedgerRef: userRoot.collection('rewardLedger').doc(`earn_${awardId}`),
        })
      : { replay: false, pitangas: 0 as const, xp: 0 as const };
    tx.update(storeRef, { publicationStatus: 'published', firstPublishedAt: publishedAt });
    if (listing.exists) {
      tx.update(listingRef, { publicationStatus: 'published', publishedAt: publicationTimestamp,
        updatedAt: publicationTimestamp });
    } else {
      const p = primary.data()!;
      if (typeof p.name !== 'string' || !p.name.trim() ||
          typeof p.slug !== 'string' || !p.slug.trim()) {
        throw Error('FIRST_STORE_PUBLICATION_PROFILE_INCOMPLETE');
      }
      tx.create(listingRef, {
        listingId, listingType: 'store', storeId: uid, ownerId: uid,
        name: p.name, slug: p.slug, description: p.description ?? '',
        address: p.address ?? '', logo: p.logo ?? '', banner: p.banner ?? '',
        primaryColor: p.primaryColor ?? '', keywords: p.keywords ?? [],
        status: p.status ?? 'closed', publicationStatus: 'published',
        publishedAt: publicationTimestamp, createdAt: publicationTimestamp,
        updatedAt: publicationTimestamp,
      });
    }
    syncTenant();
    tx.create(eventRef, {
      id: FIRST_STORE_PUBLISHED_CHALLENGE_ID,
      challengeId: FIRST_STORE_PUBLISHED_CHALLENGE_ID,
      userId: uid, storeId: canonicalStoreId,
      status: eligible ? 'pending' : 'unrewarded', isFirstPublication: true, publishedAt,
    });
    return result;
  });
}


/** Hide a previously verified publication without changing its first-publication evidence. */
export async function hideVerifiedFirstStorePublication(
  db: Firestore,
  input: { authenticatedUserId: string; canonicalStoreId: string },
): Promise<{ hidden: true }> {
  const { authenticatedUserId: uid, canonicalStoreId } = input;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(canonicalStoreId)) {
    throw Error('FIRST_STORE_PUBLICATION_INVALID_INPUT');
  }
  const storeRef = db.doc(`stores/${canonicalStoreId}`);
  const listingRef = db.doc(`marketplace_listings/s_${uid.length}_${uid}`);
  const eventRef = db.doc(`users/${uid}/verifiedStoreEvents/${FIRST_STORE_PUBLISHED_CHALLENGE_ID}`);
  const tenantRef = db.doc(`tenants/${uid}`);
  return db.runTransaction(async tx => {
    const [store, listing, event, tenant] = await Promise.all([
      tx.get(storeRef), tx.get(listingRef), tx.get(eventRef), tx.get(tenantRef),
    ]);
    const firstAt = store.get('firstPublishedAt');
    const listingAt = listing.get('publishedAt');
    const listingIso = listingAt instanceof Timestamp ? listingAt.toDate().toISOString() : listingAt;
    if (!store.exists || store.get('id') !== canonicalStoreId ||
        store.get('ownerId') !== uid || store.get('firstStoreCreationVerified') !== true ||
        !listing.exists || listing.get('ownerId') !== uid ||
        listing.get('storeId') !== uid || listing.get('listingType') !== 'store' ||
        !event.exists || event.get('userId') !== uid ||
        event.get('storeId') !== canonicalStoreId ||
        event.get('isFirstPublication') !== true ||
        event.get('publishedAt') !== firstAt || listingIso !== firstAt ||
        (tenant.exists && (tenant.get('id') !== uid || tenant.get('ownerId') !== uid))) {
      throw Error('FIRST_STORE_PUBLICATION_AUTHORITY_INVALID');
    }
    if (store.get('publicationStatus') !== 'paused') {
      tx.update(storeRef, { publicationStatus: 'paused' });
    }
    if (listing.get('publicationStatus') !== 'paused') {
      tx.update(listingRef, { publicationStatus: 'paused', updatedAt: Timestamp.now() });
    }
    if (tenant.exists && tenant.get('publicationStatus') !== 'paused') {
      tx.update(tenantRef, { publicationStatus: 'paused', updatedAt: Timestamp.now() });
    }
    return { hidden: true };
  });
}
