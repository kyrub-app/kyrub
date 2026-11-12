import type { Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { FIRST_LOGIN_WELCOME_AWARD_ID, isWelcomeCampaignEligible } from './firstLoginWelcome.js';
import { awardFirstLoginWelcomeInTransaction } from './firstLoginWelcomeAwardTransaction.js';
import { verifyFirstLoginReceiptInTransaction } from './firstLoginReceiptVerification.js';

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
  // Opt-in launch gate: an unset cutoff disables grants. This prevents
  // retroactive awards to historical accounts and accidental production launch.
  const effectiveAtRaw = process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT?.trim();
  if (!effectiveAtRaw || !Number.isFinite(Date.parse(effectiveAtRaw))) {
    throw Error('WELCOME_CAMPAIGN_NOT_ENABLED');
  }
  const createdAt = user.metadata.creationTime;
  if (!createdAt) throw Error('WELCOME_AUTH_METADATA_UNAVAILABLE');
  if (!isWelcomeCampaignEligible(createdAt, effectiveAtRaw)) {
    throw Error('WELCOME_HISTORICAL_USER_NOT_ELIGIBLE');
  }
  const root = db.collection('users').doc(uid);
  const createdAtIso = new Date(createdAt).toISOString();
  const receiptRef = root.collection('authEvents').doc('first_login_v1');
  const ledgerRef = root.collection('rewardLedger').doc(`earn_${FIRST_LOGIN_WELCOME_AWARD_ID}`);
  // Verify immutable proof and perform the award in the SAME transaction.
  // No trusted receipt issuer is connected yet, so new grants remain blocked
  // until that independently verified authentication integration is deployed.
  return db.runTransaction(async tx => {
    const receipt = await verifyFirstLoginReceiptInTransaction(tx, {
      userId: uid, firebaseCreatedAt: createdAtIso, receiptRef,
    });
    return awardFirstLoginWelcomeInTransaction(tx, {
      userId: uid,
      authUserCreatedAt: createdAtIso,
      verifiedFirstSignInAt: receipt.occurredAt,
      balanceRef: root.collection('pitangaBalance').doc('balance'),
      ledgerRef,
    });
  });
};
