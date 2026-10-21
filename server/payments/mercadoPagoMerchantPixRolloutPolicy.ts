// Pure, side-effect-free policy. Store eligibility never selects credentials;
// the checkout separately resolves the canonical store OAuth and collector.
export interface MercadoPagoMerchantPixRolloutEnvironment {
  VERCEL_ENV?: string;
  KYRUB_MP_MERCHANT_PIX_ENABLED?: string;
  KYRUB_MP_MERCHANT_PIX_ROLLOUT_MODE?: string;
  KYRUB_MP_MERCHANT_PIX_CANARY_STORE_ID?: string;
}

export type MercadoPagoMerchantPixRolloutError =
  | 'MERCADO_PAGO_STORE_PIX_PRODUCTION_ONLY'
  | 'MERCADO_PAGO_STORE_PIX_ROLLOUT_NOT_ENABLED';

export const mercadoPagoMerchantPixRolloutError = (
  storeIdInput: string,
  env: MercadoPagoMerchantPixRolloutEnvironment
): MercadoPagoMerchantPixRolloutError | null => {
  if (env.VERCEL_ENV !== 'production') return 'MERCADO_PAGO_STORE_PIX_PRODUCTION_ONLY';
  if (env.KYRUB_MP_MERCHANT_PIX_ENABLED !== 'true') return 'MERCADO_PAGO_STORE_PIX_ROLLOUT_NOT_ENABLED';
  const storeId = storeIdInput.trim();
  if (!storeId || storeId.includes('/')) return 'MERCADO_PAGO_STORE_PIX_ROLLOUT_NOT_ENABLED';

  if (env.KYRUB_MP_MERCHANT_PIX_ROLLOUT_MODE === 'canary') {
    const pilotId = env.KYRUB_MP_MERCHANT_PIX_CANARY_STORE_ID?.trim() ?? '';
    return pilotId && pilotId === storeId ? null : 'MERCADO_PAGO_STORE_PIX_ROLLOUT_NOT_ENABLED';
  }
  if (env.KYRUB_MP_MERCHANT_PIX_ROLLOUT_MODE === 'connected_stores') return null;
  return 'MERCADO_PAGO_STORE_PIX_ROLLOUT_NOT_ENABLED';
};

export const isMercadoPagoMerchantPixRolloutAllowed = (
  storeId: string,
  env: MercadoPagoMerchantPixRolloutEnvironment
): boolean => mercadoPagoMerchantPixRolloutError(storeId, env) === null;
