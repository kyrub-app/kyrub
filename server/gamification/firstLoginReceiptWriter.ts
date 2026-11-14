import type { DocumentReference, Transaction } from 'firebase-admin/firestore';

/**
 * Isolated immutable first-login receipt writer. NOT wired to a public API.
 * The caller must be an independently authenticated server-side login-event
 * source; an ID token alone cannot prove this was the first sign-in.
 */
export const recordVerifiedFirstLoginInTransaction = async (
  tx: Transaction,
  input: {
    userId: string;
    firebaseCreatedAt: string;
    occurredAt: string;
    trustedFirstLoginEvent: boolean;
    /** Must be supplied only by a server-side verified identity lifecycle handler. */
    sourceEventId: string;
    receiptRef: DocumentReference;
  },
): Promise<{ recorded: boolean }> => {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.userId) ||
      input.receiptRef.path !== `users/${input.userId}/authEvents/first_login_v1` ||
      input.trustedFirstLoginEvent !== true ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(input.sourceEventId)) {
    throw Error('WELCOME_FIRST_LOGIN_ISSUER_UNVERIFIED');
  }
  const created = Date.parse(input.firebaseCreatedAt);
  const occurred = Date.parse(input.occurredAt);
  if (!Number.isFinite(created) || !Number.isFinite(occurred) ||
      occurred < created || occurred - created > 24 * 60 * 60 * 1000) {
    throw Error('WELCOME_FIRST_LOGIN_EVENT_INVALID');
  }
  const canonical = {
    userId: input.userId,
    eventType: 'first_login',
    schemaVersion: 1,
    issuer: 'trusted_auth_server',
    sourceEventId: input.sourceEventId,
    firebaseCreatedAt: new Date(created).toISOString(),
    occurredAt: new Date(occurred).toISOString(),
  };
  const existing = await tx.get(input.receiptRef);
  if (existing.exists) {
    const data = existing.data();
    if (Object.entries(canonical).some(([key, value]) => data?.[key] !== value)) {
      throw Error('WELCOME_FIRST_LOGIN_RECEIPT_CONFLICT');
    }
    return { recorded: false };
  }
  tx.create(input.receiptRef, canonical);
  return { recorded: true };
};
