import { MERCADO_LIVRE_API_ORIGIN } from '../../shared/mercadoLivreIntegration.js';
import { getValidMercadoLivreAccessToken } from './mercadoLivreOauthService.js';

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

export const mercadoLivreValidateJson = async (
  storeId: string,
  path: string,
  body: unknown
): Promise<{ status: number; payload: unknown }> => {
  if (path !== '/items/validate') {
    throw new Error('MERCADO_LIVRE_LISTING_VALIDATION_ENDPOINT_INVALID');
  }

  const secret = await getValidMercadoLivreAccessToken(storeId);
  const url = new URL(path, MERCADO_LIVRE_API_ORIGIN);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${secret.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (response.status === 204) return { status: 204, payload: null };
  const payload = await response.json().catch(() => ({}));

  if (response.status >= 500 || response.status === 401 || response.status === 403 || response.status === 429) {
    console.error('[Mercado Livre listing validation rejection]', {
      status: response.status,
      endpoint: '/items/validate',
      ...providerDiagnostic(payload),
    });
    throw new Error(`MERCADO_LIVRE_API_FAILED:HTTP_${response.status}`);
  }

  return { status: response.status, payload };
};
