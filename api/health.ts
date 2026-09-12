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

const createTraceId = (): string =>
  `kyrub-route-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const requestTraceId = (request: RequestLike): string =>
  safeLogIdentifier(
    headerValue(
      request.headers['x-kyrub-request-id']
      ?? request.headers['X-Kyrub-Request-Id']
    )
  ) || createTraceId();

export default async function handler(
  request: RequestLike,
  response: ResponseLike
): Promise<void> {
  const traceId = requestTraceId(request);
  const transport = queryValue(request.query?.transport);
  response.setHeader('X-Kyrub-Release', releaseIdentifier());
  response.setHeader('X-Kyrub-Request-Id', traceId);
  response.setHeader('X-Kyrub-Route', 'health-multiplexer');
  response.setHeader('X-Kyrub-Decision', transport || 'health');

  if (transport === 'mcp') {
    await handleKyrubMcpRequest(request, response);
    return;
  }

  if (transport === 'kyrubia-bridge') {
    try {
      const bridge = await import('../server/mcp/kyrubiaBridgeServerlessTransport.js');
      await bridge.handleKyrubiaBridgeServerlessRequest(request, response);
    } catch (error) {
      console.error('[kyrubia-bridge-transport]', JSON.stringify({
        requestId: traceId,
        error: error instanceof Error ? error.message : 'unknown',
      }));
      response.setHeader('X-Kyrub-Decision', 'kyrubia_bridge_transport_error');
      response.status(503).json({
        error: 'A ponte externa da Kyrubia está temporariamente indisponível.',
        code: 'KYRUBIA_BRIDGE_TRANSPORT_UNAVAILABLE',
        requestId: traceId,
      });
    }
    return;
  }

  if (transport === 'kyrubia-user-ai-chat') {
    console.info('[kyrubia-user-ai-chat-entry]', JSON.stringify({
      requestId: traceId,
      release: releaseIdentifier(),
      transport,
      method: request.method?.toUpperCase() || 'GET',
    }));
    try {
      const chat = await import('../server/ai/kyrubiaUserAiChatServerlessTransport.js');
      await chat.handleKyrubiaUserAiChatServerlessRequest(request, response);
    } catch (error) {
      console.error('[kyrubia-user-ai-chat-transport]', JSON.stringify({
        requestId: traceId,
        error: error instanceof Error ? error.message : 'unknown',
      }));
      response.setHeader('X-Kyrub-Decision', 'kyrubia_user_ai_chat_transport_error');
      response.status(503).json({
        error: 'A conversa da Kyrubia está temporariamente indisponível.',
        code: 'KYRUBIA_USER_AI_CHAT_TRANSPORT_UNAVAILABLE',
        requestId: traceId,
      });
    }
    return;
  }

  if (transport === 'store-connections') {
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    try {
      const storeConnections = await import(
        '../server/integrations/storeConnectionsServerlessTransport.js'
      );
      await storeConnections.handleStoreConnectionsServerlessRequest(
        request,
        response
      );
    } catch (error) {
      console.error(
        '[store-connections-transport]',
        error instanceof Error ? error.message : String(error)
      );
      response.status(503).json({
        error: 'A integração de canais está temporariamente indisponível.',
        code: 'STORE_CONNECTION_TRANSPORT_UNAVAILABLE',
      });
    }
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