import { adminDb } from '../firebaseAdmin.js';
import type { PrepaidRenewalPixAttempt } from './prepaidRenewalPixAttempt.js';

/**
 * Internal-only persistence primitive for a payment ID obtained from a trusted
 * Mercado Pago creation response. NOT a public route or a payment executor.
 * Do not expose to callers that can supply an arbitrary payment ID.
 */
export const bindCreatedPrepaidRenewalPixPaymentId = async (input: {
  storeId: string;
  proposalId: string;
  paymentId: string;
  expectedRequestDigest: string;
  sellerAuthority: { credentialScopeId: string; externalAccountId: string };
}): Promise<'bound' | 'already_bound'> => {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.storeId) ||
      !/^[a-f0-9]{64}$/.test(input.proposalId) ||
      !/^\d{1,32}$/.test(input.paymentId) ||
      !/^[a-f0-9]{64}$/.test(input.expectedRequestDigest)) {
    throw new Error('RENEWAL_PIX_PAYMENT_BINDING_INVALID');
  }
  const authority = input.sellerAuthority;
  if (!authority || authority.credentialScopeId !== input.storeId ||
      !/^\d+$/.test(authority.externalAccountId)) {
    throw new Error('RENEWAL_PIX_PAYMENT_BINDING_SELLER_CHANGED');
  }
  const ref = adminDb.doc(
    `stores/${input.storeId}/prepaidRenewalPixAttempts/${input.proposalId}`
  );
  return adminDb.runTransaction(async tx => {
    const storeRef = adminDb.doc(`stores/${input.storeId}`);
    const primaryRef = adminDb.doc(`users/${input.storeId}/stores/${input.storeId}`);
    const connectionRef = adminDb.doc(
      `stores/${input.storeId}/paymentProviderConnections/mercado_pago`
    );
    const [storeSnapshot, primarySnapshot, connectionSnapshot] = await Promise.all([
      tx.get(storeRef), tx.get(primaryRef), tx.get(connectionRef),
    ]);
    const store = storeSnapshot.data();
    const primary = primarySnapshot.data();
    const identityMatches = store
      ? store.ownerId === input.storeId &&
        (store.legacyTenantId || store.ownerId) === input.storeId
      : primary?.id === input.storeId &&
        primary?.ownerId === input.storeId &&
        (!primary.legacyTenantId || primary.legacyTenantId === input.storeId);
    const connection = connectionSnapshot.data();
    if (!identityMatches || connection?.provider !== 'mercado_pago' ||
        connection.storeId !== input.storeId ||
        connection.status !== 'connected' ||
        connection.externalAccountId !== authority.externalAccountId) {
      throw new Error('RENEWAL_PIX_PAYMENT_BINDING_SELLER_CHANGED');
    }
    const snapshot = await tx.get(ref);
    const attempt = snapshot.data() as (PrepaidRenewalPixAttempt & {
      providerPaymentId?: string;
    }) | undefined;
    if (!snapshot.exists || !attempt ||
        attempt.storeId !== input.storeId ||
        attempt.proposalId !== input.proposalId ||
        attempt.status !== 'reserved' ||
        !['in_flight', 'outcome_unknown'].includes(attempt.executionState ?? '') ||
        attempt.idempotencyKey !== `prepaid-renewal-${input.proposalId}` ||
        attempt.requestDigest !== input.expectedRequestDigest) {
      throw new Error('RENEWAL_PIX_PAYMENT_BINDING_CONFLICT');
    }
    if (attempt.providerPaymentId !== undefined) {
      if (attempt.providerPaymentId !== input.paymentId) {
        throw new Error('RENEWAL_PIX_PAYMENT_BINDING_CONFLICT');
      }
      return 'already_bound';
    }
    tx.update(ref, { providerPaymentId: input.paymentId });
    return 'bound';
  });
};
