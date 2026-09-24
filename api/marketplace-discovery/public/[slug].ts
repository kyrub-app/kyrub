import { loadPublicStorefrontBySlug } from '../../../server/payments/marketplaceDiscoveryService.js';

type RequestLike = {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
};

type ResponseLike = {
  setHeader(name: string, value: string): void;
  status(code: number): ResponseLike;
  json(body: unknown): void;
};

const queryValue = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

export default async function handler(
  request: RequestLike,
  response: ResponseLike
): Promise<void> {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Kyrub-Route', 'public-storefront');

  if ((request.method?.toUpperCase() || 'GET') !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.status(405).json({ error: 'Método não permitido.' });
    return;
  }

  const slug = queryValue(request.query?.slug).trim();
  if (!slug) {
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.status(400).json({ error: 'Identificador da vitrine não informado.' });
    return;
  }

  try {
    const result = await loadPublicStorefrontBySlug(slug);
    if (!result) {
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.status(404).json({
        error: 'Vitrine não encontrada ou ainda não publicada.',
      });
      return;
    }

    response.setHeader(
      'Cache-Control',
      'public, max-age=20, stale-while-revalidate=60'
    );
    response.status(200).json(result);
  } catch (error) {
    console.error(
      '[public-storefront-serverless]',
      error instanceof Error ? error.message : String(error)
    );
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.status(503).json({
      error: 'A vitrine está temporariamente indisponível.',
    });
  }
}
