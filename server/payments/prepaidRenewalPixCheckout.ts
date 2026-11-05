import { createHash } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import { authenticateConsultantRequest } from '../ai/consultantAuth.js';
import { getValidMercadoPagoStoreAccessToken, mercadoPagoStoreRequest } from '../integrations/mercadoPagoStoreOauthService.js';
import { prepareAuthenticatedPrepaidRenewalPixWithRecipient } from './prepaidRenewalCheckoutPreparation.js';
import { loadAcceptedPrepaidRenewal, recordPrepaidRenewalWithVerifiedSources } from './prepaidRenewalActivation.js';
import { executeAuthenticatedLockedIsolatedPrepaidRenewalPix } from './prepaidRenewalPixLockedExecution.js';
import { reconcileUnknownSellerPrepaidRenewalPixPayment } from './prepaidRenewalPixSellerReconciliation.js';
import { validatePrepaidRenewalPixCreationResponse } from './prepaidRenewalPixCreationResponse.js';
import { verifyPrepaidRenewalMercadoPagoPayment } from './prepaidRenewalPaymentVerification.js';

type Locator = { authorization: string | null | undefined; storeId: string; proposalId: string };
export type PrepaidRenewalPixCheckoutResult = {
  state: 'awaiting_payment' | 'payment_confirmed' | 'activated' | 'recovery_required';
  paymentId?: string;
  pix?: { qrCode: string; qrCodeBase64?: string; expiresAt: string };
  contract?: { contractId: string; startsAt: string; expiresAt: string };
  code?: string;
};

const validateLocator = (input: Locator): void => {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.storeId) || !/^[a-f0-9]{64}$/.test(input.proposalId)) {
    throw new Error('INVALID_RENEWAL_CHECKOUT_REQUEST');
  }
};
const isRecoverable = (error: unknown): boolean => error instanceof Error &&
  (error.message.startsWith('RENEWAL_PIX_') || error.message.startsWith('RENEWAL_PREDECESSOR_'));
const recovery = (error: unknown, paymentId?: string): PrepaidRenewalPixCheckoutResult => ({
  state: 'recovery_required', ...(paymentId ? { paymentId } : {}),
  code: error instanceof Error && /^RENEWAL_[A-Z_]+$/.test(error.message)
    ? error.message : 'RENEWAL_PIX_PROVIDER_LOOKUP_UNAVAILABLE',
});

/** One reviewed gate; it stays disabled until an operator explicitly authorizes checkout rollout. */
export const assertPrepaidRenewalPixCheckoutEnabled = (): void => {
  if (process.env.KYRUB_PREPAID_RENEWAL_PIX_CHECKOUT_ENABLED !== 'true') {
    throw new Error('RENEWAL_PIX_CHECKOUT_DISABLED');
  }
};

/**
 * Buyer-facing payment creation composes the existing reservation, execution
 * claim and seller-scoped transport. All commercial terms come from Firestore.
 * Repeated/ambiguous attempts are recovered through GET only, never a new POST.
 */
export const checkoutAuthenticatedPrepaidRenewalPix = async (input: Locator): Promise<PrepaidRenewalPixCheckoutResult> => {
  validateLocator(input);
  assertPrepaidRenewalPixCheckoutEnabled();
  const attempt = await adminDb.doc(`stores/${input.storeId}/prepaidRenewalPixAttempts/${input.proposalId}`).get();
  if (attempt.exists && (attempt.get('providerPaymentId') || attempt.get('executionState') !== 'idle')) {
    return reconcileAuthenticatedPrepaidRenewalPix(input);
  }
  const { recipient } = await prepareAuthenticatedPrepaidRenewalPixWithRecipient(input);
  const oauth = await getValidMercadoPagoStoreAccessToken(recipient.credentialScopeId);
  try {
    await executeAuthenticatedLockedIsolatedPrepaidRenewalPix({
      ...input,
      trustedCredentialScopeId: recipient.credentialScopeId,
      oauthCredentialScopeId: recipient.credentialScopeId,
      trustedExternalAccountId: recipient.externalAccountId,
      oauthExternalAccountId: oauth.externalAccountId,
      sellerScopedRequest: (scope, path, init) => {
        if (init.method === 'POST') assertPrepaidRenewalPixCheckoutEnabled();
        return mercadoPagoStoreRequest(scope, path, init);
      },
    });
  } catch (error) {
    // The locked executor retains unknown/in-flight claims after all ambiguous
    // POST failures. Do not retry creation here or expose provider error text.
    if (isRecoverable(error) || !(error instanceof Error) ||
        !error.message.startsWith('RENEWAL_')) return recovery(error);
    throw error;
  }
  return reconcileAuthenticatedPrepaidRenewalPix(input);
};

