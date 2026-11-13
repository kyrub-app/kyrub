import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { hideVerifiedFirstStorePublication, publishFirstStoreAndAwardXp, syncVerifiedFirstStoreProfile } from '../server/gamification/firstStorePublicationAuthority.js';

const app = initializeApp({ projectId: 'kyrub-security-test' }, 'first-store-publication-emulator');
const db: Firestore = getFirestore(app);
const uid = 'first_publication_owner';
const canonicalId = 'first_publication_canonical';
const listingId = `s_${uid.length}_${uid}`;
const challenge = {
  id: 'first_store_published', title: 'Primeira publicação',
  description: 'Publique a primeira loja', status: 'published',
  validationMode: 'deterministic', sponsorType: 'kyrub',
  rewardKCoins: 0, rewardXp: 2, maxCompletionsPerUser: 1,
};

before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Emulator is mandatory: never connect to production');
});
after(async () => { await deleteApp(app); });
beforeEach(async () => {
  const docs = await db.listCollections();
  for (const collection of docs) {
    if (collection.id.startsWith('first_publication_')) {
      const snapshot = await collection.get();
      for (const document of snapshot.docs) await document.ref.delete();
    }
  }
  for (const path of [
    `stores/${canonicalId}`, `marketplace_listings/${listingId}`, `tenants/${uid}`,
    `global_challenges/first_store_published`,
    `users/${uid}/stores/${uid}`,
    `users/${uid}/verifiedStoreEvents/first_store_published`,
    `users/${uid}/challengeRewards/first_store_${uid}`,
    `users/${uid}/xpLedger/xp_first_store_${uid}`,
    `users/${uid}/rewardLedger/earn_first_store_${uid}`,
  ]) await db.doc(path).delete();
  await Promise.all([
    db.doc(`stores/${canonicalId}`).set({
      id: canonicalId, ownerId: uid, firstStoreCreationVerified: true,
      publicationStatus: 'paused', plan: 'free',
    }),
    db.doc(`users/${uid}/stores/${uid}`).set({
      id: uid, ownerId: uid, name: 'Loja teste', slug: 'loja-teste', plan: 'free',
    }),
    db.doc('global_challenges/first_store_published').set(challenge),
  ]);
});

test('first publication atomically creates listing, evidence and exactly 2 XP', async () => {
  assert.deepEqual(await publishFirstStoreAndAwardXp(db, {
    authenticatedUserId: uid, canonicalStoreId: canonicalId,
  }), { replay: false, pitangas: 0, xp: 2 });
  const [store, listing, event, xp, receipt, pitanga] = await Promise.all([
    db.doc(`stores/${canonicalId}`).get(),
    db.doc(`marketplace_listings/${listingId}`).get(),
    db.doc(`users/${uid}/verifiedStoreEvents/first_store_published`).get(),
    db.doc(`users/${uid}/xpLedger/xp_first_store_${uid}`).get(),
    db.doc(`users/${uid}/challengeRewards/first_store_${uid}`).get(),
    db.doc(`users/${uid}/rewardLedger/earn_first_store_${uid}`).get(),
  ]);
  assert.equal(store.get('publicationStatus'), 'published');
  assert.equal(listing.get('publicationStatus'), 'published');
  assert.equal(store.get('firstPublishedAt'), event.get('publishedAt'));
  assert.equal(listing.get('publishedAt').toDate().toISOString(), event.get('publishedAt'));
  assert.equal(xp.get('deltaXp'), 2);
  assert.equal(receipt.get('xp'), 2);
  assert.equal(pitanga.exists, false);
  assert.deepEqual(await publishFirstStoreAndAwardXp(db, {
    authenticatedUserId: uid, canonicalStoreId: canonicalId,
  }), { replay: true, pitangas: 0, xp: 2 });
});

test('concurrent publication calls create only one XP ledger and one receipt', async () => {
  const outcomes = await Promise.all(Array.from({ length: 5 }, () =>
    publishFirstStoreAndAwardXp(db, {
      authenticatedUserId: uid, canonicalStoreId: canonicalId,
    }),
  ));
  assert.equal(outcomes.filter(result => !result.replay).length, 1);
  assert.equal(outcomes.filter(result => result.replay).length, 4);
  const xp = await db.collection(`users/${uid}/xpLedger`).get();
  assert.equal(xp.size, 1);
  assert.equal(xp.docs[0].get('deltaXp'), 2);
});

