import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';

/** Validates the provider claim only AFTER signature verification by the caller. */
export const assertGoogleSignInProviderClaim = (firebaseClaim: unknown): void => {
  if (!firebaseClaim || typeof firebaseClaim !== 'object' ||
      (firebaseClaim as Record<string, unknown>).sign_in_provider !== 'google.com') {
    throw Error('WELCOME_GOOGLE_SIGN_IN_REQUIRED');
  }
};

/**
 * A verified Firebase ID token is the sole source of auth_time.
 * Never accept a timestamp supplied separately by the browser.
 * The existing token verifier validates signature, issuer, audience and expiry.
 */
export const verifyWelcomeFirebaseSession = async (
  idToken: string,
  projectId?: string,
): Promise<{ uid: string; authTimeSeconds: number }> => {
  const verified = await verifyFirebaseIdToken(idToken, projectId);
  const payloadPart = idToken.split('.')[1];
  if (!payloadPart) throw Error('WELCOME_SIGNED_AUTH_TIME_INVALID');
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  } catch {
    throw Error('WELCOME_SIGNED_AUTH_TIME_INVALID');
  }
  if (!claims || typeof claims !== 'object') throw Error('WELCOME_SIGNED_AUTH_TIME_INVALID');
  const data = claims as Record<string, unknown>;
  // Linked Google providerData is insufficient: the current sign-in itself
  // must be Google, as attested by the cryptographically verified ID token.
  assertGoogleSignInProviderClaim(data.firebase);
  if (data.sub !== verified.uid ||
      !Number.isSafeInteger(data.auth_time) ||
      (data.auth_time as number) <= 0) {
    throw Error('WELCOME_SIGNED_AUTH_TIME_INVALID');
  }
  return { uid: verified.uid, authTimeSeconds: data.auth_time as number };
};
