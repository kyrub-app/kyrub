import { createHash } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import type { buildPrepaidRenewalPixRequest } from './prepaidRenewalPixRequest.js';
import { validatePrepaidRenewalPixCreationResponse } from './prepaidRenewalPixCreationResponse.js';
import type { PrepaidRenewalPixAttempt } from './prepaidRenewalPixAttempt.js';

/**
 * Internal-only, GET/search-result reconciliation. The caller MUST obtain the
 * response from a trusted seller-scoped Mercado Pago lookup (never from the
 * buyer). This function never sends a payment POST or clears the execution
 * claim. An absent/ambiguous provider result must remain unresolved.
 */
export const reconcileUnknownPrepaidRenewalPixPayment = async (input: {
  storeId: string;
  proposalId: string;
  request: ReturnType<typeof buildPrepaidRenewalPixRequest>;
  expectedCollectorId: string;
  trustedProviderPayment: unknown;
  sellerAuthority?: { credentialScopeId: string; externalAccountId: string };
}): Promise<'bound' | 'already_bound'> => {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.storeId) ||
      !/^[a-f0-9]{64}$/.test(input.proposalId)) {
    throw new Error('RENEWAL_PIX_RECONCILIATION_CONFLICT');
  }
  const paymentId = validatePrepaidRenewalPixCreationResponse({
    request: input.request,
    response: input.trustedProviderPayment,
    expectedStoreId: input.storeId,
    expectedProposalId: input.proposalId,
    expectedCollectorId: input.expectedCollectorId,
  });
  const digest = createHash('sha256').update(input.request.init.body).digest('hex');
  const ref = adminDb.doc(`stores/${input.storeId}/prepaidRenewalPixAttempts/${input.proposalId}`);
  return adminDb.runTransaction(async tx => {
    // Read the merchant binding in the same transaction as the payment-ID write.
    // This closes the gap between the final external authority check and persistence.
    if (input.sellerAuthority) {
      const { credentialScopeId, externalAccountId } = input.sellerAuthority;
      if (!credentialScopeId || !/^\\d+$/.test(externalAccountId)) {
        throw new Error('RENEWAL_PIX_RECONCILIATION_SELLER_CHANGED');
      }
      const storeRef = adminDb.doc(`stores/${input.storeId}`);
      const connectionRef = adminDb.doc(
        `stores/${credentialScopeId}/paymentProviderConnections/mercado_pago`
      );
      const [storeSnapshot, connectionSnapshot] = await Promise.all([
        tx.get(storeRef), tx.get(connectionRef),
      ]);
      const store = storeSnapshot.data();
      const connection = connectionSnapshot.data();
      if (!store || store.ownerId !== credentialScopeId ||
          (store.legacyTenantId || store.ownerId) !== credentialScopeId ||
          !connection || connection.provider !== 'mercado_pago' ||
          connection.storeId !== credentialScopeId ||
          connection.status !== 'connected' ||
          connection.externalAccountId !== externalAccountId) {
        throw new Error('RENEWAL_PIX_RECONCILIATION_SELLER_CHANGED');
      }
    }
    const snapshot = await tx.get(ref);
    const attempt = snapshot.data() as (PrepaidRenewalPixAttempt & { executionState?: string }) | undefined;
    if (!attempt || attempt.storeId !== input.storeId ||
        attempt.proposalId !== input.proposalId ||
        attempt.status !== 'reserved' ||
        attempt.requestDigest !== digest ||
        attempt.idempotencyKey !== `prepaid-renewal-${input.proposalId}` ||
        !['in_flight', 'outcome_unknown'].includes(attempt.executionState ?? '')) {
      throw new Error('RENEWAL_PIX_RECONCILIATION_CONFLICT');
    }
    if (attempt.providerPaymentId !== undefined) {
      if (attempt.providerPaymentId !== paymentId) {
        throw new Error('RENEWAL_PIX_RECONCILIATION_CONFLICT');
      }
      return 'already_bound';
    }
    tx.update(ref, { providerPaymentId: paymentId, executionState: 'outcome_unknown' });
    return 'bound';
  });
};
