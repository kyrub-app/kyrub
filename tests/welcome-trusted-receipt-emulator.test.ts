import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { recordVerifiedFirstLoginInTransaction } from '../server/gamification/firstLoginReceiptWriter.js';
import { recordWelcomeRegistrationFromTrustedAuthTrigger } from '../server/gamification/welcomeTrustedAuthRegistration.js';
import { grantSignedSessionWelcomeForVerifiedUser } from '../server/gamification/signedSessionWelcomeService.js';
import { verifyCleanBaselineSpendingEligibilityInTransaction } from '../server/gamification/cleanBaselineSpendingEligibility.js';
import { applyCleanBaselineVerifiedSpendInTransaction } from '../server/gamification/cleanBaselineVerifiedSpend.js';
import { applyCleanBaselineVerifiedXpConversionInTransaction } from '../server/gamification/cleanBaselineVerifiedXpConversion.js';
import { issueCleanBaselineVerifiedPitangaVoucherInTransaction } from '../server/gamification/cleanBaselineVerifiedVoucherIssuance.js';
import { buildKyrubRedemptionPlan } from '../shared/gamificationRedemption.js';

const projectId = 'kyrub-security-test';
const app = initializeApp({ projectId }, 'welcome-receipt-emulator');
const db = getFirestore(app);
const createdAt = '2026-11-14T12:00:00.000Z';
const authTime = Date.parse(createdAt) / 1000;
const envNames = [
  'KYRUB_PITANGA_SIGNED_SESSION_WELCOME_ENABLED',
  'KYRUB_PITANGA_WELCOME_PROJECT_ID',
  'KYRUB_WELCOME_BONUS_EFFECTIVE_AT',
  'KYRUB_PITANGA_WELCOME_FENCE_EPOCH',
] as const;
const previous = Object.fromEntries(envNames.map(key => [key, process.env[key]]));
const auth = {
  app: { options: { projectId } },
  getUser: async (uid: string) => ({
    uid, disabled: false, providerData: [{ providerId: 'google.com' }], metadata: { creationTime: createdAt },
  }),
};

before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Firestore Emulator is mandatory');
  process.env.KYRUB_PITANGA_SIGNED_SESSION_WELCOME_ENABLED = 'true';
  process.env.KYRUB_PITANGA_WELCOME_PROJECT_ID = projectId;
  process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT = '2026-11-14T00:00:00.000Z';
  process.env.KYRUB_PITANGA_WELCOME_FENCE_EPOCH = 'isolated-receipt-epoch';
  await db.doc('systemControl/pitangaLegacyWriterFence').set({
    status: 'fenced', writersVerified: true, epoch: 'isolated-receipt-epoch',
  });
});
after(async () => {
  for (const key of envNames) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  await deleteApp(app);
});

test('verified session without independently issued first-login receipt cannot mint Pitangas', async () => {
  const uid = 'welcome_no_trusted_receipt';
  await assert.rejects(
    grantSignedSessionWelcomeForVerifiedUser(db, auth as never, uid, uid, authTime),
    /WELCOME_FIRST_LOGIN_RECEIPT_MISSING/,
  );
  assert.equal((await db.doc(`users/${uid}/pitangaBalance/balance`).get()).exists, false);
});

test('trusted receipt plus verified session grants exactly 100 once with concurrent retries', async () => {
  const uid = 'welcome_trusted_receipt';
  const receiptRef = db.doc(`users/${uid}/authEvents/first_login_v1`);
  await db.runTransaction(tx => recordVerifiedFirstLoginInTransaction(tx, {
    userId: uid, firebaseCreatedAt: createdAt, occurredAt: createdAt,
    trustedFirstLoginEvent: true, sourceEventId: 'auth-create-welcome-test', receiptRef,
  }));
  const result = await Promise.all(Array.from({ length: 3 }, () =>
    grantSignedSessionWelcomeForVerifiedUser(db, auth as never, uid, uid, authTime)));
  assert.equal(result.filter(x => !x.replay).length, 1);
  assert.equal(result.filter(x => x.replay).length, 2);
  assert.equal((await db.doc(`users/${uid}/pitangaBalance/balance`).get()).get('availableKCoins'), 100);
  assert.equal((await db.collection(`users/${uid}/rewardLedger`).get()).size, 1);
});