test('prepublished client listing without server evidence does not earn XP', async () => {
  await db.doc(`marketplace_listings/${listingId}`).set({
    listingId, listingType: 'store', ownerId: uid, storeId: uid,
    publicationStatus: 'published',
  });
  await assert.rejects(publishFirstStoreAndAwardXp(db, {
    authenticatedUserId: uid, canonicalStoreId: canonicalId,
  }), /PREEXISTING_UNVERIFIED/);
  assert.equal((await db.doc(`users/${uid}/xpLedger/xp_first_store_${uid}`).get()).exists, false);
});

test('a different authenticated user cannot publish or receive first-store XP', async () => {
  const attacker = 'first_publication_attacker';
  await assert.rejects(
    publishFirstStoreAndAwardXp(db, {
      authenticatedUserId: attacker, canonicalStoreId: canonicalId,
    }),
    /FIRST_STORE_PUBLICATION_AUTHORITY_INVALID/,
  );
  const [store, listing, attackerXp, ownerXp] = await Promise.all([
    db.doc(`stores/${canonicalId}`).get(),
    db.doc(`marketplace_listings/${listingId}`).get(),
    db.doc(`users/${attacker}/xpLedger/xp_first_store_${attacker}`).get(),
    db.doc(`users/${uid}/xpLedger/xp_first_store_${uid}`).get(),
  ]);
  assert.equal(store.get('publicationStatus'), 'paused');
  assert.equal(listing.exists, false);
  assert.equal(attackerXp.exists, false);
  assert.equal(ownerXp.exists, false);
});


test('missing marketplace listing on replay fails closed without duplicate XP', async () => {
  await publishFirstStoreAndAwardXp(db, {
    authenticatedUserId: uid, canonicalStoreId: canonicalId,
  });
  await db.doc(`marketplace_listings/${listingId}`).delete();
  await assert.rejects(
    publishFirstStoreAndAwardXp(db, {
      authenticatedUserId: uid, canonicalStoreId: canonicalId,
    }),
    /FIRST_STORE_PUBLICATION_MARKER_CONFLICT/,
  );
  const [xp, receipt, listing] = await Promise.all([
    db.collection(`users/${uid}/xpLedger`).get(),
    db.collection(`users/${uid}/challengeRewards`).get(),
    db.doc(`marketplace_listings/${listingId}`).get(),
  ]);
  assert.equal(xp.size, 1);
  assert.equal(receipt.size, 1);
  assert.equal(listing.exists, false);
});


test('publication succeeds without a challenge and never grants XP retroactively', async () => {
  await db.doc('global_challenges/first_store_published').delete();
  assert.deepEqual(await publishFirstStoreAndAwardXp(db, {
    authenticatedUserId: uid, canonicalStoreId: canonicalId,
  }), { replay: false, pitangas: 0, xp: 0 });
  const [store, listing, event, xp] = await Promise.all([
    db.doc(`stores/${canonicalId}`).get(),
    db.doc(`marketplace_listings/${listingId}`).get(),
    db.doc(`users/${uid}/verifiedStoreEvents/first_store_published`).get(),
    db.collection(`users/${uid}/xpLedger`).get(),
  ]);
  assert.equal(store.get('publicationStatus'), 'published');
  assert.equal(listing.get('publicationStatus'), 'published');
  assert.equal(event.get('status'), 'unrewarded');
  assert.equal(xp.size, 0);
  await db.doc('global_challenges/first_store_published').set(challenge);
  assert.deepEqual(await publishFirstStoreAndAwardXp(db, {
    authenticatedUserId: uid, canonicalStoreId: canonicalId,
  }), { replay: true, pitangas: 0, xp: 0 });
  assert.equal((await db.collection(`users/${uid}/xpLedger`).get()).size, 0);
});

test('inactive challenge does not prevent first publication or grant XP', async () => {
  await db.doc('global_challenges/first_store_published').set({ ...challenge, status: 'draft' });
  assert.deepEqual(await publishFirstStoreAndAwardXp(db, {
    authenticatedUserId: uid, canonicalStoreId: canonicalId,
  }), { replay: false, pitangas: 0, xp: 0 });
  assert.equal((await db.doc(`marketplace_listings/${listingId}`).get()).get('publicationStatus'), 'published');
  assert.equal((await db.collection(`users/${uid}/xpLedger`).get()).size, 0);
});


