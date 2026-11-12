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
 * the public welcome campaign switch. This temporary path is restricted to
 * a Firestore emulator; flags alone must never enable it in production.
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
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  const emulatorAddress = emulatorHost?.split(':');
  const localHost = emulatorHost?.startsWith('[::1]:')
    ? emulatorHost.slice(0, 5) === '[::1]'
    : emulatorAddress?.[0] === 'localhost' || emulatorAddress?.[0] === '127.0.0.1';
  const port = emulatorHost?.startsWith('[::1]:')
    ? emulatorHost.slice(6) : emulatorAddress?.[1];
  if (!localHost || !port || !/^[0-9]{1,5}$/.test(port) ||
      Number(port) < 1 || Number(port) > 65535) {
    throw Error('WELCOME_CLEAN_BASELINE_EMULATOR_REQUIRED');
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
