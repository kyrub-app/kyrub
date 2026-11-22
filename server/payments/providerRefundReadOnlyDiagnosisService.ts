import { adminDb } from '../firebaseAdmin.js';
import { mercadoPagoStoreRequest } from '../integrations/mercadoPagoStoreOauthService.js';
import { resolveMercadoPagoAccessToken } from '../integrations/providerCredentialResolver.js';
import { loadMercadoPagoPaymentProviderBinding } from './paymentProviderBindingService.js';
import { normalizeCanonicalPayment, type CanonicalPayment } from '../../src/utils/canonicalPayment.js';
import { amountToMinor, parseProviderRefundListing, type ProviderRefundSummary } from '../../shared/mercadoPagoRefundReadOnly.js';

const validId = (input: unknown): input is string =>
  typeof input === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(input);
const identifier = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

export interface ProviderRefundReadOnlyDiagnosis {
  source: 'mercado_pago_read_only';
  paymentStatus: string;
  paymentAmountMinor: number;
  storedPaymentAmountMinor: number;
  amountMatches: boolean;
  refundedAmountReportedMinor: number | null;
  refunds: ProviderRefundSummary;
  partialAttempt: { count: number; statusCounts: Record<string, number> };
  blockers: string[];
  notice: string;
}

const verifiedPayment = async (storeId: string, orderId: string): Promise<CanonicalPayment> => {
  const [tenant, snapshot] = await Promise.all([
    adminDb.doc('tenants/' + storeId).get(),
    adminDb.collection('stores/' + storeId + '/payments')
      .where('orderId', '==', orderId).limit(2).get(),
  ]);
  const canonical = tenant.get('canonicalStoreId');
  const roots = validId(canonical) && canonical !== storeId ? [storeId, canonical] : [storeId];
  const all = [snapshot, ...(roots.length === 2 ? [
    await adminDb.collection('stores/' + roots[1] + '/payments')
      .where('orderId', '==', orderId).limit(2).get(),
  ] : [])];
  if (all.reduce((sum, item) => sum + item.size, 0) !== 1) {
    throw new Error('PROVIDER_REFUND_READ_PAYMENT_AMBIGUOUS');
  }
  const index = all.findIndex(x => !x.empty);
  const document = all[index].docs[0];
  let payment: CanonicalPayment;
  try {
    payment = normalizeCanonicalPayment({
      ...(document.data() as CanonicalPayment), id: document.id, storeId: roots[index],
    });
  } catch {
    throw new Error('PROVIDER_REFUND_READ_PAYMENT_INVALID');
  }
  if (payment.provider !== 'mercado-pago' || !payment.providerPaymentId ||
      !['paid', 'refunded', 'refund_processing', 'refund_requested', 'refund_failed'].includes(payment.status)) {
    throw new Error('PROVIDER_REFUND_READ_PAYMENT_INVALID');
  }
  return payment;
};

const providerGet = async <T>(payment: CanonicalPayment, url: string): Promise<T> => {
  const binding = await loadMercadoPagoPaymentProviderBinding(payment.providerPaymentId);
  if (binding) {
    if (binding.canonicalStoreId !== payment.storeId ||
        binding.paymentId !== payment.id ||
        binding.providerPaymentId !== payment.providerPaymentId) {
      throw new Error('PROVIDER_REFUND_READ_BINDING_MISMATCH');
    }
    return mercadoPagoStoreRequest<T>(binding.legacyStoreId, url, {method:'GET'});
  }
  const token = await resolveMercadoPagoAccessToken();
  if (!token) throw new Error('PROVIDER_REFUND_READ_ACCOUNT_UNAVAILABLE');
  const response = await fetch('https://api.mercadopago.com' + url, {
    method:'GET',
    headers: { 'accept':'application/json', 'authorization': 'Bearer ' + token },
  });
  if (!response.ok) throw new Error('PROVIDER_REFUND_READ_PROVIDER_UNAVAILABLE');
  return response.json() as Promise<T>;
};

/**
 * Does not mutate Firestore nor contact any refund POST endpoint. Never
 * declares the original refund liability settled.
 */
