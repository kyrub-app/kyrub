/**
 * Deterministic, read-only Pix expiry for one accepted renewal proposal.
 * Repeated preparation cannot silently change the payment payload while
 * retaining the same Mercado Pago idempotency key.
 *
 * Once this window expires the caller must fail closed. A future explicit
 * reissue protocol needs a new payment attempt identity and atomic storage.
 */
export const prepaidRenewalPixExpiryFromAcceptance = (
  acceptedAt: string,
  nowMillis: number = Date.now(),
): string => {
  if (typeof acceptedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T/.test(acceptedAt) ||
      !Number.isFinite(Date.parse(acceptedAt)) ||
      !Number.isFinite(nowMillis)) {
    throw new Error('RENEWAL_PIX_ACCEPTANCE_TIMESTAMP_INVALID');
  }
  const acceptedMillis = Date.parse(acceptedAt);
  const expiryMillis = acceptedMillis + 30 * 60_000;
  if (!Number.isSafeInteger(expiryMillis) || acceptedMillis > nowMillis ||
      expiryMillis <= nowMillis) {
    throw new Error('RENEWAL_PIX_ACCEPTANCE_WINDOW_EXPIRED');
  }
  return new Date(expiryMillis).toISOString();
};
