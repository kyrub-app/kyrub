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

const mercadoLivrePlatformError = (error: unknown): HttpErrorResult => {
  const message = error instanceof Error ? error.message : String(error);
  if (/AUTH_REQUIRED|id-token|expired|revoked/i.test(message)) {
    return {
      status: 401,
      body: { error: 'Faça login novamente.', code: 'AUTH_REQUIRED' },
    };
  }
  if (message === 'EMAIL_NOT_VERIFIED' || message === 'FORBIDDEN') {
    return {
      status: 403,
      body: {
        error: 'Somente Super Admin pode alterar a integração Mercado Livre da plataforma.',
        code: message,
      },
    };
  }
  if (message.startsWith('MERCADO_LIVRE_')) {
    return {
      status: 400,
      body: {
        error: 'Revise Client ID, Client Secret e Redirect URI.',
        code: message.split(':')[0],
      },
    };
  }
  if (/INTEGRATION_MASTER_KEY/i.test(message)) {
    return {
      status: 503,
      body: {
        error: 'O cofre seguro da plataforma não está disponível.',
        code: 'VAULT_UNAVAILABLE',
      },
    };
  }
  console.error('[Admin Mercado Livre Platform]', message);
  return {
    status: 503,
    body: {
      error: 'Não foi possível concluir a configuração do Mercado Livre.',
      code: 'MERCADO_LIVRE_PLATFORM_OPERATION_FAILED',
    },
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

  if (transport === 'platform-economy') {
    if (method !== 'GET') {
      response.status(405).json({ error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' });
      return;
    }
    let mapError: ((error: unknown) => HttpErrorResult) | null = null;
    try {
      const economy = await import('../../../server/admin/platformEconomyRouter.js');
      mapError = economy.mapPlatformEconomyError;
      const snapshot = await economy.loadAuthorizedPlatformEconomySnapshot(
        authorization
      );
      response.status(200).json(snapshot);
    } catch (error) {
      const mapped = mapError
        ? mapError(error)
        : unavailable('Não foi possível consultar a economia da plataforma agora.');
      response.status(mapped.status).json(mapped.body);
    }
    return;
  }

  if (
    transport === 'mercado-livre-platform-status'
    || transport === 'mercado-livre-platform-credentials'
    || transport === 'mercado-livre-platform-validate'
  ) {
    const expectedMethod = transport === 'mercado-livre-platform-status' ? 'GET' : 'POST';
    if (method !== expectedMethod) {
      response.status(405).json({ error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' });
      return;
    }

    try {
      const mercadoLivre = await import(
        '../../../server/admin/mercadoLivrePlatformCredentialService.js'
      );

      if (transport === 'mercado-livre-platform-status') {
        const status = await mercadoLivre.loadAuthorizedMercadoLivrePlatformCredentialStatus(
          authorization
        );
        response.status(200).json(status);
        return;
      }

      if (transport === 'mercado-livre-platform-credentials') {
        const body = bodyRecord(request.body);
        const status = await mercadoLivre.saveAuthorizedMercadoLivrePlatformCredentials({
          authorization,
          clientId: body.clientId,
          clientSecret: body.clientSecret,
          redirectUri: body.redirectUri,
        });
        response.status(200).json(status);
        return;
      }

      const result = await mercadoLivre.validateAuthorizedMercadoLivrePlatformConfiguration(
        authorization
      );
      response.status(200).json(result);
    } catch (error) {
      const mapped = mercadoLivrePlatformError(error);
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