test('isolated Auth registration adapter and signed session converge on one welcome credit', async () => {
  const uid = 'welcome_adapter_e2e';
  const event = {
    uid, metadata: { creationTime: createdAt },
    providerData: [{ providerId: 'google.com' }],
  };
  const context = { projectId, eventId: 'auth-create-adapter-e2e-1' };
  const receipts = await Promise.all(Array.from({ length: 3 }, () =>
    recordWelcomeRegistrationFromTrustedAuthTrigger(db, event, context)));
  assert.equal(receipts.filter(x => x.recorded).length, 1);
  assert.equal(receipts.filter(x => !x.recorded).length, 2);
  const credits = await Promise.all(Array.from({ length: 3 }, () =>
    grantSignedSessionWelcomeForVerifiedUser(db, auth as never, uid, uid, authTime)));
  assert.equal(credits.filter(x => !x.replay).length, 1);
  assert.equal(credits.filter(x => x.replay).length, 2);
  assert.equal((await db.doc(`users/${uid}/pitangaBalance/balance`).get()).get('availableKCoins'), 100);
  assert.equal((await db.collection(`users/${uid}/rewardLedger`).get()).size, 1);
});


test('trusted registration receipt never overwrites pre-existing Pitanga balance', async () => {
  const uid = 'welcome_adapter_existing_balance';
  await db.doc(`users/${uid}/pitangaBalance/balance`).set({ userId: uid, availableKCoins: 35 });
  await recordWelcomeRegistrationFromTrustedAuthTrigger(db, {
    uid, metadata: { creationTime: createdAt }, providerData: [{ providerId: 'google.com' }],
  }, { projectId, eventId: 'auth-create-existing-balance-1' });
  await assert.rejects(
    grantSignedSessionWelcomeForVerifiedUser(db, auth as never, uid, uid, authTime),
  );
  assert.equal((await db.doc(`users/${uid}/pitangaBalance/balance`).get()).get('availableKCoins'), 35);
  assert.equal((await db.collection(`users/${uid}/rewardLedger`).get()).size, 0);
});


test('trusted registration cannot credit a user with historical ledger but missing balance', async () => {
  const uid = 'welcome_adapter_historical_ledger';
  await db.doc(`users/${uid}/rewardLedger/earn_legacy_reward`).set({
    id: 'earn_legacy_reward', userId: uid, type: 'earn', deltaKCoins: 15,
  });
  await recordWelcomeRegistrationFromTrustedAuthTrigger(db, {
    uid, metadata: { creationTime: createdAt }, providerData: [{ providerId: 'google.com' }],
  }, { projectId, eventId: 'auth-create-historical-ledger-1' });
  await assert.rejects(
    grantSignedSessionWelcomeForVerifiedUser(db, auth as never, uid, uid, authTime),
    /WELCOME_CLEAN_BASELINE_NOT_EMPTY/,
  );
  assert.equal((await db.doc(`users/${uid}/pitangaBalance/balance`).get()).exists, false);
  assert.equal((await db.collection(`users/${uid}/rewardLedger`).get()).size, 1);
});


