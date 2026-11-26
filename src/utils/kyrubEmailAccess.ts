import {
  createUserWithEmailAndPassword, isSignInWithEmailLink, sendEmailVerification,
  sendPasswordResetEmail, sendSignInLinkToEmail, signInWithEmailAndPassword,
  signInWithEmailLink, type Auth, type User,
} from 'firebase/auth';

/**
 * Candidate onboarding adapters. Do not mount before the age/identity gates
 * are enforced across server, Firestore and Storage. No implicit account merge.
 */
const emailAddress = (value: string): string => {
  const email = value.trim();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)) {
    throw Error('EMAIL_INVALID');
  }
  return email;
};

const requireSignedOut = (auth: Auth): void => {
  if (auth.currentUser) throw Error('EXISTING_SESSION');
};

export async function enterWithPassword(auth: Auth, email: string, password: string): Promise<User> {
  requireSignedOut(auth);
  return (await signInWithEmailAndPassword(auth, emailAddress(email), password)).user;
}

export async function registerWithPassword(auth: Auth, email: string, password: string): Promise<User> {
  requireSignedOut(auth);
  // Firebase enforces the configured password policy. Account is not eligible
  // merely because an Auth credential was created.
  return (await createUserWithEmailAndPassword(auth, emailAddress(email), password)).user;
}

export async function requestOwnEmailConfirmation(auth: Auth, user: User): Promise<void> {
  if (auth.currentUser?.uid !== user.uid) throw Error('AUTH_SESSION_CHANGED');
  if (!user.emailVerified) await sendEmailVerification(user);
}

export async function requestPasswordRecovery(auth: Auth, email: string): Promise<void> {
  requireSignedOut(auth);
  // Caller must display a generic result; do not reveal account existence.
  await sendPasswordResetEmail(auth, emailAddress(email));
}

export async function requestKyrubEmailLink(auth: Auth, email: string): Promise<void> {
  requireSignedOut(auth);
  // Fixed same-origin continuation; no email, redirect, token or tag secret in URL.
  await sendSignInLinkToEmail(auth, emailAddress(email), {
    url: window.location.origin + '/?entry=email-access',
    handleCodeInApp: true,
  });
}

export async function completeKyrubEmailLink(auth: Auth, email: string): Promise<User> {
  requireSignedOut(auth);
  const link = window.location.href;
  const current = new URL(link);
  if (current.pathname !== '/' || current.searchParams.get('entry') !== 'email-access' ||
      !isSignInWithEmailLink(auth, link)) throw Error('EMAIL_LINK_INVALID');
  // Always ask for the receiving address; do not trust a URL-provided email.
  const credential = await signInWithEmailLink(auth, emailAddress(email), link);
  window.history.replaceState({}, '', '/');
  return credential.user;
}
