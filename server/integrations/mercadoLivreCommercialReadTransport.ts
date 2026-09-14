import { MERCADO_LIVRE_API_ORIGIN } from '../../shared/mercadoLivreIntegration.js';
import { getValidMercadoLivreAccessToken } from './mercadoLivreOauthService.js';

export type MercadoLivreCommercialReadEndpoint =
  | 'category_sale_terms'
  | 'seller_shipping_preferences'
  | 'category_shipping_preferences';

export type MercadoLivreCommercialPostEndpoint = 'prepublication_shipping_modes';

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

const shippingRuleDiagnostic = (value: unknown): Record<string, unknown> => {
  const record = recordFrom(value);
  const tags = Array.isArray(record.tags)
    ? record.tags.map(tag => safeProviderDiagnostic(tag)).filter(Boolean).slice(0, 20)
    : [];
  return {
    dimensions: safeProviderDiagnostic(record.dimensions),
    costs: safeProviderDiagnostic(record.costs),
    adoption: safeProviderDiagnostic(record.adoption),
    freeShipping: safeProviderDiagnostic(record.free_shipping),
    localPickUp: safeProviderDiagnostic(record.local_pick_up),
    tags,
  };
};

const prepublicationShippingDiagnostic = (payload: unknown): Array<Record<string, unknown>> => {
  const marketplace = recordFrom(recordFrom(recordFrom(payload).channels).marketplace);
  const modes = Array.isArray(marketplace.available_modes) ? marketplace.available_modes : [];
  return modes.slice(0, 8).map(candidate => {
    const mode = recordFrom(candidate);
    const logisticTypes = Array.isArray(mode.logistic_types) ? mode.logistic_types : [];
    return {
      mode: safeProviderDiagnostic(mode.mode),
      shippingAttributes: shippingRuleDiagnostic(mode.shipping_attributes),
      logisticTypes: logisticTypes.slice(0, 12).map(logisticCandidate => {
        const logistic = recordFrom(logisticCandidate);
        return {
          type: safeProviderDiagnostic(logistic.type),
          default: logistic.default === true,
          attributes: shippingRuleDiagnostic(logistic.attributes),
        };
      }),
    };
  });
};

const reportRejection = (
  endpoint: MercadoLivreCommercialReadEndpoint | MercadoLivreCommercialPostEndpoint,
  status: number,
  payload: unknown
): never => {
  console.error('[Mercado Livre commercial readiness rejection]', {
    endpoint,
    status,
    ...providerDiagnostic(payload),
  });
  throw new Error(`MERCADO_LIVRE_API_FAILED:HTTP_${status}`);
};

const reportTransportFailure = (
  endpoint: MercadoLivreCommercialReadEndpoint | MercadoLivreCommercialPostEndpoint,
  error: unknown
): never => {
  if (error instanceof Error && error.message.startsWith('MERCADO_LIVRE_API_FAILED:HTTP_')) {
    throw error;
  }
  const code = safeProviderDiagnostic(error instanceof Error ? error.message : String(error));
  console.error('[Mercado Livre commercial readiness transport failure]', {
    endpoint,
    ...(code ? { code } : {}),
  });
  throw error;
};

const validReadPathForEndpoint = (
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
  if (!storeId || !validReadPathForEndpoint(input.endpoint, path)) {
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
    return reportRejection(input.endpoint, response.status, payload);
  } catch (error) {
    return reportTransportFailure(input.endpoint, error);
  }
};

export const mercadoLivreCommercialPostJson = async <T>(input: {
  storeId: string;
  endpoint: MercadoLivreCommercialPostEndpoint;
  path: string;
  body: unknown;
}): Promise<T> => {
  const storeId = input.storeId.trim();
  const path = input.path.trim();
  if (
    !storeId ||
    input.endpoint !== 'prepublication_shipping_modes' ||
    !/^\/users\/[^/]+\/shipping_modes$/.test(path)
  ) {
    throw new Error('MERCADO_LIVRE_COMMERCIAL_POST_ENDPOINT_INVALID');
  }

  try {
    const secret = await getValidMercadoLivreAccessToken(storeId);
    const url = new URL(path, MERCADO_LIVRE_API_ORIGIN);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${secret.accessToken}`,
        'content-type': 'application/json',
        'x-multichannel': 'true',
        'x-format-new': 'true',
      },
      body: JSON.stringify(input.body),
    });
    if (response.ok) {
      const payload = await response.json() as T;
      console.info('[Mercado Livre prepublication shipping diagnostic]', {
        endpoint: input.endpoint,
        status: response.status,
        modes: prepublicationShippingDiagnostic(payload),
      });
      return payload;
    }
    const payload = await response.json().catch(() => ({}));
    return reportRejection(input.endpoint, response.status, payload);
  } catch (error) {
    return reportTransportFailure(input.endpoint, error);
  }
};
