import {
  loadAuthorizedOperationsHealth,
  mapOperationsHealthError,
} from '../../../server/admin/operationsHealthRouter.js';
import {
  loadAuthorizedIntegrationReadiness,
  mapIntegrationReadinessError,
} from '../../../server/admin/integrationReadinessService.js';

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

const headerValue = (value: HeaderValue | QueryValue): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

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
  const transport = headerValue(request.query?.transport);

  if (transport === 'integration-readiness') {
    try {
      const snapshot = await loadAuthorizedIntegrationReadiness(authorization);
      response.status(200).json(snapshot);
    } catch (error) {
      const mapped = mapIntegrationReadinessError(error);
      response.status(mapped.status).json(mapped.body);
    }
    return;
  }

  try {
    const snapshot = await loadAuthorizedOperationsHealth(authorization);
    response.status(200).json(snapshot);
  } catch (error) {
    const mapped = mapOperationsHealthError(error);
    response.status(mapped.status).json(mapped.body);
  }
}
