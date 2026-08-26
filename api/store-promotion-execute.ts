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

type HttpErrorResult = {
  status: number;
  body: unknown;
};

const headerValue = (value: HeaderValue): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

const genericUnavailable = (): HttpErrorResult => ({
  status: 503,
  body: {
    error: 'Não foi possível publicar a promoção agora.',
    code: 'STORE_PROMOTION_EXECUTION_UNAVAILABLE',
  },
});

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

  const authorization = headerValue(
    request.headers.authorization ?? request.headers.Authorization
  );

  let mapError: ((error: unknown) => HttpErrorResult) | null = null;
  try {
    const [promotion, actionService] = await Promise.all([
      import('../server/actions/storePromotionExecutionService.js'),
      import('../server/actions/actionExecutionService.js'),
    ]);
    mapError = actionService.mapKyrubActionExecutionError;

    if (!promotion.isKyrubStorePromotionExecutionRequest(request.body)) {
      response.status(400).json({
        error: 'A promoção precisa ser revisada e confirmada.',
        code: 'INVALID_STORE_PROMOTION_REQUEST',
      });
      return;
    }

    const result = await promotion.executeAuthorizedKyrubStorePromotion(
      authorization,
      request.body
    );
    response.status(200).json(result);
  } catch (error) {
    console.error('[StorePromotionExecution]', error);
    const mapped = mapError ? mapError(error) : genericUnavailable();
    response.status(mapped.status).json(mapped.body);
  }
}