test('new-user balance has independently verified spending eligibility without migration receipt', async () => {
  const uid = 'welcome_spending_eligible';
  await db.runTransaction(tx => recordVerifiedFirstLoginInTransaction(tx, {
    userId: uid, firebaseCreatedAt: createdAt, occurredAt: createdAt,
    trustedFirstLoginEvent: true, sourceEventId: 'auth-create-spending-eligible',
    receiptRef: db.doc(`users/${uid}/authEvents/first_login_v1`),
  }));
  await grantSignedSessionWelcomeForVerifiedUser(db, auth as never, uid, uid, authTime);
  const refs = {
    userId: uid, firebaseCreatedAt: createdAt,
    receiptRef: db.doc(`users/${uid}/authEvents/first_login_v1`),
    balanceRef: db.doc(`users/${uid}/pitangaBalance/balance`),
    welcomeAwardRef: db.doc(`users/${uid}/rewardLedger/earn_first_login_welcome_v1`),
  };
  assert.deepEqual(await db.runTransaction(tx => verifyCleanBaselineSpendingEligibilityInTransaction(tx, refs)),
    { availablePitangas: 100 });
  assert.equal((await db.doc(`users/${uid}/pitangaMigration/receipt`).get()).exists, false);
  await db.doc(`users/${uid}/pitangaBalance/balance`).update({ migrationEpoch: 'forged' });
  await assert.rejects(db.runTransaction(tx => verifyCleanBaselineSpendingEligibilityInTransaction(tx, refs)),
    /WELCOME_SPENDING_BASELINE_UNVERIFIED/);
});


test('new-user spending eligibility rejects altered welcome award', async () => {
  const uid = 'welcome_spending_tampered_award';
  const receiptRef = db.doc(`users/${uid}/authEvents/first_login_v1`);
  const balanceRef = db.doc(`users/${uid}/pitangaBalance/balance`);
  const welcomeAwardRef = db.doc(`users/${uid}/rewardLedger/earn_first_login_welcome_v1`);
  await db.runTransaction(tx => recordVerifiedFirstLoginInTransaction(tx, {
    userId: uid, firebaseCreatedAt: createdAt, occurredAt: createdAt,
    trustedFirstLoginEvent: true, sourceEventId: 'auth-create-tampered-award', receiptRef,
  }));
  await grantSignedSessionWelcomeForVerifiedUser(db, auth as never, uid, uid, authTime);
  const refs = { userId: uid, firebaseCreatedAt: createdAt, receiptRef, balanceRef, welcomeAwardRef };
  await welcomeAwardRef.update({ deltaKCoins: 1000 });
  await assert.rejects(db.runTransaction(tx => verifyCleanBaselineSpendingEligibilityInTransaction(tx, refs)),
    /WELCOME_SPENDING_BASELINE_UNVERIFIED/);
  assert.equal((await balanceRef.get()).get('availableKCoins'), 100);
});


test('new-user spending eligibility rejects forged first-login receipt provenance', async () => {
  const uid = 'welcome_spending_forged_receipt';
  const receiptRef = db.doc(`users/${uid}/authEvents/first_login_v1`);
  const balanceRef = db.doc(`users/${uid}/pitangaBalance/balance`);
  const welcomeAwardRef = db.doc(`users/${uid}/rewardLedger/earn_first_login_welcome_v1`);
  await db.runTransaction(tx => recordVerifiedFirstLoginInTransaction(tx, {
    userId: uid, firebaseCreatedAt: createdAt, occurredAt: createdAt,
    trustedFirstLoginEvent: true, sourceEventId: 'auth-create-forged-receipt', receiptRef,
  }));
  await grantSignedSessionWelcomeForVerifiedUser(db, auth as never, uid, uid, authTime);
  await receiptRef.update({ issuer: 'client_browser' });
  await assert.rejects(db.runTransaction(tx => verifyCleanBaselineSpendingEligibilityInTransaction(tx, {
    userId: uid, firebaseCreatedAt: createdAt, receiptRef, balanceRef, welcomeAwardRef,
  })), /WELCOME_FIRST_LOGIN_RECEIPT_INVALID/);
  assert.equal((await balanceRef.get()).get('availableKCoins'), 100);
});


