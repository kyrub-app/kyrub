import { createHash } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import {
  resolveRenewalPaymentReplay,
  type snapshotAcceptedPrepaidRenewal,
} from '../../shared/subscriptionContractRenewal.js';

type RenewalSnapshot = ReturnType<typeof snapshotAcceptedPrepaidRenewal>;
const safeId = (value: string): boolean =>
  typeof value === 'string' && value.length > 0 && value.length <= 180 && !value.includes('/');
const paymentKey = (value: string): string =>
  createHash('sha256').update('mercado_pago:' + value).digest('hex');

/**
 * Internal persistence boundary. Caller MUST authenticate buyer, verify payment
 * directly with the provider and validate proposal acceptance before calling.
 * No public API or checkout route invokes this helper yet.
 */
export const persistVerifiedPrepaidRenewal = async (renewal: RenewalSnapshot):
  Promise<'created' | 'already_recorded'> => {
  if (![renewal.storeId, renewal.contractId, renewal.previousContractId,
    renewal.customerId, renewal.productId, renewal.providerPaymentId].every(safeId) ||
    !Number.isSafeInteger(renewal.totalPaidMinor) || renewal.totalPaidMinor <= 0 ||
    ![3, 6, 12].includes(renewal.months)) {
    throw new Error('INVALID_RENEWAL_PERSISTENCE_INPUT');
  }
  if (renewal.contractId === renewal.previousContractId ||
      !Number.isSafeInteger(renewal.monthlyBasePriceMinor) ||
      renewal.monthlyBasePriceMinor <= 0 ||
      !Number.isFinite(Date.parse(renewal.acceptedAt)) ||
      !Number.isFinite(Date.parse(renewal.startsAt)) ||
      !Number.isFinite(Date.parse(renewal.expiresAt)) ||
      Date.parse(renewal.expiresAt) <= Date.parse(renewal.startsAt)) {
    throw new Error('INVALID_RENEWAL_PERSISTENCE_INPUT');
  }
  const contractRef = adminDb.doc(`stores/${renewal.storeId}/prepaidSubscriptionContracts/${renewal.contractId}`);
  const paymentRef = adminDb.doc(`prepaidRenewalPaymentBindings/${paymentKey(renewal.providerPaymentId)}`);
  return adminDb.runTransaction(async tx => {
    const [contractDoc, paymentDoc] = await Promise.all([
      tx.get(contractRef), tx.get(paymentRef),
    ]);
    const boundPath = paymentDoc.exists ? paymentDoc.get('contractPath') : null;
    if (paymentDoc.exists && (typeof boundPath !== 'string' ||
        !/^stores\/[^/]+\/prepaidSubscriptionContracts\/[^/]+$/.test(boundPath))) {
      throw new Error('RENEWAL_PAYMENT_BINDING_CORRUPT');
    }
    const boundContract = typeof boundPath === 'string' ? adminDb.doc(boundPath) : null;
    const existingPaymentContract = boundContract ? await tx.get(boundContract) : null;
    if (paymentDoc.exists && !existingPaymentContract?.exists) {
      throw new Error('RENEWAL_PAYMENT_BINDING_CORRUPT');
    }
    if (existingPaymentContract && paymentDoc.get('storeId') !== renewal.storeId) {
      throw new Error('RENEWAL_PAYMENT_ALREADY_USED');
    }
    const verdict = resolveRenewalPaymentReplay(
      renewal,
      existingPaymentContract?.data() as RenewalSnapshot | undefined ?? null,
      contractDoc.data() as RenewalSnapshot | undefined ?? null
    );
    if (verdict === 'already_recorded') return verdict;
    tx.create(contractRef, renewal);
    tx.create(paymentRef, {
      contractPath: contractRef.path,
      storeId: renewal.storeId,
      contractId: renewal.contractId,
      provider: 'mercado_pago',
      providerPaymentId: renewal.providerPaymentId,
    });
    return 'created';
  });
};
