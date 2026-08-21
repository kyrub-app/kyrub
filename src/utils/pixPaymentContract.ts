export interface PixChargeRequest {
  paymentIntentId: string;
  amount: number;
  currency: 'BRL';
  description: string;
  expiresAt: string;
}

export interface PixChargeResult {
  provider: string;
  providerIntentId: string;
  providerPaymentId: string;
  copyAndPasteCode: string;
  qrCodeImageUrl: string;
  expiresAt: string;
}

export interface PixPaymentProvider {
  id: string;
  createPixCharge(request: PixChargeRequest): Promise<PixChargeResult>;
}

const required = (label: string, value: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
};

export const normalizePixChargeRequest = (
  input: PixChargeRequest
): PixChargeRequest => {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('PIX_AMOUNT_INVALID');
  }
  const expiresAt = input.expiresAt.trim();
  if (!expiresAt || Number.isNaN(Date.parse(expiresAt))) {
    throw new Error('PIX_EXPIRATION_INVALID');
  }

  return {
    paymentIntentId: required('payment intent id', input.paymentIntentId),
    amount: Number(input.amount.toFixed(2)),
    currency: 'BRL',
    description: input.description.trim(),
    expiresAt,
  };
};

export const normalizePixChargeResult = (
  input: PixChargeResult
): PixChargeResult => {
  const expiresAt = input.expiresAt.trim();
  if (!expiresAt || Number.isNaN(Date.parse(expiresAt))) {
    throw new Error('PIX_PROVIDER_EXPIRATION_INVALID');
  }

  return {
    provider: required('payment provider', input.provider),
    providerIntentId: required('provider intent id', input.providerIntentId),
    providerPaymentId: required('provider payment id', input.providerPaymentId),
    copyAndPasteCode: required('pix copy and paste code', input.copyAndPasteCode),
    qrCodeImageUrl: input.qrCodeImageUrl.trim(),
    expiresAt,
  };
};
