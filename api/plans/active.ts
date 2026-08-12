import { loadPublicActivePlanCatalog } from '../../server/admin/publicPlanCatalogService.js';

type RequestLike = { method?: string };
type ResponseLike = {
  setHeader(name: string, value: string): void;
  status(code: number): ResponseLike;
  json(body: unknown): void;
};

export default async function handler(
  request: RequestLike,
  response: ResponseLike
): Promise<void> {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader(
    'cache-control',
    'public, max-age=0, s-maxage=60, stale-while-revalidate=300'
  );

  if ((request.method ?? 'GET').toUpperCase() !== 'GET') {
    response.status(405).json({
      error: 'Método não permitido.',
      code: 'METHOD_NOT_ALLOWED',
    });
    return;
  }

  const snapshot = await loadPublicActivePlanCatalog();
  response.status(200).json(snapshot);
}
