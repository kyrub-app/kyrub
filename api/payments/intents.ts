import {
  createMarketplacePaymentIntent,
  mapMarketplaceCheckoutError,
} from '../../server/payments/paymentIntentRouter.js';

type HeaderValue = string | string[] | undefined;

type RequestLike = {
  method?: string;
  headers: Record<string, HeaderValue>;
  body?: unknown;
};

type ResponseLike = {
  setHeader(name: string, value: string): void;
  status(code: number): ResponseLike;
  json(body: unknown): void;
};

const headerValue = (value: HeaderValue): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

export default async function handler(
  request: RequestLike,
  response: ResponseLike
): Promise<void> {
  response.setHeader('cache-control', 'no-store, max-age=0');
  response.setHeader('content-type', 'application/json; charset=utf-8');

  if ((request.method ?? 'GET').toUpperCase() !== 'POST') {
    response.status(405).json({
      error: 'Método não permitido.',
      code: 'METHOD_NOT_ALLOWED',
    });
    return;
  }

  try {
    const authorization = headerValue(
      request.headers.authorization ?? request.headers.Authorization
    );
    const result = await createMarketplacePaymentIntent(
      authorization,
      request.body
    );
    response.status(result.status).json(result.body);
  } catch (error) {
    const mapped = mapMarketplaceCheckoutError(error);
    response.status(mapped.status).json(mapped.body);
  }
}
