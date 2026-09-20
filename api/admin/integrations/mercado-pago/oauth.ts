import { loadPlatformCredentialMetadata } from '../../../../server/integrations/platformCredentialStore.js';
import { authorizeIntegrationReadiness } from '../../../../server/admin/integrationReadinessService.js';
import {
  mapIntegrationCredentialError,
  saveAuthorizedMercadoPagoOAuthApplication,
} from '../../../../server/admin/integrationCredentialService.js';

interface RequestLike {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface ResponseLike {
  setHeader(name: string, value: string): void;
  status(code: number): ResponseLike;
  json(body: unknown): void;
}

const headerValue = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

const bodyRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const status = async (authorization: string) => {
  await authorizeIntegrationReadiness(authorization);
  const metadata = await loadPlatformCredentialMetadata('mercado_pago', 'production');
  return {
    configured: Boolean(
      metadata?.credentials.client_id &&
      metadata.credentials.client_secret &&
      metadata.credentials.redirect_uri
    ),
    clientIdLast4: metadata?.credentials.client_id?.last4 ?? '',
    clientSecretLast4: metadata?.credentials.client_secret?.last4 ?? '',
    redirectUriConfigured: Boolean(metadata?.credentials.redirect_uri),
  };
};

export default async function handler(
  request: RequestLike,
  response: ResponseLike
): Promise<void> {
  response.setHeader('cache-control', 'no-store, max-age=0');
  response.setHeader('content-type', 'application/json; charset=utf-8');
  const authorization = headerValue(
    request.headers.authorization ?? request.headers.Authorization
  );
  const method = (request.method ?? 'GET').toUpperCase();

  try {
    if (method === 'GET') {
      response.status(200).json(await status(authorization));
      return;
    }
    if (method === 'POST') {
      const body = bodyRecord(request.body);
      await saveAuthorizedMercadoPagoOAuthApplication({
        authorization,
        clientId: body.clientId,
        clientSecret: body.clientSecret,
        redirectUri: body.redirectUri,
      });
      response.status(200).json(await status(authorization));
      return;
    }
    response.status(405).json({ error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    const mapped = mapIntegrationCredentialError(error);
    response.status(mapped.status).json(mapped.body);
  }
}
