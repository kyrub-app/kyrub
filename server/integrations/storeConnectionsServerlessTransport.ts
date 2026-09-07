import express from 'express';
import rateLimit from 'express-rate-limit';
import { createStoreConnectionOnboardingRouter } from './storeConnectionOnboardingRouter.js';
import { createMercadoLivreRouter } from './mercadoLivreRouter.js';
import { createMercadoLivreStockExecutionRouter } from './mercadoLivreStockExecutionRouter.js';
import { createMercadoLivreE2ETestRouter } from './mercadoLivreE2ETestRouter.js';

type QueryValue = string | string[] | undefined;

type RequestLike = {
  url?: string;
  query?: Record<string, QueryValue>;
  once?: (event: string, listener: () => void) => unknown;
};

type ResponseLike = {
  once?: (event: string, listener: () => void) => unknown;
  writableEnded?: boolean;
};

const app = express();
app.set('trust proxy', 1);

const integrationRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  message: {
    error: 'Muitas solicitações de integração. Tente novamente em instantes.',
    code: 'TOO_MANY_INTEGRATION_REQUESTS',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(
  '/api/store-connections/mercado-livre',
  integrationRateLimiter,
  createMercadoLivreRouter()
);
app.use(
  '/api/store-connections/mercado-livre',
  integrationRateLimiter,
  createMercadoLivreStockExecutionRouter()
);
app.use(
  '/api/store-connections/mercado-livre',
  integrationRateLimiter,
  createMercadoLivreE2ETestRouter()
);
app.use(
  '/api/store-connections',
  integrationRateLimiter,
  createStoreConnectionOnboardingRouter()
);

const first = (value: QueryValue): string =>
  (Array.isArray(value) ? value[0] : value)?.trim() ?? '';

const reconstructedQuery = (query: Record<string, QueryValue> | undefined): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (key === 'transport' || key === 'path') continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else if (typeof value === 'string') {
      params.append(key, value);
    }
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
};

export const handleStoreConnectionsServerlessRequest = async (
  requestInput: unknown,
  responseInput: unknown
): Promise<void> => {
  const request = requestInput as RequestLike;
  const response = responseInput as ResponseLike;
  const path = first(request.query?.path).replace(/^\/+|\/+$/g, '');
  const originalUrl = request.url;
  request.url = `/api/store-connections${path ? `/${path}` : ''}${reconstructedQuery(request.query)}`;

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (error?: unknown) => {
        if (settled) return;
        settled = true;
        error ? reject(error) : resolve();
      };

      response.once?.('finish', () => settle());
      response.once?.('close', () => settle());

      app(
        requestInput as Parameters<typeof app>[0],
        responseInput as Parameters<typeof app>[1],
        (error?: unknown) => settle(error ?? new Error('STORE_CONNECTION_ROUTE_NOT_FOUND'))
      );

      if (response.writableEnded) settle();
    });
  } finally {
    request.url = originalUrl;
  }
};
