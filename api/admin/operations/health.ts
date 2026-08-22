type HeaderValue = string | string[] | undefined;
type QueryValue = string | string[] | undefined;

type RequestLike = {
  method?: string;
  headers: Record<string, HeaderValue>;
  query?: Record<string, QueryValue>;
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

const headerValue = (value: HeaderValue | QueryValue): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

const bodyRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const unavailable = (message: string): HttpErrorResult => ({
  status: 503,
  body: { error: message, code: 'ADMIN_RUNTIME_UNAVAILABLE' },
});

export default async function handler(
  request: RequestLike,
  response: ResponseLike
): Promise<void> {
  response.setHeader('cache-control', 'no-store, max-age=0');
  response.setHeader('content-type', 'application/json; charset=utf-8');

  const authorization = headerValue(
    request.headers.authorization ?? request.headers.Authorization
  );
  const transport = headerValue(request.query?.transport);
  const method = (request.method ?? 'GET').toUpperCase();

  if (transport === 'integration-readiness') {
    if (method !== 'GET') {
      response.status(405).json({ error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' });
      return;
    }
    let mapError: ((error: unknown) => HttpErrorResult) | null = null;
    try {
      const readiness = await import('../../../server/admin/integrationReadinessService.js');
      mapError = readiness.mapIntegrationReadinessError;
      const snapshot = await readiness.loadAuthorizedIntegrationReadiness(authorization);
      response.status(200).json(snapshot);
    } catch (error) {
      const mapped = mapError
        ? mapError(error)
        : unavailable('Não foi possível consultar as integrações agora.');
      response.status(mapped.status).json(mapped.body);
    }
    return;
  }

  if (transport === 'mercado-pago-credentials') {
    if (method !== 'POST') {
      response.status(405).json({ error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' });
      return;
    }
    const body = bodyRecord(request.body);
    let mapError: ((error: unknown) => HttpErrorResult) | null = null;
    try {
      const credentials = await import('../../../server/admin/integrationCredentialService.js');
      mapError = credentials.mapIntegrationCredentialError;
      const credential = await credentials.saveAuthorizedMercadoPagoCredentials({
        authorization,
        accessToken: body.accessToken,
        webhookSecret: body.webhookSecret,
      });
      response.status(200).json({ ok: true, credential });
    } catch (error) {
      const mapped = mapError
        ? mapError(error)
        : unavailable('Não foi possível salvar a credencial agora.');
      response.status(mapped.status).json(mapped.body);
    }
    return;
  }

  if (transport === 'mercado-pago-test') {
    if (method !== 'POST') {
      response.status(405).json({ error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' });
      return;
    }
    let mapError: ((error: unknown) => HttpErrorResult) | null = null;
    try {
      const credentials = await import('../../../server/admin/integrationCredentialService.js');
      mapError = credentials.mapIntegrationCredentialError;
      const result = await credentials.testAuthorizedMercadoPagoConnection(authorization);
      response.status(result.ok ? 200 : 422).json(result);
    } catch (error) {
      const mapped = mapError
        ? mapError(error)
        : unavailable('Não foi possível testar a integração agora.');
      response.status(mapped.status).json(mapped.body);
    }
    return;
  }

  if (method !== 'GET') {
    response.status(405).json({
      error: 'Método não permitido.',
      code: 'METHOD_NOT_ALLOWED',
    });
    return;
  }

  let mapError: ((error: unknown) => HttpErrorResult) | null = null;
  try {
    const operations = await import('../../../server/admin/operationsHealthRouter.js');
    mapError = operations.mapOperationsHealthError;
    const snapshot = await operations.loadAuthorizedOperationsHealth(authorization);
    response.status(200).json(snapshot);
  } catch (error) {
    const mapped = mapError
      ? mapError(error)
      : unavailable('Não foi possível consultar a saúde operacional agora.');
    response.status(mapped.status).json(mapped.body);
  }
}