test('verified new-user balance can spend atomically once, then replay safely', async () => {
  const uid = 'welcome_verified_spend';
  const firstLoginReceiptRef = db.doc(`users/${uid}/authEvents/first_login_v1`);
  const balanceRef = db.doc(`users/${uid}/pitangaBalance/balance`);
  const welcomeAwardRef = db.doc(`users/${uid}/rewardLedger/earn_first_login_welcome_v1`);
  const debitRef = db.doc(`users/${uid}/rewardLedger/spend_welcome_test`);
  await db.runTransaction(tx => recordVerifiedFirstLoginInTransaction(tx, {
    userId: uid, firebaseCreatedAt: createdAt, occurredAt: createdAt,
    trustedFirstLoginEvent: true, sourceEventId: 'auth-create-spend-once', receiptRef: firstLoginReceiptRef,
  }));
  await grantSignedSessionWelcomeForVerifiedUser(db, auth as never, uid, uid, authTime);
  const input = {
    userId: uid, firebaseCreatedAt: createdAt, spendId: 'welcome_test', amount: 25,
    sourceId: 'test_redemption', occurredAt: createdAt, balanceRef, debitRef,
    firstLoginReceiptRef, welcomeAwardRef,
  };
  assert.deepEqual(await db.runTransaction(tx => applyCleanBaselineVerifiedSpendInTransaction(tx, input)),
    { remainingPitangas: 75, replay: false });
  assert.deepEqual(await db.runTransaction(tx => applyCleanBaselineVerifiedSpendInTransaction(tx, input)),
    { remainingPitangas: 75, replay: true });
  assert.equal((await balanceRef.get()).get('availableKCoins'), 75);
});


test('verified new-user spend rejects insufficient balance without partial debit', async () => {
  const uid = 'welcome_spend_insufficient';
  const firstLoginReceiptRef = db.doc(`users/${uid}/authEvents/first_login_v1`);
  const balanceRef = db.doc(`users/${uid}/pitangaBalance/balance`);
  const welcomeAwardRef = db.doc(`users/${uid}/rewardLedger/earn_first_login_welcome_v1`);
  const debitRef = db.doc(`users/${uid}/rewardLedger/spend_too_much`);
  await db.runTransaction(tx => recordVerifiedFirstLoginInTransaction(tx, {
    userId: uid, firebaseCreatedAt: createdAt, occurredAt: createdAt,
    trustedFirstLoginEvent: true, sourceEventId: 'auth-create-insufficient', receiptRef: firstLoginReceiptRef,
  }));
  await grantSignedSessionWelcomeForVerifiedUser(db, auth as never, uid, uid, authTime);
  await assert.rejects(db.runTransaction(tx => applyCleanBaselineVerifiedSpendInTransaction(tx, {
    userId: uid, firebaseCreatedAt: createdAt, spendId: 'too_much', amount: 101,
    sourceId: 'test_redemption', occurredAt: createdAt, balanceRef, debitRef,
    firstLoginReceiptRef, welcomeAwardRef,
  })), /PITANGA_SPEND_INSUFFICIENT_BALANCE/);
  assert.equal((await balanceRef.get()).get('availableKCoins'), 100);
  assert.equal((await debitRef.get()).exists, false);
});


test('concurrent verified new-user spends cannot double-spend 100 Pitangas', async () => {
  const uid = 'welcome_concurrent_spend';
  const firstLoginReceiptRef = db.doc(`users/${uid}/authEvents/first_login_v1`);
  const balanceRef = db.doc(`users/${uid}/pitangaBalance/balance`);
  const welcomeAwardRef = db.doc(`users/${uid}/rewardLedger/earn_first_login_welcome_v1`);
  await db.runTransaction(tx => recordVerifiedFirstLoginInTransaction(tx, {
    userId: uid, firebaseCreatedAt: createdAt, occurredAt: createdAt,
    trustedFirstLoginEvent: true, sourceEventId: 'auth-create-concurrent-spend', receiptRef: firstLoginReceiptRef,
  }));
  await grantSignedSessionWelcomeForVerifiedUser(db, auth as never, uid, uid, authTime);
  const spend = (spendId: string) => db.runTransaction(tx => applyCleanBaselineVerifiedSpendInTransaction(tx, {
    userId: uid, firebaseCreatedAt: createdAt, spendId, amount: 80,
    sourceId: 'test_redemption', occurredAt: createdAt, balanceRef,
    debitRef: db.doc(`users/${uid}/rewardLedger/spend_${spendId}`),
    firstLoginReceiptRef, welcomeAwardRef,
  }));
  const outcomes = await Promise.allSettled([spend('concurrent_a'), spend('concurrent_b')]);
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(outcome => outcome.status === 'rejected').length, 1);
  assert.equal((await balanceRef.get()).get('availableKCoins'), 20);
  const [a, b] = await Promise.all([
    db.doc(`users/${uid}/rewardLedger/spend_concurrent_a`).get(),
    db.doc(`users/${uid}/rewardLedger/spend_concurrent_b`).get(),
  ]);
  assert.equal(Number(a.exists) + Number(b.exists), 1);
});


