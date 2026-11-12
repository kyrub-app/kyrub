import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { isWelcomeCampaignEligible } from './firstLoginWelcome.js';
import { grantCleanBaselineWelcomeInTransaction } from './cleanBaselineWelcomeTransaction.js';

/**
 * Isolated, opt-in clean-baseline alternative to historical migration.
 * Requires a verified immutable receipt already written by a trusted auth
 * event. This service never manufactures login evidence.
 *
 * KYRUB_PITANGA_CLEAN_BASELINE_ENABLED is deliberately independent from
 * the public welcome campaign switch. Never enable in an existing ledger.
 */
export const grantCleanBaselineWelcomeForVerifiedUser = async (
  db: Firestore,
  auth: Auth,
  uid: string,
): Promise<{ balance: number; replay: boolean }> => {
  if (process.env.KYRUB_PITANGA_CLEAN_BASELINE_ENABLED !== 'true' ||
      process.env.KYRUB_PITANGA_CLEAN_BASELINE_ISOLATED !== 'true') {
    throw Error('WELCOME_CLEAN_BASELINE_DISABLED');
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw Error('WELCOME_USER_INVALID');
  const cutoff = process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT?.trim();
  const user = await auth.getUser(uid);
  if (user.uid !== uid || user.disabled || !user.metadata.creationTime ||
      !isWelcomeCampaignEligible(user.metadata.creationTime, cutoff)) {
    throw Error('WELCOME_CLEAN_BASELINE_USER_INELIGIBLE');
  }
  const root = db.collection('users').doc(uid);
  return db.runTransaction(tx => grantCleanBaselineWelcomeInTransaction(tx, {
    userId: uid,
    firebaseCreatedAt: new Date(user.metadata.creationTime!).toISOString(),
    campaignEffectiveAt: cutoff!,
    isolatedCleanBaseline: true,
    receiptRef: root.collection('authEvents').doc('first_login_v1'),
    balanceRef: root.collection('pitangaBalance').doc('balance'),
    ledgerCollection: root.collection('rewardLedger'),
    awardRef: root.collection('rewardLedger').doc('earn_first_login_welcome_v1'),
  }));
};
