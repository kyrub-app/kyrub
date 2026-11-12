import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { verifyWelcomeInitialSession } from './welcomeInitialSession.js';
import { grantCleanBaselineWelcomeInTransaction } from './cleanBaselineWelcomeTransaction.js';

/**
 * Production candidate, OFF by default. The HTTP boundary MUST pass the UID
 * and auth_time from the same verified Firebase ID token. Do not enable until
 * all Pitanga writers and existing-account balance paths are audited.
 */
export const grantSignedSessionWelcomeForVerifiedUser = async (
  db: Firestore, auth: Auth, uid: string, tokenUid: string,
  signedAuthTimeSeconds: number,
): Promise<{ balance: number; replay: boolean }> => {
  if (process.env.KYRUB_PITANGA_SIGNED_SESSION_WELCOME_ENABLED !== 'true') {
    throw Error('WELCOME_SIGNED_SESSION_DISABLED');
  }
  const cutoff = process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT?.trim();
  if (!cutoff || !Number.isFinite(Date.parse(cutoff))) {
    throw Error('WELCOME_CAMPAIGN_NOT_ENABLED');
  }
  const user = await auth.getUser(uid);
  if (user.uid !== uid || user.disabled || !user.metadata.creationTime) {
    throw Error('WELCOME_AUTH_USER_INVALID');
  }
  const createdAt = new Date(user.metadata.creationTime).toISOString();
  const { occurredAt } = verifyWelcomeInitialSession({
    uid, tokenUid, authTimeSeconds: signedAuthTimeSeconds,
    firebaseCreatedAt: createdAt, campaignEffectiveAt: cutoff,
  });
  const root = db.collection('users').doc(uid);
  return db.runTransaction(tx => grantCleanBaselineWelcomeInTransaction(tx, {
    userId: uid, firebaseCreatedAt: createdAt,
    campaignEffectiveAt: cutoff, isolatedCleanBaseline: true,
    signedInitialSessionAt: occurredAt,
    receiptRef: root.collection('authEvents').doc('first_login_v1'),
    balanceRef: root.collection('pitangaBalance').doc('balance'),
    ledgerCollection: root.collection('rewardLedger'),
    awardRef: root.collection('rewardLedger').doc('earn_first_login_welcome_v1'),
  }));
};
