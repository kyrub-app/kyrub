import assert from 'node:assert/strict';
import test from 'node:test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { applyPitangaEarnInTransaction } from '../server/gamification/pitangaEarnTransaction.js';
import { applyPitangaSpendInTransaction } from '../server/gamification/pitangaSpendTransaction.js';
import { applyPitangaXpConversionInTransaction } from '../server/gamification/pitangaXpConversionTransaction.js';

test('Firestore Emulator serializes competing spend and XP conversion on one balance', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('requires FIRESTORE_EMULATOR_HOST; never connects to production');
    return;
  }
  const app = initializeApp({ projectId: 'kyrub-security-test' }, `pitanga-race-${Date.now()}`);
  t.after(async () => deleteApp(app));
  const db = getFirestore(app);
  const userId = `race_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const root = db.collection('users').doc(userId);
  const balanceRef = root.collection('pitangaBalance').doc('balance');
  const occurredAt = '2026-11-11T12:00:00Z';
  await balanceRef.create({ userId, availableKCoins: 0 });
  await db.runTransaction(tx => applyPitangaEarnInTransaction(tx, {
    userId, awardId: 'initial', sourceType: 'challenge', sourceId: 'challenge1',
    amount: 100, occurredAt, balanceRef,
    ledgerRef: root.collection('rewardLedger').doc('earn_initial'),
  }));
  const spend = db.runTransaction(tx => applyPitangaSpendInTransaction(tx, {
    userId, spendId: 'reward1', sourceId: 'reward1', amount: 100, occurredAt,
    balanceRef, debitRef: root.collection('rewardLedger').doc('spend_reward1'),
  }));
  const convert = db.runTransaction(tx => applyPitangaXpConversionInTransaction(tx, {
    userId, requestId: 'conversion1', requestedXp: 1, occurredAt, balanceRef,
    debitRef: root.collection('rewardLedger').doc('conversion_conversion1'),
    xpRef: root.collection('xpLedger').doc('conversion_conversion1'),
    receiptRef: root.collection('pitangaXpConversions').doc('conversion1'),
  }));
  const outcomes = await Promise.allSettled([spend, convert]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1,
    'exactly one competing debit must commit');
  assert.equal(outcomes.filter(x => x.status === 'rejected').length, 1);
  assert.equal((await balanceRef.get()).data()?.availableKCoins, 0);
  const ledger = await root.collection('rewardLedger').get();
  assert.equal(ledger.docs.filter(d => d.data().deltaKCoins < 0).length, 1);
  const xp = await root.collection('xpLedger').get();
  assert.equal(xp.size, outcomes[1].status === 'fulfilled' ? 1 : 0);
  const receipt = await root.collection('pitangaXpConversions').get();
  assert.equal(receipt.size, xp.size);
});

test('Firestore Emulator permits only one of two independent XP conversions', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('requires FIRESTORE_EMULATOR_HOST; never connects to production');
    return;
  }
  const app = initializeApp({ projectId: 'kyrub-security-test' }, `pitanga-convert-race-${Date.now()}`);
  t.after(async () => deleteApp(app));
  const db = getFirestore(app);
  const userId = `convert_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const root = db.collection('users').doc(userId);
  const balanceRef = root.collection('pitangaBalance').doc('balance');
  const occurredAt = '2026-11-11T12:00:00Z';
  await balanceRef.create({ userId, availableKCoins: 100 });
  const convert = (requestId: string) => db.runTransaction(tx =>
    applyPitangaXpConversionInTransaction(tx, {
      userId, requestId, requestedXp: 1, occurredAt, balanceRef,
      debitRef: root.collection('rewardLedger').doc(`conversion_${requestId}`),
      xpRef: root.collection('xpLedger').doc(`conversion_${requestId}`),
      receiptRef: root.collection('pitangaXpConversions').doc(requestId),
    }));
  const outcomes = await Promise.allSettled([convert('requestA'), convert('requestB')]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(x => x.status === 'rejected').length, 1);
  assert.equal((await balanceRef.get()).data()?.availableKCoins, 0);
  assert.equal((await root.collection('rewardLedger').get()).size, 1);
  assert.equal((await root.collection('xpLedger').get()).size, 1);
  assert.equal((await root.collection('pitangaXpConversions').get()).size, 1);
});

test('Firestore Emulator replays the same conversion without duplicating XP', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('requires FIRESTORE_EMULATOR_HOST; never connects to production');
    return;
  }
  const app = initializeApp({ projectId: 'kyrub-security-test' }, `pitanga-replay-${Date.now()}`);
  t.after(async () => deleteApp(app));
  const db = getFirestore(app);
  const userId = `replay_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const root = db.collection('users').doc(userId);
  const balanceRef = root.collection('pitangaBalance').doc('balance');
  const occurredAt = '2026-11-11T12:00:00Z';
  await balanceRef.create({ userId, availableKCoins: 100 });
  const run = (requestedXp: number) => db.runTransaction(tx =>
    applyPitangaXpConversionInTransaction(tx, {
      userId, requestId: 'sameRequest', requestedXp, occurredAt, balanceRef,
      debitRef: root.collection('rewardLedger').doc('conversion_sameRequest'),
      xpRef: root.collection('xpLedger').doc('conversion_sameRequest'),
      receiptRef: root.collection('pitangaXpConversions').doc('sameRequest'),
    }));
  const first = await run(1);
  assert.equal(first.replay, false);
  const retry = await run(1);
  assert.equal(retry.replay, true);
  await assert.rejects(() => run(2), /CONVERSION_IDEMPOTENCY_CONFLICT/);
  assert.equal((await balanceRef.get()).data()?.availableKCoins, 0);
  assert.equal((await root.collection('rewardLedger').get()).size, 1);
  assert.equal((await root.collection('xpLedger').get()).size, 1);
  assert.equal((await root.collection('pitangaXpConversions').get()).size, 1);
});

test('Firestore Emulator prevents two independent reward redemptions from double-spending', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('requires FIRESTORE_EMULATOR_HOST; never connects to production');
    return;
  }
  const app = initializeApp({ projectId: 'kyrub-security-test' }, `pitanga-spend-race-${Date.now()}`);
  t.after(async () => deleteApp(app));
  const db = getFirestore(app);
  const userId = `spend_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const root = db.collection('users').doc(userId);
  const balanceRef = root.collection('pitangaBalance').doc('balance');
  const occurredAt = '2026-11-11T12:00:00Z';
  await balanceRef.create({ userId, availableKCoins: 100 });
  const spend = (spendId: string) => db.runTransaction(tx =>
    applyPitangaSpendInTransaction(tx, {
      userId, spendId, sourceId: spendId, amount: 100, occurredAt,
      balanceRef, debitRef: root.collection('rewardLedger').doc(`spend_${spendId}`),
    }));
  const outcomes = await Promise.allSettled([spend('rewardA'), spend('rewardB')]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(x => x.status === 'rejected').length, 1);
  assert.equal((await balanceRef.get()).data()?.availableKCoins, 0);
  const ledger = await root.collection('rewardLedger').get();
  assert.equal(ledger.size, 1);
  assert.equal(ledger.docs[0].data().deltaKCoins, -100);
  assert.equal((await root.collection('xpLedger').get()).size, 0);
});
