/**
 * Server-verifiable first-session eligibility evidence.
 *
 * A Firebase ID token's auth_time is signed by Firebase Auth; it is not a
 * client-supplied timestamp. A newly created account with an authentication
 * event close to creation may qualify for the welcome campaign. This does NOT
 * establish that no earlier login occurred: one-time issuance is guaranteed
 * by the Firestore ledger's fixed idempotency key, not by this predicate.
 */
export const verifyWelcomeInitialSession = (input: {
  uid: string;
  tokenUid: string;
  authTimeSeconds: number;
  firebaseCreatedAt: string;
  campaignEffectiveAt: string;
}): { occurredAt: string } => {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.uid) ||
      input.tokenUid !== input.uid ||
      !Number.isSafeInteger(input.authTimeSeconds) ||
      input.authTimeSeconds <= 0) {
    throw Error('WELCOME_INITIAL_SESSION_UNVERIFIED');
  }
  const created = Date.parse(input.firebaseCreatedAt);
  const effective = Date.parse(input.campaignEffectiveAt);
  const authenticated = input.authTimeSeconds * 1000;
  if (!Number.isFinite(created) || !Number.isFinite(effective) ||
      created < effective || authenticated < created - 60_000 ||
      authenticated > created + 24 * 60 * 60 * 1000 ||
      authenticated < effective - 60_000) {
    throw Error('WELCOME_INITIAL_SESSION_INELIGIBLE');
  }
  return { occurredAt: new Date(authenticated).toISOString() };
};
