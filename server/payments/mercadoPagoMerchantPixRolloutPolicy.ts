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

/**
 * Non-financial preparation signal for a store owner. This does NOT imply
 * OAuth token freshness, provider merchant capability or successful payment.
 * No token or other merchant's connection is consulted.
 */
export type MercadoPagoMerchantPixPreparationState =
  | 'preview_readonly'
  | 'platform_setup_required'
  | 'store_connection_required'
  | 'rollout_pending'
  | 'live_preflight_required';

export const mercadoPagoMerchantPixPreparationState = (input: {
  storeId: string;
  platformConfigured: boolean;
  connected: boolean;
  oauthOperationsAllowed: boolean;
  env: MercadoPagoMerchantPixRolloutEnvironment;
}): MercadoPagoMerchantPixPreparationState => {
  if (!input.oauthOperationsAllowed) return 'preview_readonly';
  if (!input.platformConfigured) return 'platform_setup_required';
  if (!input.connected) return 'store_connection_required';
  if (mercadoPagoMerchantPixRolloutError(input.storeId, input.env)) return 'rollout_pending';
  return 'live_preflight_required';
};
