import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { recordVerifiedFirstLoginInTransaction } from '../server/gamification/firstLoginReceiptWriter.js';
import { grantSignedSessionWelcomeForVerifiedUser } from '../server/gamification/signedSessionWelcomeService.js';

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
    uid, disabled: false, metadata: { creationTime: createdAt },
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
    trustedFirstLoginEvent: true, receiptRef,
  }));
  const result = await Promise.all(Array.from({ length: 3 }, () =>
    grantSignedSessionWelcomeForVerifiedUser(db, auth as never, uid, uid, authTime)));
  assert.equal(result.filter(x => !x.replay).length, 1);
  assert.equal(result.filter(x => x.replay).length, 2);
  assert.equal((await db.doc(`users/${uid}/pitangaBalance/balance`).get()).get('availableKCoins'), 100);
  assert.equal((await db.collection(`users/${uid}/rewardLedger`).get()).size, 1);
});
