/** Candidate launch terms only; does not authorize payment or bypass existing funding. */
export type DirectPaymentTiming = 'advance' | 'on_completion';
export type DirectPaymentMethod = 'external_pix' | 'mercado_pago';
export type DirectPaymentTerms = {
  schemaVersion: 1;
  timing: DirectPaymentTiming;
  method: DirectPaymentMethod;
  currency: 'BRL';
  amountMinor: number;
  platformCommissionMinor: 0;
  providerFeeResponsibility: 'financial_service_customer';
};
export function createDirectPaymentTerms(input: unknown): DirectPaymentTerms {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('DIRECT_PAYMENT_TERMS_INVALID');
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some(key => !['timing','method','amountMinor'].includes(key))) throw Error('DIRECT_PAYMENT_TERMS_INVALID');
  const timing = data.timing === undefined ? 'on_completion' : data.timing;
  const method = data.method;
  const amount = data.amountMinor;
  if ((timing !== 'advance' && timing !== 'on_completion') ||
      (method !== 'external_pix' && method !== 'mercado_pago') ||
      typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0 || amount > 999999999)
    throw Error('DIRECT_PAYMENT_TERMS_INVALID');
  return {schemaVersion:1,timing,method,currency:'BRL',amountMinor:amount,platformCommissionMinor:0,providerFeeResponsibility:'financial_service_customer'};
}