test('concurrent replay of same verified spend remains one debit', async () => {
  const uid = 'welcome_concurrent_replay';
  const firstLoginReceiptRef = db.doc(`users/${uid}/authEvents/first_login_v1`);
  const balanceRef = db.doc(`users/${uid}/pitangaBalance/balance`);
  const welcomeAwardRef = db.doc(`users/${uid}/rewardLedger/earn_first_login_welcome_v1`);
  const debitRef = db.doc(`users/${uid}/rewardLedger/spend_same_request`);
  await db.runTransaction(tx => recordVerifiedFirstLoginInTransaction(tx, {
    userId: uid, firebaseCreatedAt: createdAt, occurredAt: createdAt,
    trustedFirstLoginEvent: true, sourceEventId: 'auth-create-concurrent-replay', receiptRef: firstLoginReceiptRef,
  }));
  await grantSignedSessionWelcomeForVerifiedUser(db, auth as never, uid, uid, authTime);
  const input = {
    userId: uid, firebaseCreatedAt: createdAt, spendId: 'same_request', amount: 60,
    sourceId: 'test_redemption', occurredAt: createdAt, balanceRef, debitRef,
    firstLoginReceiptRef, welcomeAwardRef,
  };
  const outcomes = await Promise.all([
    db.runTransaction(tx => applyCleanBaselineVerifiedSpendInTransaction(tx, input)),
    db.runTransaction(tx => applyCleanBaselineVerifiedSpendInTransaction(tx, input)),
  ]);
  assert.equal(outcomes.filter(outcome => outcome.replay === false).length, 1);
  assert.equal(outcomes.filter(outcome => outcome.replay === true).length, 1);
  assert.equal((await balanceRef.get()).get('availableKCoins'), 40);
  assert.equal((await debitRef.get()).get('deltaKCoins'), -60);
});


test('same spend identifier with different amount fails without altering original debit', async () => {
  const uid = 'welcome_spend_conflict';
  const firstLoginReceiptRef = db.doc(`users/${uid}/authEvents/first_login_v1`);
  const balanceRef = db.doc(`users/${uid}/pitangaBalance/balance`);
  const welcomeAwardRef = db.doc(`users/${uid}/rewardLedger/earn_first_login_welcome_v1`);
  const debitRef = db.doc(`users/${uid}/rewardLedger/spend_conflict_request`);
  await db.runTransaction(tx => recordVerifiedFirstLoginInTransaction(tx, {
    userId: uid, firebaseCreatedAt: createdAt, occurredAt: createdAt,
    trustedFirstLoginEvent: true, sourceEventId: 'auth-create-spend-conflict', receiptRef: firstLoginReceiptRef,
  }));
  await grantSignedSessionWelcomeForVerifiedUser(db, auth as never, uid, uid, authTime);
  const input = {
    userId: uid, firebaseCreatedAt: createdAt, spendId: 'conflict_request', amount: 30,
    sourceId: 'test_redemption', occurredAt: createdAt, balanceRef, debitRef,
    firstLoginReceiptRef, welcomeAwardRef,
  };
  await db.runTransaction(tx => applyCleanBaselineVerifiedSpendInTransaction(tx, input));
  await assert.rejects(db.runTransaction(tx => applyCleanBaselineVerifiedSpendInTransaction(tx, {
    ...input, amount: 45,
  })), /PITANGA_SPEND_IDEMPOTENCY_CONFLICT/);
  assert.equal((await balanceRef.get()).get('availableKCoins'), 70);
  assert.equal((await debitRef.get()).get('deltaKCoins'), -30);
});


