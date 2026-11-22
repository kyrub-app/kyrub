/**
 * Conservative read-only representation of the Mercado Pago refunds listing.
 * No "approved refund" inference is made from a Firestore attempt marked failed.
 */
export interface ProviderRefundSummary {
  refundCount: number;
  approvedRefundCount: number;
  approvedAmountMinor: number;
  uncertainRefundCount: number;
  statuses: Record<string, number>;
}
export interface ParsedRefundListing {
  summary: ProviderRefundSummary;
  refunds: Array<{ status: string; amountMinor: number | null }>;
}

export const amountToMinor = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const minor = Math.round(value * 100);
  return Number.isSafeInteger(minor) ? minor : null;
};
const identifier = (value: unknown): string =>
  typeof value === 'number' || typeof value === 'string' ? String(value).trim() : '';
const approved = new Set(['approved', 'refunded', 'completed']);

export const parseProviderRefundListing = (
  data: unknown,
  expectedPaymentId: string,
  originalAmountMinor: number,
): ParsedRefundListing => {
  if (!expectedPaymentId || !Number.isSafeInteger(originalAmountMinor) || originalAmountMinor <= 0) {
    throw new Error('PROVIDER_REFUND_READ_INVALID_PAYMENT');
  }
  const listing = Array.isArray(data) ? data :
    (data && typeof data === 'object' &&
      Array.isArray((data as { results?: unknown }).results))
      ? (data as { results: unknown[] }).results
      : null;
  if (!listing || listing.length > 100) {
    throw new Error('PROVIDER_REFUND_READ_INVALID_LIST');
  }
  let approvedAmountMinor = 0;
  let approvedRefundCount = 0;
  let uncertainRefundCount = 0;
  const statuses: Record<string, number> = {};
  const refunds = listing.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('PROVIDER_REFUND_READ_INVALID_ITEM');
    }
    const item = raw as Record<string, unknown>;
    const linkedPaymentId = identifier(item.payment_id);
    if (linkedPaymentId !== expectedPaymentId || !identifier(item.id)) {
      throw new Error('PROVIDER_REFUND_READ_PAYMENT_MISMATCH');
    }
    const amountMinor = amountToMinor(item.amount);
    const status = typeof item.status === 'string' && /^[a-z_]{1,40}$/.test(item.status)
      ? item.status.toLowerCase() : 'unknown';
    statuses[status] = (statuses[status] ?? 0) + 1;
    if (approved.has(status) && amountMinor !== null && amountMinor > 0) {
      approvedRefundCount++;
      approvedAmountMinor += amountMinor;
      if (!Number.isSafeInteger(approvedAmountMinor) || approvedAmountMinor > originalAmountMinor) {
        throw new Error('PROVIDER_REFUND_READ_AMOUNT_MISMATCH');
      }
    } else {
      // "failed" and "rejected" are not authorization to reopen a financial path.
      uncertainRefundCount++;
    }
    return { status, amountMinor };
  });
  return { summary: {
    refundCount: listing.length, approvedRefundCount, approvedAmountMinor,
    uncertainRefundCount, statuses,
  }, refunds };
};
