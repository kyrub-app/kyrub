export const STORE_PROVIDER_PAYMENT_RECONCILIATION_SCHEMA_VERSION = 1 as const;
export const STORE_PROVIDER_PAYMENT_RECONCILIATION_CURRENCY = 'BRL' as const;

export type StoreProviderPaymentReconciliationProvider = 'mercado-pago';
export type StoreProviderPaymentReconciliationSourceAuthority = 'mercado_pago_payment_api';

export interface StoreProviderPaymentFeeEvidence {
  type: string;
  payer: string;
  amountMinor: number;
}

export interface StoreProviderPaymentReconciliation {
  schemaVersion: typeof STORE_PROVIDER_PAYMENT_RECONCILIATION_SCHEMA_VERSION;
  storeId: string;
  paymentId: string;
  orderId: string;
  provider: StoreProviderPaymentReconciliationProvider;
  providerPaymentId: string;
  currency: typeof STORE_PROVIDER_PAYMENT_RECONCILIATION_CURRENCY;
  canonicalPaymentMethod: 'pix' | 'card' | 'cash' | 'other';
  providerPaymentMethodId: string;
  providerPaymentTypeId: string;
  installments: number | null;
  providerStatus: string;
  providerStatusDetail: string;
  grossMinor: number;
  totalPaidMinor: number | null;
  providerFeeMinor: number | null;
  mercadoPagoFeeMinor: number | null;
  financingFeeMinor: number | null;
  otherCollectorFeeMinor: number | null;
  netReceivedMinor: number | null;
  feeEvidence: StoreProviderPaymentFeeEvidence[];
  moneyReleaseDate: string;
  moneyReleaseStatus: string;
  providerUpdatedAt: string;
  reconciledAt: string;
  sourceAuthority: StoreProviderPaymentReconciliationSourceAuthority;
  evidenceFingerprint: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

const validIsoOrEmpty = (value: string): boolean =>
  !value || Number.isFinite(Date.parse(value));

const nullableMinor = (value: unknown, label: string): number | null => {
  if (value === null || value === undefined) return null;
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error(`STORE_PROVIDER_RECONCILIATION_${label}_INVALID`);
  }
  return amount;
};

const isCanonicalPaymentMethod = (
  value: unknown
): value is StoreProviderPaymentReconciliation['canonicalPaymentMethod'] =>
  value === 'pix' || value === 'card' || value === 'cash' || value === 'other';

const normalizeFeeEvidence = (value: unknown): StoreProviderPaymentFeeEvidence[] => {
  if (!Array.isArray(value)) throw new Error('STORE_PROVIDER_RECONCILIATION_FEE_EVIDENCE_INVALID');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`STORE_PROVIDER_RECONCILIATION_FEE_${index}_INVALID`);
    }
    const source = item as Partial<StoreProviderPaymentFeeEvidence>;
    const type = clean(source.type);
    const payer = clean(source.payer);
    const amountMinor = Number(source.amountMinor);
    if (!type || !payer || !Number.isSafeInteger(amountMinor) || amountMinor < 0) {
      throw new Error(`STORE_PROVIDER_RECONCILIATION_FEE_${index}_INVALID`);
    }
    return { type, payer, amountMinor };
  });
};