/**
 * Authenticated GET-only recovery and reconciliation. The browser supplies no
 * payment ID, price, recipient, reference or successful-payment assertion.
 * Provider GETs may refresh the existing OAuth token, but never create payment.
 */
export const reconcileAuthenticatedPrepaidRenewalPix = async (input: Locator): Promise<PrepaidRenewalPixCheckoutResult> => {
  validateLocator(input);
  const buyer = await authenticateConsultantRequest(input.authorization);
  const stored = await loadAcceptedPrepaidRenewal({ ...input, authenticatedBuyerId: buyer.uid });
  const contractIdFor = (paymentId: string) => 'renewal-' + createHash('sha256').update(
    JSON.stringify([input.storeId, input.proposalId, paymentId]),
  ).digest('hex');
  const activatedContract = async (paymentId: string) => {
    const contractId = contractIdFor(paymentId);
    const doc = await adminDb.doc(`stores/${input.storeId}/prepaidSubscriptionContracts/${contractId}`).get();
    const data = doc.data();
    const paymentBinding = await adminDb.doc(`prepaidRenewalPaymentBindings/${createHash('sha256').update('mercado_pago:' + paymentId).digest('hex')}`).get();
    const predecessor = await adminDb.doc(`stores/${input.storeId}/prepaidRenewalSuccessors/${stored.proposal.previousContractId}`).get();
    if (!data || data.contractId !== contractId || data.storeId !== input.storeId ||
        data.customerId !== buyer.uid || data.previousContractId !== stored.proposal.previousContractId ||
        data.providerPaymentId !== paymentId || data.totalPaidMinor !== stored.proposal.totalDueMinor ||
        data.productId !== stored.proposal.productId || data.months !== stored.proposal.months ||
        data.monthlyBasePriceMinor !== stored.proposal.currentMonthlyPriceMinor ||
        data.discountPercent !== stored.proposal.discountPercent || data.acceptedAt !== stored.acceptance.acceptedAt ||
        typeof data.startsAt !== 'string' || typeof data.expiresAt !== 'string' ||
        !Number.isFinite(Date.parse(data.startsAt)) || !Number.isFinite(Date.parse(data.expiresAt)) ||
        Date.parse(data.expiresAt) <= Date.parse(data.startsAt) ||
        paymentBinding.get('contractPath') !== doc.ref.path ||
        paymentBinding.get('storeId') !== input.storeId || paymentBinding.get('providerPaymentId') !== paymentId ||
        paymentBinding.get('provider') !== 'mercado_pago' || paymentBinding.get('contractId') !== contractId ||
        predecessor.get('contractId') !== contractId || predecessor.get('providerPaymentId') !== paymentId) return null;
    return { contractId, startsAt: data.startsAt, expiresAt: data.expiresAt };
  };
  const attemptRef = adminDb.doc(`stores/${input.storeId}/prepaidRenewalPixAttempts/${input.proposalId}`);
  let attempt = await attemptRef.get();
  if (!attempt.exists) return recovery(new Error('RENEWAL_PIX_ATTEMPT_NOT_STARTED'));
  let paymentId: unknown = attempt.get('providerPaymentId');
  if (typeof paymentId === 'string' && /^\d{1,32}$/.test(paymentId)) {
    const contract = await activatedContract(paymentId);
    if (contract) return { state: 'activated', paymentId, contract };
  }
  const { request, recipient } = await prepareAuthenticatedPrepaidRenewalPixWithRecipient({ ...input, readOnlyRecovery: true });
  const oauth = await getValidMercadoPagoStoreAccessToken(recipient.credentialScopeId);
  if (oauth.externalAccountId !== recipient.externalAccountId) throw new Error('RENEWAL_RECIPIENT_AUTHORITY_MISMATCH');
  const assertCurrentRecipient = async (): Promise<void> => {
    // Provider GETs and activation can outlive an owner/account change. Reuse
    // authenticated preparation instead of returning instructions for a stale seller.
    const current = await prepareAuthenticatedPrepaidRenewalPixWithRecipient({ ...input, readOnlyRecovery: true });
    if (current.recipient.credentialScopeId !== recipient.credentialScopeId ||
        current.recipient.externalAccountId !== recipient.externalAccountId ||
        current.request.init.body !== request.init.body) {
      throw new Error('RENEWAL_RECIPIENT_AUTHORITY_MISMATCH');
    }
    const currentOauth = await getValidMercadoPagoStoreAccessToken(current.recipient.credentialScopeId);
    if (currentOauth.externalAccountId !== current.recipient.externalAccountId) {
      throw new Error('RENEWAL_RECIPIENT_AUTHORITY_MISMATCH');
    }
  };
  if (paymentId === undefined) {
    if (!['in_flight', 'outcome_unknown'].includes(String(attempt.get('executionState')))) {
      return recovery(new Error('RENEWAL_PIX_ATTEMPT_NOT_STARTED'));
    }
    try {
      await reconcileUnknownSellerPrepaidRenewalPixPayment({
        ...input, request,
        trustedCredentialScopeId: recipient.credentialScopeId, oauthCredentialScopeId: recipient.credentialScopeId,
        trustedExternalAccountId: recipient.externalAccountId, oauthExternalAccountId: oauth.externalAccountId,
        sellerScopedRequest: mercadoPagoStoreRequest,
      });
      attempt = await attemptRef.get();
      paymentId = attempt.get('providerPaymentId');
    } catch (error) {
      if (isRecoverable(error) || !(error instanceof Error) || !error.message.startsWith('RENEWAL_')) return recovery(error);
      throw error;
    }
  }
  if (typeof paymentId !== 'string' || !/^\d{1,32}$/.test(paymentId)) throw new Error('RENEWAL_PIX_RECOVERY_CONFLICT');
  let payment: Record<string, unknown>;
  try {
    const raw = await mercadoPagoStoreRequest<unknown>(recipient.credentialScopeId, `/v1/payments/${paymentId}`, { method: 'GET' });
    const verifiedId = validatePrepaidRenewalPixCreationResponse({ request, response: raw,
      expectedStoreId: input.storeId, expectedProposalId: input.proposalId, expectedCollectorId: recipient.externalAccountId });
    if (verifiedId !== paymentId) throw new Error('RENEWAL_PIX_RECOVERY_CONFLICT');
    payment = raw as Record<string, unknown>;
    await assertCurrentRecipient();
  } catch (error) { return recovery(error, paymentId); }
  if (payment.status === 'approved') {
    // Confirm accreditation with the canonical verifier before claiming that a
    // payment is confirmed, even if activation subsequently needs recovery.
    await verifyPrepaidRenewalMercadoPagoPayment({ sellerCredentialScopeId: recipient.credentialScopeId,
      paymentId, expectedExternalReference: `kyrub:prepaid-renewal:${input.storeId}:${input.proposalId}`,
      expectedAmountMinor: stored.proposal.totalDueMinor });
    try { await assertCurrentRecipient(); }
    catch (error) { return recovery(error, paymentId); }
    try {
      await recordPrepaidRenewalWithVerifiedSources({ ...input, paymentId });
      const contract = await activatedContract(paymentId);
      if (!contract) throw new Error('RENEWAL_PIX_ACTIVATION_NOT_OBSERVED');
      return { state: 'activated', paymentId, contract };
    } catch {
      try { await assertCurrentRecipient(); }
      catch (error) { return recovery(error, paymentId); }
      return { state: 'payment_confirmed', paymentId, code: 'RENEWAL_PIX_ACTIVATION_RECOVERY_REQUIRED' };
    }
  }
  const payload = JSON.parse(request.init.body) as { date_of_expiration: string };
  const expiresAt = payload.date_of_expiration;
  if (Date.parse(expiresAt) <= Date.now()) return recovery(new Error('RENEWAL_PIX_PAYMENT_EXPIRED'), paymentId);
  const interaction = payment.point_of_interaction as { transaction_data?: { qr_code?: unknown; qr_code_base64?: unknown } } | undefined;
  const data = interaction?.transaction_data;
  if (typeof data?.qr_code !== 'string' || !data.qr_code.trim() || data.qr_code.length > 10_000) {
    return recovery(new Error('RENEWAL_PIX_INSTRUCTIONS_UNAVAILABLE'), paymentId);
  }
  const qrCodeBase64 = typeof data.qr_code_base64 === 'string' && data.qr_code_base64.length <= 500_000 &&
    /^[A-Za-z0-9+/=\r\n]+$/.test(data.qr_code_base64) ? data.qr_code_base64 : undefined;
  return { state: 'awaiting_payment', paymentId,
    pix: { qrCode: data.qr_code, ...(qrCodeBase64 ? { qrCodeBase64 } : {}), expiresAt } };
};
