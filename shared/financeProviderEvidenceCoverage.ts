/**
 * Comparing independently recorded provider processing fees is a diagnostic
 * only. A mismatch never rewrites ledger money or provider reconciliation.
 * A zero-fee evidence (0) is known; null means missing evidence.
 */
export const providerFeeValuesDisagree = (
  ledgerFeeMinor: number | null,
  providerFeeMinor: number | null,
  providerEvidenceAvailable: boolean
): boolean =>
  providerEvidenceAvailable &&
  ledgerFeeMinor !== null &&
  providerFeeMinor !== null &&
  Number.isSafeInteger(ledgerFeeMinor) &&
  Number.isSafeInteger(providerFeeMinor) &&
  ledgerFeeMinor !== providerFeeMinor;
