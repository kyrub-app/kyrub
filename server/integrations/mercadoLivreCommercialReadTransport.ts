import { MERCADO_LIVRE_API_ORIGIN } from '../../shared/mercadoLivreIntegration.js';
import { getValidMercadoLivreAccessToken } from './mercadoLivreOauthService.js';

export type MercadoLivreCommercialReadEndpoint =
  | 'category_sale_terms'
  | 'seller_shipping_preferences'
  | 'category_shipping_preferences';

const text = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

const safeProviderDiagnostic = (value: unknown): string =>
  text(value)
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/[A-Za-z0-9_-]{40,}/g, '[redacted]')
    .replace(/\b\d{8,}\b/g, '[id]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);

const providerDiagnostic = (payload: unknown): {
  providerCode?: string;
  providerError?: string;
  providerMessage?: string;
} => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const record = payload as Record<string, unknown>;
  const providerCode = safeProviderDiagnostic(record.code);
  const providerError = safeProviderDiagnostic(record.error);
  const providerMessage = safeProviderDiagnostic(record.message ?? record.error_description);
  return {
    ...(providerCode ? { providerCode } : {}),
    ...(providerError ? { providerError } : {}),
    ...(providerMessage ? { providerMessage } : {}),
  };
};

const validPathForEndpoint = (
  endpoint: MercadoLivreCommercialReadEndpoint,
  path: string
): boolean => {
  if (endpoint === 'category_sale_terms') {
    return /^\/categories\/[^/]+\/sale_terms$/.test(path);
  }
  if (endpoint === 'seller_shipping_preferences') {
    return /^\/users\/[^/]+\/shipping_preferences$/.test(path);
  }
  return /^\/categories\/[^/]+\/shipping_preferences$/.test(path);
};

export const mercadoLivreCommercialGetJson = async <T>(input: {
  storeId: string;
  endpoint: MercadoLivreCommercialReadEndpoint;
  path: string;
}): Promise<T> => {
  const storeId = input.storeId.trim();
  const path = input.path.trim();
  if (!storeId || !validPathForEndpoint(input.endpoint, path)) {
    throw new Error('MERCADO_LIVRE_COMMERCIAL_READ_ENDPOINT_INVALID');
  }

  try {
    const secret = await getValidMercadoLivreAccessToken(storeId);
    const url = new URL(path, MERCADO_LIVRE_API_ORIGIN);
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${secret.accessToken}`,
      },
    });
    if (response.ok) return response.json() as Promise<T>;

    const payload = await response.json().catch(() => ({}));
    console.error('[Mercado Livre commercial readiness rejection]', {
      endpoint: input.endpoint,
      status: response.status,
      ...providerDiagnostic(payload),
    });
    throw new Error(`MERCADO_LIVRE_API_FAILED:HTTP_${response.status}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('MERCADO_LIVRE_API_FAILED:HTTP_')) {
      throw error;
    }
    const code = safeProviderDiagnostic(error instanceof Error ? error.message : String(error));
    console.error('[Mercado Livre commercial readiness transport failure]', {
      endpoint: input.endpoint,
      ...(code ? { code } : {}),
    });
    throw error;
  }
};
