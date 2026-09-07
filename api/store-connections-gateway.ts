import express from 'express';
import rateLimit from 'express-rate-limit';
import { createMercadoLivreRouter } from '../server/integrations/mercadoLivreRouter';
import { createMercadoLivreStockExecutionRouter } from '../server/integrations/mercadoLivreStockExecutionRouter';
import { createMercadoLivreE2ETestRouter } from '../server/integrations/mercadoLivreE2ETestRouter';
import { createStoreConnectionOnboardingRouter } from '../server/integrations/storeConnectionOnboardingRouter';

type HeaderValue = string | string[] | undefined;
type QueryValue = string | string[] | undefined;

type RequestLike = {
  method?: string;
  url?: string;
  headers: Record<string, HeaderValue>;
  query?: Record<string, QueryValue>;
  body?: unknown;
};

type ResponseLike = {
  setHeader(name: string, value: string): void;
  status(code: number): ResponseLike;
  json(body: unknown): void;
};

const PATH_QUERY = '__kyrubStoreConnectionPath';

const gateway = express();
gateway.disable('x-powered-by');
gateway.set('trust proxy', 1);

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

gateway.use('/api/store-connections', integrationRateLimiter);
gateway.use(
  '/api/store-connections/mercado-livre',
  createMercadoLivreRouter()
);
gateway.use(
  '/api/store-connections/mercado-livre',
  createMercadoLivreStockExecutionRouter()
);
gateway.use(
  '/api/store-connections/mercado-livre',
  createMercadoLivreE2ETestRouter()
);
gateway.use(
  '/api/store-connections',
  createStoreConnectionOnboardingRouter()
);

gateway.use((_request, response) => {
  response.status(404).json({
    error: 'A rota de integração solicitada não foi encontrada.',
    code: 'STORE_CONNECTION_ROUTE_NOT_FOUND',
  });
});

const firstValue = (value: QueryValue): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

const normalizePath = (value: string): string =>
  value.trim().replace(/^\/+|\/+$/g, '');

const routedUrl = (request: RequestLike): string => {
  const incoming = new URL(request.url ?? '/api/store-connections-gateway', 'http://localhost');
  const pathFromQuery = firstValue(request.query?.[PATH_QUERY]) || incoming.searchParams.get(PATH_QUERY) || '';
  const path = normalizePath(pathFromQuery);
  incoming.searchParams.delete(PATH_QUERY);
  const search = incoming.searchParams.toString();
  return `/api/store-connections${path ? `/${path}` : ''}${search ? `?${search}` : ''}`;
};

export default function handler(
  request: RequestLike,
  response: ResponseLike
): void {
  response.setHeader('cache-control', 'no-store, max-age=0');
  request.url = routedUrl(request);
  gateway(request as never, response as never);
}
