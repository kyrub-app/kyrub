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
