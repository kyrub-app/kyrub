import type { Firestore } from 'firebase-admin/firestore';
import { isWelcomeCampaignEligible } from './firstLoginWelcome.js';
import { recordWelcomeRegistrationFromTrustedAuthTrigger } from './welcomeTrustedAuthRegistration.js';
import { grantWelcomeFromTrustedRegistrationReceipt, type WelcomeAuth } from './signedSessionWelcomeService.js';

type RegistrationUser = {
  uid: string; disabled: boolean;
  providerData: ReadonlyArray<{ providerId: string }>;
  metadata: { creationTime: string };
};

/** Called only by the registered Firebase Auth onCreate event, never HTTP. */
export async function handleWelcomeAuthCreated(
  db: Firestore, auth: WelcomeAuth, user: RegistrationUser,
  context: { eventId: string; projectId: string },
): Promise<{ skipped: true } | { balance: number; replay: boolean }> {
  // Preserve the existing Google-registration eligibility and OFF-by-default gate.
  if (process.env.KYRUB_PITANGA_SIGNED_SESSION_WELCOME_ENABLED !== 'true') return { skipped: true };
  if (!user.providerData.some(provider => provider.providerId === 'google.com') ||
      user.disabled || !isWelcomeCampaignEligible(
        user.metadata.creationTime, process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT,
      )) return { skipped: true };
  if (auth.app.options.projectId !== context.projectId) throw Error('WELCOME_AUTH_TRIGGER_PROJECT_MISMATCH');
  await recordWelcomeRegistrationFromTrustedAuthTrigger(db, user, context);
  // Receipt is durable before credit. A transient failure retries this same event;
  // both existing writers are idempotent and never overwrite an existing balance.
  try {
    return await grantWelcomeFromTrustedRegistrationReceipt(db, auth, user.uid, user.metadata.creationTime);
  } catch (error) {
    // An existing balance/history is a permanent eligibility rejection, not an
    // infrastructure failure. All other failures propagate for event retry.
    if (error instanceof Error && error.message === 'WELCOME_CLEAN_BASELINE_NOT_EMPTY') return { skipped: true };
    throw error;
  }
}
