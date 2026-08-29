type HeaderValue = string | string[] | undefined;

type RequestLike = {
  method?: string;
  headers: Record<string, HeaderValue>;
};

type ResponseLike = {
  setHeader(name: string, value: string): void;
  status(code: number): ResponseLike;
  json(body: unknown): void;
};

type HttpErrorResult = {
  status: number;
  body: unknown;
};

const headerValue = (value: HeaderValue): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

const unavailable = (): HttpErrorResult => ({
  status: 503,
  body: {
    error: 'Não foi possível consultar a economia da plataforma agora.',
    code: 'PLATFORM_ECONOMY_UNAVAILABLE',
  },
});

export default async function handler(
  request: RequestLike,
  response: ResponseLike
): Promise<void> {
  response.setHeader('cache-control', 'no-store, max-age=0');
  response.setHeader('content-type', 'application/json; charset=utf-8');

  if ((request.method ?? 'GET').toUpperCase() !== 'GET') {
    response.status(405).json({
      error: 'Método não permitido.',
      code: 'METHOD_NOT_ALLOWED',
    });
    return;
  }

  const authorization = headerValue(
    request.headers.authorization ?? request.headers.Authorization
  );

  let mapError: ((error: unknown) => HttpErrorResult) | null = null;
  try {
    const economy = await import('../../server/admin/platformEconomyRouter.js');
    mapError = economy.mapPlatformEconomyError;
    const snapshot = await economy.loadAuthorizedPlatformEconomySnapshot(
      authorization
    );
    response.status(200).json(snapshot);
  } catch (error) {
    const mapped = mapError ? mapError(error) : unavailable();
    response.status(mapped.status).json(mapped.body);
  }
}
