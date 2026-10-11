import { providerFeeValuesDisagree } from './financeProviderEvidenceCoverage.js';

/** Read-only diagnostic flags. No issue authorizes changing ledger or PSP amounts. */
export type MercadoPagoPaymentReviewIssue =
  | 'missing_reconciliation'
  | 'invalid_reconciliation'
  | 'gross_divergence'
  | 'fee_divergence'
  | 'missing_provider_fee'
  | 'missing_net_amount'
  | 'missing_refund_information'
  | 'missing_release_information';

export type MercadoPagoPaymentReviewEvidence = {
  grossMinor: number;
  providerFeeEvidenceAvailable: boolean;
  providerFeeMinor: number | null;
  netReceivedMinor: number | null;
  refundedMinor: number | null;
  moneyReleaseDate: string;
  moneyReleaseStatus: string;
};

export const classifyMercadoPagoPaymentReviewIssues = (input: {
  canonicalGrossMinor: number;
  ledgerProviderFeeMinor: number | null;
  provider: MercadoPagoPaymentReviewEvidence | null;
}): MercadoPagoPaymentReviewIssue[] => {
  const { canonicalGrossMinor, ledgerProviderFeeMinor, provider } = input;
  if (!provider) return ['missing_reconciliation'];

  const issues: MercadoPagoPaymentReviewIssue[] = [];
  if (provider.grossMinor !== canonicalGrossMinor) issues.push('gross_divergence');
  if (!provider.providerFeeEvidenceAvailable || provider.providerFeeMinor === null) {
    issues.push('missing_provider_fee');
  } else if (providerFeeValuesDisagree(
    ledgerProviderFeeMinor,
    provider.providerFeeMinor,
    provider.providerFeeEvidenceAvailable
  )) {
    issues.push('fee_divergence');
  }
  if (provider.netReceivedMinor === null) issues.push('missing_net_amount');
  if (provider.refundedMinor === null) issues.push('missing_refund_information');
  if (!provider.moneyReleaseDate && !provider.moneyReleaseStatus) {
    issues.push('missing_release_information');
  }
  return issues;
};