test('same spend identifier with different source fails without changing original ledger', async () => {
  const uid = 'welcome_spend_source_conflict';
  const firstLoginReceiptRef = db.doc(`users/${uid}/authEvents/first_login_v1`);
  const balanceRef = db.doc(`users/${uid}/pitangaBalance/balance`);
  const welcomeAwardRef = db.doc(`users/${uid}/rewardLedger/earn_first_login_welcome_v1`);
  const debitRef = db.doc(`users/${uid}/rewardLedger/spend_source_conflict`);
  await db.runTransaction(tx => recordVerifiedFirstLoginInTransaction(tx, {
    userId: uid, firebaseCreatedAt: createdAt, occurredAt: createdAt,
    trustedFirstLoginEvent: true, sourceEventId: 'auth-create-source-conflict', receiptRef: firstLoginReceiptRef,
  }));
  await grantSignedSessionWelcomeForVerifiedUser(db, auth as never, uid, uid, authTime);
  const input = {
    userId: uid, firebaseCreatedAt: createdAt, spendId: 'source_conflict', amount: 20,
    sourceId: 'redemption_original', occurredAt: createdAt, balanceRef, debitRef,
    firstLoginReceiptRef, welcomeAwardRef,
  };
  await db.runTransaction(tx => applyCleanBaselineVerifiedSpendInTransaction(tx, input));
  await assert.rejects(db.runTransaction(tx => applyCleanBaselineVerifiedSpendInTransaction(tx, {
    ...input, sourceId: 'redemption_different',
  })), /PITANGA_SPEND_IDEMPOTENCY_CONFLICT/);
  assert.equal((await balanceRef.get()).get('availableKCoins'), 80);
  assert.equal((await debitRef.get()).get('sourceId'), 'redemption_original');
});


test('welcome replay rejects a tampered original award instead of treating it as success', async () => {
  const uid = 'welcome_replay_tampered_award';
  const receiptRef = db.doc(`users/${uid}/authEvents/first_login_v1`);
  const awardRef = db.doc(`users/${uid}/rewardLedger/earn_first_login_welcome_v1`);
  const balanceRef = db.doc(`users/${uid}/pitangaBalance/balance`);
  await db.runTransaction(tx => recordVerifiedFirstLoginInTransaction(tx, {
    userId: uid, firebaseCreatedAt: createdAt, occurredAt: createdAt,
    trustedFirstLoginEvent: true, sourceEventId: 'auth-create-replay-tamper', receiptRef,
  }));
  await grantSignedSessionWelcomeForVerifiedUser(db, auth as never, uid, uid, authTime);
  await awardRef.update({ occurredAt: '2026-11-14T12:01:00.000Z' });
  await assert.rejects(
    grantSignedSessionWelcomeForVerifiedUser(db, auth as never, uid, uid, authTime),
    /WELCOME_CLEAN_BASELINE_REPLAY_CONFLICT/,
  );
  assert.equal((await balanceRef.get()).get('availableKCoins'), 100);
});


test('clean-baseline XP conversion rejects insufficient welcome balance atomically', async () => {
  const uid = 'welcome_xp_insufficient';
  const root = db.collection('users').doc(uid);
  const firstLoginReceiptRef = root.collection('authEvents').doc('first_login_v1');
  const balanceRef = root.collection('pitangaBalance').doc('balance');
  const welcomeAwardRef = root.collection('rewardLedger').doc('earn_first_login_welcome_v1');
  const requestId = 'xp_insufficient';
  const receiptRef = root.collection('pitangaXpConversions').doc(requestId);
  const debitRef = root.collection('rewardLedger').doc(`conversion_${requestId}`);
  const xpRef = root.collection('xpLedger').doc(`conversion_${requestId}`);
  await db.runTransaction(tx => recordVerifiedFirstLoginInTransaction(tx, {
    userId: uid, firebaseCreatedAt: createdAt, occurredAt: createdAt,
    trustedFirstLoginEvent: true, sourceEventId: 'auth-create-xp-insufficient', receiptRef: firstLoginReceiptRef,
  }));
  await grantSignedSessionWelcomeForVerifiedUser(db, auth as never, uid, uid, authTime);
  await assert.rejects(db.runTransaction(tx => applyCleanBaselineVerifiedXpConversionInTransaction(tx, {
    userId: uid, firebaseCreatedAt: createdAt, requestId, requestedXp: 1,
    occurredAt: createdAt, balanceRef, receiptRef, debitRef, xpRef,
    firstLoginReceiptRef, welcomeAwardRef,
  })), /PITANGA_BALANCE_INSUFFICIENT/);
  assert.equal((await balanceRef.get()).get('availableKCoins'), 100);
  for (const ref of [receiptRef, debitRef, xpRef]) assert.equal((await ref.get()).exists, false);
});


