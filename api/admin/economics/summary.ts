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

type HttpErrorResult = { status: number; body: unknown };

const first = (value: HeaderValue | QueryValue): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

export default async function handler(
  request: RequestLike,
  response: ResponseLike
): Promise<void> {
  response.setHeader('cache-control', 'no-store, max-age=0');
  response.setHeader('content-type', 'application/json; charset=utf-8');

  if ((request.method ?? 'GET').toUpperCase() !== 'GET') {
    response.status(405).json({ error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' });
    return;
  }

  let mapError: ((error: unknown) => HttpErrorResult) | null = null;
  try {
    const economics = await import('../../../server/admin/platformEconomicsRouter.js');
    mapError = economics.mapPlatformEconomicsError;
    const summary = await economics.loadAuthorizedPlatformEconomics(
      first(request.headers.authorization ?? request.headers.Authorization),
      {
        from: first(request.query?.from),
        to: first(request.query?.to),
        storeId: first(request.query?.storeId),
      }
    );
    response.status(200).json(summary);
  } catch (error) {
    const mapped = mapError
      ? mapError(error)
      : {
          status: 503,
          body: {
            error: 'Não foi possível consultar a economia da plataforma agora.',
            code: 'ADMIN_RUNTIME_UNAVAILABLE',
          },
        };
    response.status(mapped.status).json(mapped.body);
  }
}