test('republication after hiding restores visibility without duplicate XP or timestamp changes', async () => {
  await publishFirstStoreAndAwardXp(db, {
    authenticatedUserId: uid, canonicalStoreId: canonicalId,
  });
  const first = (await db.doc(`stores/${canonicalId}`).get()).get('firstPublishedAt');
  await Promise.all([
    db.doc(`stores/${canonicalId}`).update({ publicationStatus: 'paused' }),
    db.doc(`marketplace_listings/${listingId}`).update({ publicationStatus: 'paused' }),
  ]);
  const result = await publishFirstStoreAndAwardXp(db, {
    authenticatedUserId: uid, canonicalStoreId: canonicalId,
  });
  assert.deepEqual(result, { replay: true, pitangas: 0, xp: 2 });
  const [store, listing, xp] = await Promise.all([
    db.doc(`stores/${canonicalId}`).get(),
    db.doc(`marketplace_listings/${listingId}`).get(),
    db.collection(`users/${uid}/xpLedger`).get(),
  ]);
  assert.equal(store.get('publicationStatus'), 'published');
  assert.equal(listing.get('publicationStatus'), 'published');
  assert.equal(store.get('firstPublishedAt'), first);
  assert.equal(listing.get('publishedAt').toDate().toISOString(), first);
  assert.equal(xp.size, 1);
});


test('trusted hide and republish preserve original timestamp and award only once', async () => {
  const first = await publishFirstStoreAndAwardXp(db, {
    authenticatedUserId: uid, canonicalStoreId: canonicalId,
  });
  assert.equal(first.xp, 2);
  const firstAt = (await db.doc(`stores/${canonicalId}`).get()).get('firstPublishedAt');
  assert.deepEqual(await hideVerifiedFirstStorePublication(db, {
    authenticatedUserId: uid, canonicalStoreId: canonicalId,
  }), { hidden: true });
  const [hiddenStore, hiddenListing] = await Promise.all([
    db.doc(`stores/${canonicalId}`).get(), db.doc(`marketplace_listings/${listingId}`).get(),
  ]);
  assert.equal(hiddenStore.get('publicationStatus'), 'paused');
  assert.equal(hiddenListing.get('publicationStatus'), 'paused');
  assert.equal(hiddenListing.get('publishedAt').toDate().toISOString(), firstAt);
  await assert.rejects(() => hideVerifiedFirstStorePublication(db, {
    authenticatedUserId: 'different_user', canonicalStoreId: canonicalId,
  }), /FIRST_STORE_PUBLICATION_AUTHORITY_INVALID/);
  assert.deepEqual(await publishFirstStoreAndAwardXp(db, {
    authenticatedUserId: uid, canonicalStoreId: canonicalId,
  }), { replay: true, pitangas: 0, xp: 2 });
  const [listing, xp] = await Promise.all([
    db.doc(`marketplace_listings/${listingId}`).get(), db.collection(`users/${uid}/xpLedger`).get(),
  ]);
  assert.equal(listing.get('publicationStatus'), 'published');
  assert.equal(listing.get('publishedAt').toDate().toISOString(), firstAt);
  assert.equal(xp.size, 1);
});


test('trusted publication, hide and republish synchronize existing tenant fallback', async () => {
  const tenantRef = db.doc(`tenants/${uid}`);
  await tenantRef.set({ id: uid, ownerId: uid, publicationStatus: 'paused' });
  await publishFirstStoreAndAwardXp(db, { authenticatedUserId: uid, canonicalStoreId: canonicalId });
  assert.equal((await tenantRef.get()).get('publicationStatus'), 'published');
  await hideVerifiedFirstStorePublication(db, { authenticatedUserId: uid, canonicalStoreId: canonicalId });
  assert.equal((await tenantRef.get()).get('publicationStatus'), 'paused');
  await publishFirstStoreAndAwardXp(db, { authenticatedUserId: uid, canonicalStoreId: canonicalId });
  assert.equal((await tenantRef.get()).get('publicationStatus'), 'published');
  assert.equal((await db.collection(`users/${uid}/xpLedger`).get()).size, 1);
});


test('conflicting legacy tenant owner blocks publication atomically', async () => {
  await db.doc(`tenants/${uid}`).set({ id: uid, ownerId: 'another_owner', publicationStatus: 'paused' });
  await assert.rejects(() => publishFirstStoreAndAwardXp(db, {
    authenticatedUserId: uid, canonicalStoreId: canonicalId,
  }), /FIRST_STORE_PUBLICATION_TENANT_CONFLICT/);
  const [store, listing, xp, event] = await Promise.all([
    db.doc(`stores/${canonicalId}`).get(), db.doc(`marketplace_listings/${listingId}`).get(),
    db.collection(`users/${uid}/xpLedger`).get(),
    db.doc(`users/${uid}/verifiedStoreEvents/first_store_published`).get(),
  ]);
  assert.equal(store.get('publicationStatus'), 'paused');
  assert.equal(listing.exists, false);
  assert.equal(xp.size, 0);
  assert.equal(event.exists, false);
});

