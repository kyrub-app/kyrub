import { verifyMercadoPagoWebhookSignatureWithSecret } from './mercadoPagoPixProvider.js';
import { getOfficialStoreIdentity } from '../admin/officialStoreService.js';
import { resolveCommercialRecipientAuthority } from './commercialRecipientAuthorityService.js';
import { validateMercadoPagoStoreConnection } from '../integrations/mercadoPagoStoreOauthService.js';

/** Platform billing only. Never falls back to marketplace credentials or merchant OAuth. */
export const officialPlanPixRequest = async <T = any>(path: string, init: RequestInit = {}): Promise<T> => {
  const token = process.env.KYRUB_BILLING_MERCADO_PAGO_ACCESS_TOKEN?.trim();
  if (!token || !process.env.KYRUB_BILLING_MERCADO_PAGO_WEBHOOK_SECRET?.trim()) {
    throw new Error('OFFICIAL_PIX_NOT_CONFIGURED');
  }
  if (!/^\/(users\/me|v1\/payments(?:\/\d+|\/search\?.*)?)$/.test(path)) throw new Error('OFFICIAL_PIX_PROVIDER_PATH_INVALID');
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    ...init, signal: AbortSignal.timeout(20000),
    headers: { ...init.headers, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  });
  if (!response.ok) throw new Error(`OFFICIAL_PIX_PROVIDER_HTTP_${response.status}`);
  return response.json() as Promise<T>;
};

export const verifyOfficialPlanPixSignature = (headers: Record<string, string | string[] | undefined>, dataId: string) =>
  verifyMercadoPagoWebhookSignatureWithSecret({ headers, dataId }, process.env.KYRUB_BILLING_MERCADO_PAGO_WEBHOOK_SECRET || '');

/**
 * Official subscriptions are sales of the official ERP store.
 * Require its live, owner-authorized Mercado Pago OAuth account to match
 * the platform billing token before any Pix creation or reconciliation.
 * Never infer the receiver from a mutable store label or client input.
 */
export const officialPlanPixAccount = async (): Promise<string> => {
  const official = await getOfficialStoreIdentity();
  if (!official?.canonicalStoreId) throw new Error('OFFICIAL_PIX_STORE_NOT_CONFIGURED');

  const authority = await resolveCommercialRecipientAuthority({
    context: 'store_sale',
    canonicalStoreId: official.canonicalStoreId,
  });
  const storeAccountId = await validateMercadoPagoStoreConnection(authority.credentialScopeId);
  if (!/^[0-9]+$/.test(storeAccountId) || storeAccountId !== authority.externalAccountId) {
    throw new Error('OFFICIAL_PIX_STORE_ACCOUNT_INVALID');
  }

  const platformAccount = await officialPlanPixRequest<{ id?: string | number }>('/users/me');
  if (String(platformAccount.id) !== storeAccountId) {
    throw new Error('OFFICIAL_PIX_PLATFORM_STORE_ACCOUNT_MISMATCH');
  }

  // Optional pinned receiver for rollout/incident response. Never override the ERP account.
  const pinned = process.env.KYRUB_BILLING_MERCADO_PAGO_COLLECTOR_ID?.trim();
  if (pinned && pinned !== storeAccountId) throw new Error('OFFICIAL_PIX_ACCOUNT_INVALID');
  return storeAccountId;
};