test('clean-baseline conversion atomically debits 1000 Pitangas and credits one XP only once', async () => {
  const uid = 'welcome_xp_success';
  const root = db.collection('users').doc(uid);
  const firstLoginReceiptRef = root.collection('authEvents').doc('first_login_v1');
  const balanceRef = root.collection('pitangaBalance').doc('balance');
  const welcomeAwardRef = root.collection('rewardLedger').doc('earn_first_login_welcome_v1');
  const requestId = 'xp_success';
  const receiptRef = root.collection('pitangaXpConversions').doc(requestId);
  const debitRef = root.collection('rewardLedger').doc(`conversion_${requestId}`);
  const xpRef = root.collection('xpLedger').doc(`conversion_${requestId}`);
  await db.runTransaction(tx => recordVerifiedFirstLoginInTransaction(tx, {
    userId: uid, firebaseCreatedAt: createdAt, occurredAt: createdAt,
    trustedFirstLoginEvent: true, sourceEventId: 'auth-create-xp-success', receiptRef: firstLoginReceiptRef,
  }));
  await grantSignedSessionWelcomeForVerifiedUser(db, auth as never, uid, uid, authTime);
  // Isolated fixture: 900 additional Pitangas earned through the canonical ledger.
  await db.runTransaction(async tx => {
    const balance = await tx.get(balanceRef);
    assert.equal(balance.get('availableKCoins'), 100);
    tx.update(balanceRef, { availableKCoins: 1000 });
    tx.create(root.collection('rewardLedger').doc('earn_fixture_900'), {
      id: 'earn_fixture_900', userId: uid, type: 'earn', economy: 'k_coin',
      deltaKCoins: 900, sourceType: 'challenge', sourceId: 'fixture_900',
      correlationId: 'fixture_900', idempotencyKey: 'pitanga_earn_fixture_900', occurredAt: createdAt,
    });
  });
  const input = {
    userId: uid, firebaseCreatedAt: createdAt, requestId, requestedXp: 1,
    occurredAt: createdAt, balanceRef, receiptRef, debitRef, xpRef,
    firstLoginReceiptRef, welcomeAwardRef,
  };
  const results = await Promise.all(Array.from({ length: 3 }, () =>
    db.runTransaction(tx => applyCleanBaselineVerifiedXpConversionInTransaction(tx, input))));
  assert.equal(results.filter(result => !result.replay).length, 1);
  assert.equal(results.filter(result => result.replay).length, 2);
  assert.equal((await balanceRef.get()).get('availableKCoins'), 0);
  assert.equal((await debitRef.get()).get('deltaKCoins'), -1000);
  assert.equal((await xpRef.get()).get('deltaXp'), 1);
  assert.equal((await receiptRef.get()).get('status'), 'committed');
  assert.equal((await root.collection('xpLedger').get()).size, 1);
});


