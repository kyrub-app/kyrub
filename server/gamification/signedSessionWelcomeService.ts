import type { Firestore } from 'firebase-admin/firestore';
import { verifyWelcomeInitialSession } from './welcomeInitialSession.js';
import { grantCleanBaselineWelcomeInTransaction } from './cleanBaselineWelcomeTransaction.js';
import { verifyFirstLoginReceiptInTransaction } from './firstLoginReceiptVerification.js';
import { isWelcomeCampaignEligible } from './firstLoginWelcome.js';

/** Narrow SDK contract shared across the app and standalone Functions package. */
export type WelcomeAuth = {
  app: { options: { projectId?: string } };
  getUser(uid: string): Promise<{
    uid: string; disabled: boolean;
    metadata: { creationTime: string };
    providerData: ReadonlyArray<{ providerId: string }>;
  }>;
};

/**
 * Shared transaction service, OFF by default. Signed-session callers must use
 * UID/auth_time from the same verified token; the lifecycle consumer supplies
 * the trusted registration timestamp. Both require independent receipt and fence.
 */
const grantWelcomeForUserWithTrustedReceipt = async (
  db: Firestore, auth: WelcomeAuth, uid: string, tokenUid: string,
  signedAuthTimeSeconds?: number,
  trustedRegistrationCreatedAt?: string,
): Promise<{ balance: number; replay: boolean }> => {
  if (process.env.KYRUB_PITANGA_SIGNED_SESSION_WELCOME_ENABLED !== 'true') {
    throw Error('WELCOME_SIGNED_SESSION_DISABLED');
  }
  // Never silently activate against an unexpected Firebase project.
  const expectedProjectId = process.env.KYRUB_PITANGA_WELCOME_PROJECT_ID?.trim();
  const actualProjectId = auth.app.options.projectId;
  if (!expectedProjectId || !actualProjectId || expectedProjectId !== actualProjectId) {
    throw Error('WELCOME_FIREBASE_PROJECT_MISMATCH');
  }
  const cutoff = process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT?.trim();
  if (!cutoff || !Number.isFinite(Date.parse(cutoff))) {
    throw Error('WELCOME_CAMPAIGN_NOT_ENABLED');
  }
  const user = await auth.getUser(uid);
  if (user.uid !== uid || user.disabled || !user.metadata.creationTime) {
    throw Error('WELCOME_AUTH_USER_INVALID');
  }
  // Welcome bonus is reserved for first registration through Google sign-in.
  // A Firebase session alone also exists for password, anonymous and other providers.
  if (!user.providerData.some(provider => provider.providerId === 'google.com')) {
    throw Error('WELCOME_GOOGLE_PROVIDER_REQUIRED');
  }
  // Auth getUser serializes creationTime to whole seconds; lifecycle events may
  // retain milliseconds. Preserve the trusted event precision without accepting
  // a different account creation instant. This argument has no HTTP caller.
  const lookupCreatedMs = Date.parse(user.metadata.creationTime);
  const eventCreatedMs = trustedRegistrationCreatedAt === undefined
    ? lookupCreatedMs : Date.parse(trustedRegistrationCreatedAt);
  if (!Number.isFinite(eventCreatedMs) ||
      Math.floor(eventCreatedMs / 1000) !== Math.floor(lookupCreatedMs / 1000)) {
    throw Error('WELCOME_AUTH_USER_INVALID');
  }
  const createdAt = new Date(eventCreatedMs).toISOString();
  if (trustedRegistrationCreatedAt === undefined) {
    verifyWelcomeInitialSession({
      uid, tokenUid, authTimeSeconds: signedAuthTimeSeconds,
      firebaseCreatedAt: createdAt, campaignEffectiveAt: cutoff,
    });
  } else if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid) || tokenUid !== uid ||
      !isWelcomeCampaignEligible(createdAt, cutoff)) {
    throw Error('WELCOME_INITIAL_SESSION_INELIGIBLE');
  }
  const expectedFenceEpoch = process.env.KYRUB_PITANGA_WELCOME_FENCE_EPOCH?.trim();
  if (!expectedFenceEpoch || !/^[A-Za-z0-9_-]{1,128}$/.test(expectedFenceEpoch)) {
    throw Error('WELCOME_FENCE_EPOCH_NOT_CONFIGURED');
  }
  const root = db.collection('users').doc(uid);
  return db.runTransaction(async tx => {
    // A feature flag alone must never authorize live welcome credits. The
    // migration fence is a necessary (not sufficient) release prerequisite.
    const fence = await tx.get(db.doc('systemControl/pitangaLegacyWriterFence'));
    const control = fence.data();
    if (!fence.exists || control?.status !== 'fenced' ||
        control?.writersVerified !== true ||
        control?.epoch !== expectedFenceEpoch) {
      throw Error('WELCOME_LEGACY_WRITERS_NOT_VERIFIED');
    }
    // A signed session proves authentication, not that this was the first login.
    // Require independently issued first-login evidence before any credit.
    await verifyFirstLoginReceiptInTransaction(tx, {
      userId: uid, firebaseCreatedAt: createdAt,
      receiptRef: root.collection('authEvents').doc('first_login_v1'),
    });
    return grantCleanBaselineWelcomeInTransaction(tx, {
      userId: uid, firebaseCreatedAt: createdAt,
      campaignEffectiveAt: cutoff, isolatedCleanBaseline: true,
      receiptRef: root.collection('authEvents').doc('first_login_v1'),
      balanceRef: root.collection('pitangaBalance').doc('balance'),
      ledgerCollection: root.collection('rewardLedger'),
      awardRef: root.collection('rewardLedger').doc('earn_first_login_welcome_v1'),
    });
  });
};

/** Existing signed-session boundary; still requires independent registration evidence. */
export const grantSignedSessionWelcomeForVerifiedUser = (
  db: Firestore, auth: WelcomeAuth, uid: string, tokenUid: string, signedAuthTimeSeconds: number,
): Promise<{ balance: number; replay: boolean }> =>
  grantWelcomeForUserWithTrustedReceipt(db, auth, uid, tokenUid, signedAuthTimeSeconds);

/**
 * Trusted Auth lifecycle consumer only. Registration evidence is independently
 * validated inside the credit transaction; no browser-supplied first-login claim
 * or fabricated signed auth_time is accepted. Delayed event retries remain safe.
 */
export const grantWelcomeFromTrustedRegistrationReceipt = (
  db: Firestore, auth: WelcomeAuth, uid: string, trustedRegistrationCreatedAt: string,
): Promise<{ balance: number; replay: boolean }> =>
  grantWelcomeForUserWithTrustedReceipt(db, auth, uid, uid, undefined, trustedRegistrationCreatedAt);
