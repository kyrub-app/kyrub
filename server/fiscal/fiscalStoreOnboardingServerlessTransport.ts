import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  mapFiscalStoreOnboardingError,
  prepareOwnFiscalStoreOnboarding,
} from './fiscalStoreOnboardingService.js';

type QueryValue = string | string[] | undefined;

type RequestLike = {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
  query?: Record<string, QueryValue>;
  url?: string;
  once?: (event: string, listener: () => void) => unknown;
};

type ResponseLike = {
  setHeader: (name: string, value: string) => unknown;
  status: (status: number) => ResponseLike;
  json: (body: unknown) => unknown;
  once?: (event: string, listener: () => void) => unknown;
  writableEnded?: boolean;
};

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: {
    error: 'Muitas tentativas de configuração fiscal. Tente novamente em instantes.',
    code: 'TOO_MANY_FISCAL_ONBOARDING_REQUESTS',
  },
  standardHeaders: true,
  legacyHeaders: false,
}));

const headerValue = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

app.post('/api/fiscal-store-onboarding/prepare', async (request, response) => {
  try {
    const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
      ? request.body as Record<string, unknown>
      : {};
    const result = await prepareOwnFiscalStoreOnboarding({
      authorization: headerValue(request.headers.authorization),
      canonicalStoreId: body.canonicalStoreId,
    });
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.status(200).json(result);
  } catch (error) {
    const mapped = mapFiscalStoreOnboardingError(error);
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.status(mapped.status).json(mapped.body);
  }
});

const first = (value: QueryValue): string =>
  (Array.isArray(value) ? value[0] : value)?.trim() ?? '';

export const handleFiscalStoreOnboardingServerlessRequest = async (
  requestInput: unknown,
  responseInput: unknown
): Promise<void> => {
  const request = requestInput as RequestLike;
  const response = responseInput as ResponseLike;
  const path = first(request.query?.path).replace(/^\/+|\/+$/g, '');
  const originalUrl = request.url;
  request.url = `/api/fiscal-store-onboarding${path ? `/${path}` : ''}`;

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
        (error?: unknown) => settle(error ?? new Error('FISCAL_STORE_ONBOARDING_ROUTE_NOT_FOUND'))
      );
      if (response.writableEnded) settle();
    });
  } finally {
    request.url = originalUrl;
  }
};
