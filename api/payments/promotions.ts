type HeaderValue = string | string[] | undefined;
type QueryValue = string | string[] | undefined;

type RequestLike = {
  method?: string;
  headers: Record<string, HeaderValue>;
  query?: Record<string, QueryValue>;
};

type ResponseLike = {
  setHeader(name: string, value: string): void;
  status(code: number): ResponseLike;
  json(body: unknown): void;
};

const headerValue = (value: QueryValue): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export default async function handler(
  request: RequestLike,
  response: ResponseLike
): Promise<void> {
  response.setHeader('cache-control', 'no-store, max-age=0');
  response.setHeader('content-type', 'application/json; charset=utf-8');

  if ((request.method ?? 'GET').toUpperCase() !== 'GET') {
    response.status(405).json({ error: 'Método não permitido.' });
    return;
  }

  const storeId = clean(headerValue(request.query?.storeId));
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(storeId)) {
    response.status(400).json({ error: 'Loja não identificada.' });
    return;
  }

  try {
    const [{ adminDb }, promotions] = await Promise.all([
      import('../../server/firebaseAdmin.js'),
      import('../../server/payments/storePromotionService.js'),
    ]);
    const tenantSnapshot = await adminDb.doc(`tenants/${storeId}`).get();
    const tenant = tenantSnapshot.data() as Record<string, unknown> | undefined;
    if (!tenantSnapshot.exists || tenant?.publicationStatus !== 'published') {
      response.status(404).json({ error: 'A loja não está disponível.' });
      return;
    }

    response.status(200).json({
      promotions: await promotions.listPublicStorePromotions(storeId),
    });
  } catch (error) {
    console.error('[Marketplace Promotions]', error);
    response.status(503).json({
      error: 'Não foi possível consultar as promoções agora.',
    });
  }
}