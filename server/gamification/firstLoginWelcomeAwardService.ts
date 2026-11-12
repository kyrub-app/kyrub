import type { Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { FIRST_LOGIN_WELCOME_AWARD_ID } from './firstLoginWelcome.js';
import { awardFirstLoginWelcomeInTransaction } from './firstLoginWelcomeAwardTransaction.js';

/**
 * Trusted post-authentication handler. The caller MUST verify the Firebase ID
 * token and pass its uid; this service re-reads Auth metadata server-side.
 * Existing historical balances are never silently initialized to zero.
 */
export const awardFirstLoginWelcomeForVerifiedUser = async (
  db: Firestore,
  auth: Auth,
  uid: string,
): Promise<{ balance: number; replay: boolean }> => {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw Error('WELCOME_USER_INVALID');
  const user = await auth.getUser(uid);
  if (user.uid !== uid || user.disabled) throw Error('WELCOME_AUTH_USER_INVALID');
  const createdAt = user.metadata.creationTime;
  const firstSignInAt = user.metadata.lastSignInTime;
  if (!createdAt || !firstSignInAt) throw Error('WELCOME_AUTH_METADATA_UNAVAILABLE');
  const root = db.collection('users').doc(uid);
  const ledgerRef = root.collection('rewardLedger').doc(`earn_${FIRST_LOGIN_WELCOME_AWARD_ID}`);
  // Firebase lastSignInTime changes on subsequent logins. For an existing
  // grant, replay using its immutable server ledger timestamp instead.
  const existingGrant = await ledgerRef.get();
  // An existing ledger is only replayed after verifying its complete contents
  // in the transaction. This read never authorizes a new grant.
  const occurredAt = existingGrant.exists ? existingGrant.get('occurredAt') : firstSignInAt;
  if (typeof occurredAt !== 'string') throw Error('WELCOME_LEDGER_TIMESTAMP_INVALID');
  return db.runTransaction(tx => awardFirstLoginWelcomeInTransaction(tx, {
    userId: uid,
    authUserCreatedAt: new Date(createdAt).toISOString(),
    verifiedFirstSignInAt: new Date(occurredAt).toISOString(),
    balanceRef: root.collection('pitangaBalance').doc('balance'),
    ledgerRef,
  }));
};
