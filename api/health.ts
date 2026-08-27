import {
  handleKyrubMcpRequest,
  type KyrubMcpHttpRequest,
  type KyrubMcpHttpResponse,
} from '../server/mcp/kyrubiaMcpServer.js';

type RequestLike = KyrubMcpHttpRequest & {
  query?: Record<string, string | string[] | undefined>;
};

type ResponseLike = KyrubMcpHttpResponse;

export type KyrubHealthPayload = {
  status: 'ok';
  service: 'kyrub';
  environment: string;
  release: string;
  timestamp: string;
  capabilities: {
    kyrubia: 'configured' | 'unconfigured';
  };
};

const releaseIdentifier = (): string =>
  process.env.KYRUB_RELEASE?.trim()
  || process.env.VERCEL_GIT_COMMIT_SHA?.trim().slice(0, 12)
  || process.env.npm_package_version?.trim()
  || 'development';

export const buildKyrubHealthPayload = (
  now: Date = new Date()
): KyrubHealthPayload => ({
  status: 'ok',
  service: 'kyrub',
  environment: process.env.VERCEL_ENV?.trim()
    || process.env.NODE_ENV?.trim()
    || 'development',
  release: releaseIdentifier(),
  timestamp: now.toISOString(),
  capabilities: {
    kyrubia: process.env.GEMINI_API_KEY?.trim()
      ? 'configured'
      : 'unconfigured',
  },
});

const queryValue = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

const headerValue = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

const safeLogIdentifier = (value: unknown): string => {
  const cleaned = typeof value === 'string' ? value.trim() : '';
  return /^[a-zA-Z0-9:_-]{1,160}$/.test(cleaned) ? cleaned : '';
};

export default async function handler(
  request: RequestLike,
  response: ResponseLike
): Promise<void> {
  const transport = queryValue(request.query?.transport);
  if (transport === 'mcp') {
    await handleKyrubMcpRequest(request, response);
    return;
  }

  if (transport === 'activity-events') {
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    if ((request.method?.toUpperCase() || 'GET') !== 'POST') {
      response.status(405).json({
        error: 'Método não permitido.',
        code: 'METHOD_NOT_ALLOWED',
      });
      return;
    }
    try {
      const activity = await import(
        '../server/observability/kyrubActivityTransport.js'
      );
      const result = await activity.receiveAuthorizedKyrubActivityEvents(
        headerValue(request.headers.authorization ?? request.headers.Authorization),
        request.body
      );
      response.status(200).json(result);
    } catch (error) {
      console.warn('[activity-transport] rejected', error instanceof Error ? error.message : 'unknown');
      response.status(401).json({
        error: 'Não foi possível registrar a atividade desta sessão.',
        code: 'ACTIVITY_TRANSPORT_REJECTED',
      });
    }
    return;
  }

  if (transport === 'order-status-execute' || transport === 'pickup-code-read') {
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    if ((request.method?.toUpperCase() || 'GET') !== 'POST') {
      response.status(405).json({
        error: 'Método não permitido.',
        code: 'METHOD_NOT_ALLOWED',
      });
      return;
    }

    const execution = await import(
      '../server/inventory/orderStatusExecutionService.js'
    );
    const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
      ? { ...(request.body as Record<string, unknown>) }
      : {};
    body.orderId = queryValue(request.query?.orderId) || body.orderId;

    if (transport === 'pickup-code-read') {
      body.storeId = queryValue(request.query?.storeId) || body.storeId;
      const result = await execution.executeAuthorizedPickupCodeRead(
        headerValue(request.headers.authorization ?? request.headers.Authorization),
        body
      );
      console.info('[pickup-code-read]', JSON.stringify({
        orderId: safeLogIdentifier(body.orderId),
        storeId: safeLogIdentifier(body.storeId),
        httpStatus: result.status,
      }));
      response.status(result.status).json(result.body);
      return;
    }

    const result = await execution.executeAuthorizedOrderStatusTransition(
      headerValue(request.headers.authorization ?? request.headers.Authorization),
      body
    );
    console.info('[order-status]', JSON.stringify({
      orderId: safeLogIdentifier(body.orderId),
      nextStatus: safeLogIdentifier(body.status),
      httpStatus: result.status,
    }));
    response.status(result.status).json(result.body);
    return;
  }

  const method = request.method?.toUpperCase() || 'GET';

  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (method !== 'GET') {
    response.status(405).json({
      error: 'Método não permitido.',
      code: 'METHOD_NOT_ALLOWED',
    });
    return;
  }

  response.status(200).json(buildKyrubHealthPayload());
}
