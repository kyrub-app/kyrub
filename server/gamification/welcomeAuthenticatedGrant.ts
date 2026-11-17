import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { verifyWelcomeFirebaseSession } from './welcomeFirebaseSession.js';
import { grantSignedSessionWelcomeForVerifiedUser } from './signedSessionWelcomeService.js';

/**
 * Trusted server-only boundary. No public route is registered here.
 * The same signed Firebase token supplies both uid and auth_time.
 * The transactional service still requires an explicitly enabled campaign,
 * matching project, verified writer fence, and a clean balance baseline.
 */
export const grantWelcomeFromFirebaseIdToken = async (
  db: Firestore,
  auth: Auth,
  idToken: string,
): Promise<{ balance: number; replay: boolean }> => {
  if (process.env.KYRUB_PITANGA_SIGNED_SESSION_WELCOME_ENABLED !== 'true') {
    throw Error('WELCOME_SIGNED_SESSION_DISABLED');
  }
  const expectedProjectId = process.env.KYRUB_PITANGA_WELCOME_PROJECT_ID?.trim();
  const actualProjectId = auth.app.options.projectId;
  if (!expectedProjectId || !actualProjectId || expectedProjectId !== actualProjectId) {
    throw Error('WELCOME_FIREBASE_PROJECT_MISMATCH');
  }
  const { uid, authTimeSeconds } = await verifyWelcomeFirebaseSession(idToken, expectedProjectId);
  return grantSignedSessionWelcomeForVerifiedUser(db, auth, uid, uid, authTimeSeconds);
};
