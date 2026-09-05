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

const isCreateProductRequest = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proposal = (value as Record<string, unknown>).proposal;
  return Boolean(
    proposal &&
    typeof proposal === 'object' &&
    !Array.isArray(proposal) &&
    (proposal as Record<string, unknown>).type === 'create_product'
  );
};

const genericUnavailable = (): HttpErrorResult => ({
  status: 503,
  body: {
    error: 'Não foi possível executar a criação do produto agora.',
    code: 'CREATE_PRODUCT_EXECUTION_UNAVAILABLE',
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

  if (!isCreateProductRequest(request.body)) {
    response.status(400).json({
      error: 'Este endpoint aceita somente criação de produto confirmada.',
      code: 'INVALID_CREATE_PRODUCT_REQUEST',
    });
    return;
  }

  const authorization = headerValue(
    request.headers.authorization ?? request.headers.Authorization
  );

  let mapError: ((error: unknown) => HttpErrorResult) | null = null;
  try {
    const actionService = await import(
      '../server/actions/actionExecutionService.js'
    );
    mapError = actionService.mapKyrubActionExecutionError;

    const [entitlementLifecycle, executablePlanCatalog] = await Promise.all([
      import('../server/admin/storeEntitlementLifecycleService.js'),
      import('../server/admin/executablePlanCatalogService.js'),
    ]);

    await entitlementLifecycle.reconcileStoreEntitlementFromAuthorization(
      authorization
    );
    await executablePlanCatalog.hydrateExecutablePlanCatalog();

    const result = await actionService.executeAuthorizedKyrubAction(
      authorization,
      request.body
    );
    response.status(200).json(result);
  } catch (error) {
    if (!mapError) {
      console.error('[CreateProductExecution] bootstrap failed.', error);
    }
    const mapped = mapError ? mapError(error) : genericUnavailable();
    response.status(mapped.status).json(mapped.body);
  }
}