test('repeated authenticated hide is idempotent and does not alter evidence', async () => {
  await publishFirstStoreAndAwardXp(db, { authenticatedUserId: uid, canonicalStoreId: canonicalId });
  const first = (await db.doc(`stores/${canonicalId}`).get()).get('firstPublishedAt');
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(await hideVerifiedFirstStorePublication(db, {
      authenticatedUserId: uid, canonicalStoreId: canonicalId,
    }), { hidden: true });
  }
  const [store, listing, xp] = await Promise.all([
    db.doc(`stores/${canonicalId}`).get(), db.doc(`marketplace_listings/${listingId}`).get(),
    db.collection(`users/${uid}/xpLedger`).get(),
  ]);
  assert.equal(store.get('firstPublishedAt'), first);
  assert.equal(store.get('publicationStatus'), 'paused');
  assert.equal(listing.get('publicationStatus'), 'paused');
  assert.equal(listing.get('publishedAt').toDate().toISOString(), first);
  assert.equal(xp.size, 1);
});


test('removing challenge after verified reward does not prevent hide or republish', async () => {
  await publishFirstStoreAndAwardXp(db, { authenticatedUserId: uid, canonicalStoreId: canonicalId });
  const firstAt = (await db.doc(`stores/${canonicalId}`).get()).get('firstPublishedAt');
  await hideVerifiedFirstStorePublication(db, { authenticatedUserId: uid, canonicalStoreId: canonicalId });
  await db.doc('global_challenges/first_store_published').delete();
  assert.deepEqual(await publishFirstStoreAndAwardXp(db, {
    authenticatedUserId: uid, canonicalStoreId: canonicalId,
  }), { replay: true, pitangas: 0, xp: 2 });
  const [store, listing, xp, receipt] = await Promise.all([
    db.doc(`stores/${canonicalId}`).get(), db.doc(`marketplace_listings/${listingId}`).get(),
    db.collection(`users/${uid}/xpLedger`).get(), db.collection(`users/${uid}/challengeRewards`).get(),
  ]);
  assert.equal(store.get('publicationStatus'), 'published');
  assert.equal(listing.get('publicationStatus'), 'published');
  assert.equal(store.get('firstPublishedAt'), firstAt);
  assert.equal(xp.size, 1);
  assert.equal(receipt.size, 1);
});

test('missing challenge with corrupted XP evidence fails closed', async () => {
  await publishFirstStoreAndAwardXp(db, { authenticatedUserId: uid, canonicalStoreId: canonicalId });
  await hideVerifiedFirstStorePublication(db, { authenticatedUserId: uid, canonicalStoreId: canonicalId });
  await db.doc('global_challenges/first_store_published').delete();
  await db.doc(`users/${uid}/xpLedger/xp_first_store_${uid}`).delete();
  await assert.rejects(() => publishFirstStoreAndAwardXp(db, {
    authenticatedUserId: uid, canonicalStoreId: canonicalId,
  }), /FIRST_STORE_PUBLICATION_REWARD_IDEMPOTENCY_CONFLICT/);
  assert.equal((await db.doc(`stores/${canonicalId}`).get()).get('publicationStatus'), 'paused');
});


test('authenticated public profile sync preserves original publication and XP', async () => {
  await publishFirstStoreAndAwardXp(db, { authenticatedUserId: uid, canonicalStoreId: canonicalId });
  const firstAt = (await db.doc(`stores/${canonicalId}`).get()).get('firstPublishedAt');
  await db.doc(`users/${uid}/stores/${uid}`).update({ name: 'Loja renovada', description: 'Descrição atualizada' });
  assert.deepEqual(await syncVerifiedFirstStoreProfile(db, {
    authenticatedUserId: uid, canonicalStoreId: canonicalId,
  }), { synced: true });
  const [listing, store, xp] = await Promise.all([
    db.doc(`marketplace_listings/${listingId}`).get(), db.doc(`stores/${canonicalId}`).get(),
    db.collection(`users/${uid}/xpLedger`).get(),
  ]);
  assert.equal(listing.get('name'), 'Loja renovada');
  assert.equal(listing.get('description'), 'Descrição atualizada');
  assert.equal(listing.get('publishedAt').toDate().toISOString(), firstAt);
  assert.equal(store.get('firstPublishedAt'), firstAt);
  assert.equal(xp.size, 1);
});

test('profile sync rejects a different owner without changing public data', async () => {
  await publishFirstStoreAndAwardXp(db, { authenticatedUserId: uid, canonicalStoreId: canonicalId });
  await assert.rejects(() => syncVerifiedFirstStoreProfile(db, {
    authenticatedUserId: 'unauthorized_owner', canonicalStoreId: canonicalId,
  }), /FIRST_STORE_PUBLICATION_AUTHORITY_INVALID/);
  assert.equal((await db.doc(`marketplace_listings/${listingId}`).get()).get('name'), 'Loja teste');
});
