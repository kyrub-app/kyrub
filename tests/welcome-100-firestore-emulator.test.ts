import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { grantCleanBaselineWelcomeInTransaction } from '../server/gamification/cleanBaselineWelcomeTransaction.js';

const app = initializeApp({ projectId: 'kyrub-security-test' }, 'welcome-100-emulator');
const db = getFirestore(app);
const createdAt = '2026-11-14T12:00:00.000Z';
const cutoff = '2026-11-14T00:00:00.000Z';
before(() => assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Firestore Emulator is mandatory'));
after(async () => deleteApp(app));

const grant = async (uid: string) => {
  const receiptRef = db.doc(`users/${uid}/authEvents/first_login_v1`);
  await receiptRef.set({ userId: uid, eventType: 'first_login', schemaVersion: 1,
    issuer: 'trusted_auth_server', sourceEventId: `auth-create-${uid}`,
    firebaseCreatedAt: createdAt, occurredAt: createdAt });
  const root = db.collection('users').doc(uid);
  return db.runTransaction(tx => grantCleanBaselineWelcomeInTransaction(tx, {
    userId: uid, firebaseCreatedAt: createdAt, campaignEffectiveAt: cutoff,
    isolatedCleanBaseline: true,
    receiptRef: root.collection('authEvents').doc('first_login_v1'),
    balanceRef: root.collection('pitangaBalance').doc('balance'),
    ledgerCollection: root.collection('rewardLedger'),
    awardRef: root.collection('rewardLedger').doc('earn_first_login_welcome_v1'),
  }));
};

test('new account receives 100 Pitangas once across concurrent Firestore transactions', async () => {
  const uid = 'welcome_emulator_concurrent';
  const results = await Promise.all(Array.from({ length: 5 }, () => grant(uid)));
  assert.equal(results.filter(x => !x.replay).length, 1);
  assert.equal(results.filter(x => x.replay).length, 4);
  const [balance, ledger] = await Promise.all([
    db.doc(`users/${uid}/pitangaBalance/balance`).get(),
    db.collection(`users/${uid}/rewardLedger`).get(),
  ]);
  assert.equal(balance.get('availableKCoins'), 100);
  assert.equal(ledger.size, 1);
  assert.equal(ledger.docs[0].get('deltaKCoins'), 100);
});

test('existing balance cannot be overwritten and no welcome award is created', async () => {
  const uid = 'welcome_emulator_existing';
  await db.doc(`users/${uid}/pitangaBalance/balance`).set({ userId: uid, availableKCoins: 55 });
  await assert.rejects(grant(uid), /WELCOME_CLEAN_BASELINE_NOT_EMPTY/);
  assert.equal((await db.doc(`users/${uid}/pitangaBalance/balance`).get()).get('availableKCoins'), 55);
  assert.equal((await db.collection(`users/${uid}/rewardLedger`).get()).size, 0);
});

test('existing ledger without balance blocks credit rather than replacing historical state', async () => {
  const uid = 'welcome_emulator_ledger';
  await db.doc(`users/${uid}/rewardLedger/legacy`).set({ userId: uid, deltaKCoins: 12 });
  await assert.rejects(grant(uid), /WELCOME_CLEAN_BASELINE_NOT_EMPTY/);
  assert.equal((await db.doc(`users/${uid}/pitangaBalance/balance`).get()).exists, false);
});