export const diagnoseMercadoPagoRefundReadOnly = async (input: {
  storeId: string; orderId: string;
}): Promise<ProviderRefundReadOnlyDiagnosis> => {
  if (!validId(input.storeId) || !validId(input.orderId)) {
    throw new Error('PROVIDER_REFUND_READ_TARGET_INVALID');
  }
  const order = await adminDb.doc(
    'artifacts/' + input.storeId + '/public/data/customerOrders/' + input.orderId
  ).get();
  if (!order.exists || order.get('storeId') !== input.storeId ||
      (order.get('id') && order.get('id') !== input.orderId) ||
      !['rejected', 'cancelled'].includes(identifier(order.get('status'))) ||
      order.get('paymentStatus') !== 'paid') {
    throw new Error('PROVIDER_REFUND_READ_ORDER_INVALID');
  }
  const payment = await verifiedPayment(input.storeId, input.orderId);
  const storedMinor = amountToMinor(payment.amount);
  if (storedMinor === null || storedMinor <= 0) {
    throw new Error('PROVIDER_REFUND_READ_PAYMENT_INVALID');
  }
  const paymentUrl = '/v1/payments/' + encodeURIComponent(payment.providerPaymentId);
  const [providerPayment, refundList, partialSnapshots] = await Promise.all([
    providerGet<Record<string, unknown>>(payment, paymentUrl),
    providerGet<unknown>(payment, paymentUrl + '/refunds'),
    adminDb.collection('stores/' + input.storeId + '/paymentPartialRefunds')
      .where('orderId', '==', input.orderId).limit(51).get(),
  ]);
  if (!providerPayment || typeof providerPayment !== 'object' ||
      identifier(providerPayment.id) !== payment.providerPaymentId) {
    throw new Error('PROVIDER_REFUND_READ_PAYMENT_MISMATCH');
  }
  const providerAmount = amountToMinor(providerPayment.transaction_amount);
  if (providerAmount === null || providerAmount <= 0) {
    throw new Error('PROVIDER_REFUND_READ_PAYMENT_MISMATCH');
  }
  const paymentStatus = identifier(providerPayment.status).toLowerCase();
  const refundedAmountReportedMinor =
    typeof providerPayment.transaction_amount_refunded === 'number'
      ? amountToMinor(providerPayment.transaction_amount_refunded)
      : null;
  const parsed = parseProviderRefundListing(refundList, payment.providerPaymentId, providerAmount);
  const statusCounts: Record<string, number> = {};
  for (const doc of partialSnapshots.docs) {
    const raw = identifier(doc.get('status')).toLowerCase();
    const status = /^[a-z_]{1,40}$/.test(raw) ? raw : 'unknown';
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
  }
  const blockers: string[] = [];
  if (providerAmount !== storedMinor) blockers.push('provider_amount_differs');
  if (partialSnapshots.size > 50) blockers.push('partial_history_truncated');
  if (partialSnapshots.docs.some(doc => doc.get('status') !== 'refunded')) {
    blockers.push('failed_partial_still_requires_reconciliation');
  }
  if (parsed.summary.approvedRefundCount > 0) blockers.push('provider_refund_confirmed');
  if (parsed.summary.uncertainRefundCount > 0) blockers.push('provider_refund_status_uncertain');
  if (refundedAmountReportedMinor !== null &&
      refundedAmountReportedMinor !== parsed.summary.approvedAmountMinor) {
    blockers.push('provider_refund_totals_mismatch');
  }
  if (paymentStatus === 'refunded' && parsed.summary.approvedAmountMinor !== providerAmount) {
    blockers.push('provider_refunded_status_mismatch');
  }
  return {
    source:'mercado_pago_read_only',
    paymentStatus,
    paymentAmountMinor:providerAmount,
    storedPaymentAmountMinor:storedMinor,
    amountMatches:providerAmount === storedMinor,
    refundedAmountReportedMinor,
    refunds:parsed.summary,
    partialAttempt:{count:partialSnapshots.size,statusCounts},
    blockers,
    notice:'Consulta GET ao Mercado Pago e leitura do Firestore. Nenhum reembolso foi solicitado e nenhum registro foi conciliado ou alterado. A pendência permanece aberta.',
  };
};
