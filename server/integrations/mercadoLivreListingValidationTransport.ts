import { MERCADO_LIVRE_API_ORIGIN } from '../../shared/mercadoLivreIntegration.js';
import { getValidMercadoLivreAccessToken } from './mercadoLivreOauthService.js';

const text = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

const recordFrom = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

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
  const record = recordFrom(payload);
  const providerCode = safeProviderDiagnostic(record.code);
  const providerError = safeProviderDiagnostic(record.error);
  const providerMessage = safeProviderDiagnostic(record.message ?? record.error_description);
  return {
    ...(providerCode ? { providerCode } : {}),
    ...(providerError ? { providerError } : {}),
    ...(providerMessage ? { providerMessage } : {}),
  };
};

const providerCauseDiagnostics = (payload: unknown): Array<Record<string, string>> => {
  const raw = recordFrom(payload).cause;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(candidate => candidate && typeof candidate === 'object' && !Array.isArray(candidate))
    .map(candidate => {
      const record = candidate as Record<string, unknown>;
      const code = safeProviderDiagnostic(record.code);
      const message = safeProviderDiagnostic(record.message);
      const reference = safeProviderDiagnostic(record.reference);
      const type = safeProviderDiagnostic(record.type ?? record.severity ?? record.level);
      const department = safeProviderDiagnostic(record.department);
      return {
        ...(code ? { code } : {}),
        ...(message ? { message } : {}),
        ...(reference ? { reference } : {}),
        ...(type ? { type } : {}),
        ...(department ? { department } : {}),
      };
    })
    .filter(candidate => Object.keys(candidate).length > 0)
    .slice(0, 30);
};

const requestShippingDiagnostic = (body: unknown): Record<string, unknown> => {
  const shipping = recordFrom(recordFrom(body).shipping);
  if (Object.keys(shipping).length === 0) return { present: false };
  const freeMethods = Array.isArray(shipping.free_methods) ? shipping.free_methods : null;
  return {
    present: true,
    keys: Object.keys(shipping).sort().slice(0, 20),
    mode: safeProviderDiagnostic(shipping.mode),
    logisticType: safeProviderDiagnostic(shipping.logistic_type),
    freeShipping: typeof shipping.free_shipping === 'boolean' ? shipping.free_shipping : null,
    localPickUp: typeof shipping.local_pick_up === 'boolean' ? shipping.local_pick_up : null,
    freeMethodsCount: freeMethods ? freeMethods.length : null,
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

  console.info('[Mercado Livre listing validation diagnostic]', {
    status: response.status,
    endpoint: '/items/validate',
    requestShipping: requestShippingDiagnostic(body),
    ...providerDiagnostic(payload),
    causes: providerCauseDiagnostics(payload),
  });

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
