import {
  loadAuthorizedOperationsHealth,
  mapOperationsHealthError,
} from '../../../server/admin/operationsHealthRouter.js';
import {
  loadAuthorizedIntegrationReadiness,
  mapIntegrationReadinessError,
} from '../../../server/admin/integrationReadinessService.js';
import {
  mapIntegrationCredentialError,
  saveAuthorizedMercadoPagoCredentials,
  testAuthorizedMercadoPagoConnection,
} from '../../../server/admin/integrationCredentialService.js';

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

const headerValue = (value: HeaderValue | QueryValue): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

const bodyRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

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
    try {
      const snapshot = await loadAuthorizedIntegrationReadiness(authorization);
      response.status(200).json(snapshot);
    } catch (error) {
      const mapped = mapIntegrationReadinessError(error);
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
    try {
      const credential = await saveAuthorizedMercadoPagoCredentials({
        authorization,
        accessToken: body.accessToken,
        webhookSecret: body.webhookSecret,
      });
      response.status(200).json({ ok: true, credential });
    } catch (error) {
      const mapped = mapIntegrationCredentialError(error);
      response.status(mapped.status).json(mapped.body);
    }
    return;
  }

  if (transport === 'mercado-pago-test') {
    if (method !== 'POST') {
      response.status(405).json({ error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' });
      return;
    }
    try {
      const result = await testAuthorizedMercadoPagoConnection(authorization);
      response.status(result.ok ? 200 : 422).json(result);
    } catch (error) {
      const mapped = mapIntegrationCredentialError(error);
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

  try {
    const snapshot = await loadAuthorizedOperationsHealth(authorization);
    response.status(200).json(snapshot);
  } catch (error) {
    const mapped = mapOperationsHealthError(error);
    response.status(mapped.status).json(mapped.body);
  }
}
