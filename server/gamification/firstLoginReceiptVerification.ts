import type { DocumentReference, Transaction } from 'firebase-admin/firestore';

/**
 * Immutable server-side first-login evidence contract.
 *
 * IMPORTANT: This module only validates an existing trusted receipt.
 * The receipt MUST be written by an independently verified server-side
 * authentication event. Firebase Auth lastSignInTime and client timestamps
 * are not valid substitutes. No route currently issues this receipt.
 */
export const verifyFirstLoginReceiptInTransaction = async (
  tx: Transaction,
  input: {
    userId: string;
    firebaseCreatedAt: string;
    receiptRef: DocumentReference;
  },
): Promise<{ occurredAt: string }> => {
  const uid = input.userId;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid) ||
      input.receiptRef.path !== `users/${uid}/authEvents/first_login_v1`) {
    throw Error('WELCOME_FIRST_LOGIN_RECEIPT_REFERENCE_INVALID');
  }
  const created = Date.parse(input.firebaseCreatedAt);
  if (!Number.isFinite(created)) throw Error('WELCOME_FIRST_LOGIN_CREATED_AT_INVALID');
  const snapshot = await tx.get(input.receiptRef);
  if (!snapshot.exists) throw Error('WELCOME_FIRST_LOGIN_RECEIPT_MISSING');
  const receipt = snapshot.data();
  const occurredAt = receipt?.occurredAt;
  const first = typeof occurredAt === 'string' ? Date.parse(occurredAt) : NaN;
  if (receipt?.userId !== uid ||
      receipt?.eventType !== 'first_login' ||
      receipt?.schemaVersion !== 1 ||
      receipt?.issuer !== 'trusted_auth_server' ||
      typeof receipt?.sourceEventId !== 'string' ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(receipt.sourceEventId) ||
      receipt?.firebaseCreatedAt !== new Date(created).toISOString() ||
      !Number.isFinite(first) || first < created ||
      first - created > 24 * 60 * 60 * 1000) {
    throw Error('WELCOME_FIRST_LOGIN_RECEIPT_INVALID');
  }
  return { occurredAt: new Date(first).toISOString() };
};