test('verified new-user voucher issuance is atomic and idempotent under concurrent retries', async () => {
  const uid = 'welcome_voucher_success';
  const root = db.collection('users').doc(uid);
  const firstLoginReceiptRef = root.collection('authEvents').doc('first_login_v1');
  const balanceRef = root.collection('pitangaBalance').doc('balance');
  const welcomeAwardRef = root.collection('rewardLedger').doc('earn_first_login_welcome_v1');
  await db.runTransaction(tx => recordVerifiedFirstLoginInTransaction(tx, {
    userId: uid, firebaseCreatedAt: createdAt, occurredAt: createdAt,
    trustedFirstLoginEvent: true, sourceEventId: 'auth-create-voucher-success', receiptRef: firstLoginReceiptRef,
  }));
  await grantSignedSessionWelcomeForVerifiedUser(db, auth as never, uid, uid, authTime);
  const plan = buildKyrubRedemptionPlan({
    userId: uid, reward: { id: 'welcome_voucher', costKCoins: 40 } as never,
    currentBalanceKCoins: 100, idempotencyKey: 'voucher_once', correlationId: 'voucher_once',
    occurredAt: createdAt, validUntil: '2026-12-14T12:00:00.000Z',
  });
  const input = {
    plan, firebaseCreatedAt: createdAt, balanceRef, firstLoginReceiptRef, welcomeAwardRef,
    redemptionRef: root.collection('rewardRedemptions').doc(plan.redemptionId),
    voucherRef: root.collection('rewardVouchers').doc(plan.redemptionId),
    debitRef: root.collection('rewardLedger').doc(plan.debitEntry.id),
    auditRef: root.collection('rewardAudit').doc(plan.redemptionId),
  };
  const results = await Promise.all(Array.from({ length: 3 }, () =>
    db.runTransaction(tx => issueCleanBaselineVerifiedPitangaVoucherInTransaction(tx, input))));
  assert.equal(results.filter(x => !x.replay).length, 1);
  assert.equal(results.filter(x => x.replay).length, 2);
  assert.equal((await balanceRef.get()).get('availableKCoins'), 60);
  assert.equal((await input.voucherRef.get()).get('status'), 'active');
  assert.equal((await input.debitRef.get()).get('deltaKCoins'), -40);
  assert.equal((await root.collection('rewardVouchers').get()).size, 1);
});

test('verified new-user voucher rejects insufficient balance without partial writes', async () => {
  const uid = 'welcome_voucher_insufficient';
  const root = db.collection('users').doc(uid);
  const firstLoginReceiptRef = root.collection('authEvents').doc('first_login_v1');
  const balanceRef = root.collection('pitangaBalance').doc('balance');
  const welcomeAwardRef = root.collection('rewardLedger').doc('earn_first_login_welcome_v1');
  await db.runTransaction(tx => recordVerifiedFirstLoginInTransaction(tx, {
    userId: uid, firebaseCreatedAt: createdAt, occurredAt: createdAt,
    trustedFirstLoginEvent: true, sourceEventId: 'auth-create-voucher-insufficient', receiptRef: firstLoginReceiptRef,
  }));
  await grantSignedSessionWelcomeForVerifiedUser(db, auth as never, uid, uid, authTime);
  const plan = buildKyrubRedemptionPlan({
    userId: uid, reward: { id: 'expensive_voucher', costKCoins: 150 } as never,
    currentBalanceKCoins: 150, idempotencyKey: 'voucher_overdraw', correlationId: 'voucher_overdraw',
    occurredAt: createdAt, validUntil: '2026-12-14T12:00:00.000Z',
  });
  const input = {
    plan, firebaseCreatedAt: createdAt, balanceRef, firstLoginReceiptRef, welcomeAwardRef,
    redemptionRef: root.collection('rewardRedemptions').doc(plan.redemptionId),
    voucherRef: root.collection('rewardVouchers').doc(plan.redemptionId),
    debitRef: root.collection('rewardLedger').doc(plan.debitEntry.id),
    auditRef: root.collection('rewardAudit').doc(plan.redemptionId),
  };
  await assert.rejects(db.runTransaction(tx => issueCleanBaselineVerifiedPitangaVoucherInTransaction(tx, input)),
    /PITANGA_VOUCHER_INSUFFICIENT_BALANCE/);
  assert.equal((await balanceRef.get()).get('availableKCoins'), 100);
  for (const ref of [input.redemptionRef, input.voucherRef, input.debitRef, input.auditRef])
    assert.equal((await ref.get()).exists, false);
});