export const normalizeStoreProviderPaymentReconciliation = (
  value: unknown
): StoreProviderPaymentReconciliation => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('STORE_PROVIDER_RECONCILIATION_INVALID');
  }
  const source = value as Partial<StoreProviderPaymentReconciliation>;
  const storeId = clean(source.storeId);
  const paymentId = clean(source.paymentId);
  const orderId = clean(source.orderId);
  const providerPaymentId = clean(source.providerPaymentId);
  const providerPaymentMethodId = clean(source.providerPaymentMethodId);
  const providerPaymentTypeId = clean(source.providerPaymentTypeId);
  const providerStatus = clean(source.providerStatus);
  const providerStatusDetail = clean(source.providerStatusDetail);
  const moneyReleaseDate = clean(source.moneyReleaseDate);
  const moneyReleaseStatus = clean(source.moneyReleaseStatus);
  const providerUpdatedAt = clean(source.providerUpdatedAt);
  const reconciledAt = clean(source.reconciledAt);
  const evidenceFingerprint = clean(source.evidenceFingerprint);
  const grossMinor = Number(source.grossMinor);

  if (
    source.schemaVersion !== STORE_PROVIDER_PAYMENT_RECONCILIATION_SCHEMA_VERSION
    || source.provider !== 'mercado-pago'
    || source.currency !== STORE_PROVIDER_PAYMENT_RECONCILIATION_CURRENCY
    || source.sourceAuthority !== 'mercado_pago_payment_api'
    || !storeId
    || storeId.includes('/')
    || !paymentId
    || paymentId.includes('/')
    || !orderId
    || !providerPaymentId
    || providerPaymentId.includes('/')
    || !isCanonicalPaymentMethod(source.canonicalPaymentMethod)
    || !providerStatus
    || !Number.isSafeInteger(grossMinor)
    || grossMinor <= 0
    || !validIsoOrEmpty(moneyReleaseDate)
    || !validIsoOrEmpty(providerUpdatedAt)
    || !reconciledAt
    || !Number.isFinite(Date.parse(reconciledAt))
    || !evidenceFingerprint
  ) {
    throw new Error('STORE_PROVIDER_RECONCILIATION_INVALID');
  }

  const installments = source.installments === null || source.installments === undefined
    ? null
    : Number(source.installments);
  if (installments !== null && (!Number.isSafeInteger(installments) || installments <= 0)) {
    throw new Error('STORE_PROVIDER_RECONCILIATION_INSTALLMENTS_INVALID');
  }

  return {
    schemaVersion: STORE_PROVIDER_PAYMENT_RECONCILIATION_SCHEMA_VERSION,
    storeId,
    paymentId,
    orderId,
    provider: 'mercado-pago',
    providerPaymentId,
    currency: STORE_PROVIDER_PAYMENT_RECONCILIATION_CURRENCY,
    canonicalPaymentMethod: source.canonicalPaymentMethod,
    providerPaymentMethodId,
    providerPaymentTypeId,
    installments,
    providerStatus,
    providerStatusDetail,
    grossMinor,
    totalPaidMinor: nullableMinor(source.totalPaidMinor, 'TOTAL_PAID'),
    providerFeeMinor: nullableMinor(source.providerFeeMinor, 'PROVIDER_FEE'),
    mercadoPagoFeeMinor: nullableMinor(source.mercadoPagoFeeMinor, 'MERCADO_PAGO_FEE'),
    financingFeeMinor: nullableMinor(source.financingFeeMinor, 'FINANCING_FEE'),
    otherCollectorFeeMinor: nullableMinor(source.otherCollectorFeeMinor, 'OTHER_FEE'),
    netReceivedMinor: nullableMinor(source.netReceivedMinor, 'NET_RECEIVED'),
    feeEvidence: normalizeFeeEvidence(source.feeEvidence),
    moneyReleaseDate,
    moneyReleaseStatus,
    providerUpdatedAt,
    reconciledAt,
    sourceAuthority: 'mercado_pago_payment_api',
    evidenceFingerprint,
  };
};

export const storeProviderPaymentReconciliationId = (
  provider: StoreProviderPaymentReconciliationProvider,
  providerPaymentId: string
): string => encodeURIComponent(`${provider}__${providerPaymentId.trim()}`);

export const storeProviderPaymentReconciliationPath = (
  storeId: string,
  provider: StoreProviderPaymentReconciliationProvider,
  providerPaymentId: string
): string => `stores/${storeId}/providerPaymentReconciliations/${storeProviderPaymentReconciliationId(provider, providerPaymentId)}`;
