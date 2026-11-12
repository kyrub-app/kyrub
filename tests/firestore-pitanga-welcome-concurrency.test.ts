import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { grantCleanBaselineWelcomeInTransaction } from '../server/gamification/cleanBaselineWelcomeTransaction.js';

const projectId = 'kyrub-security-test';
let app: App;
let db: ReturnType<typeof getFirestore>;
const uid = 'welcome_concurrent_test';

before(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw Error('FIRESTORE_EMULATOR_HOST_REQUIRED');
  }
  app = initializeApp({ projectId }, 'pitanga-welcome-concurrency-test');
  db = getFirestore(app);
});
after(async () => { if (app) await deleteApp(app); });
beforeEach(async () => {
  const root = db.collection('users').doc(uid);
  const existing = await root.collection('rewardLedger').get();
  for (const doc of existing.docs) await doc.ref.delete();
  await root.collection('pitangaBalance').doc('balance').delete();
});

const claim = () => {
  const root = db.collection('users').doc(uid);
  return db.runTransaction(tx => grantCleanBaselineWelcomeInTransaction(tx, {
    userId: uid,
    firebaseCreatedAt: '2026-11-12T12:00:00.000Z',
    campaignEffectiveAt: '2026-11-12T00:00:00.000Z',
    isolatedCleanBaseline: true,
    signedInitialSessionAt: '2026-11-12T12:00:30.000Z',
    receiptRef: root.collection('authEvents').doc('first_login_v1'),
    balanceRef: root.collection('pitangaBalance').doc('balance'),
    ledgerCollection: root.collection('rewardLedger'),
    awardRef: root.collection('rewardLedger').doc('earn_first_login_welcome_v1'),
  }));
};

test('Firestore emulator grants 1000 Pitangas exactly once across concurrent transactions', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () => claim()));
  assert.equal(results.filter(result => !result.replay).length, 1);
  assert.equal(results.filter(result => result.replay).length, 7);
  const root = db.collection('users').doc(uid);
  const balance = await root.collection('pitangaBalance').doc('balance').get();
  const ledger = await root.collection('rewardLedger').get();
  assert.equal(balance.data()?.availableKCoins, 1000);
  assert.equal(ledger.size, 1);
  assert.equal(ledger.docs[0]?.data()?.deltaKCoins, 1000);
});
