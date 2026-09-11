import { authenticateConsultantRequest } from '../ai/consultantAuth.js';
import {
  createKyrubiaBridgeSession,
  getKyrubiaBridgeSessionStatus,
  revokeKyrubiaBridgeSession,
} from './kyrubiaBridgeSessionService.js';
import { KyrubMcpAuthError } from './kyrubiaMcpAuth.js';

export type KyrubiaBridgeHttpRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
};

export type KyrubiaBridgeHttpResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): KyrubiaBridgeHttpResponse;
  json(body: unknown): void;
};

const headerValue = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

const queryValue = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const errorStatus = (error: unknown): number => {
  if (error instanceof KyrubMcpAuthError) return error.status;
  const candidate = error as { status?: unknown } | null;
  return typeof candidate?.status === 'number' && candidate.status >= 400 && candidate.status <= 599
    ? candidate.status
    : 500;
};

const errorCode = (error: unknown): string => {
  if (error instanceof KyrubMcpAuthError) return error.code;
  const candidate = error as { code?: unknown } | null;
  return typeof candidate?.code === 'string' && candidate.code.trim()
    ? candidate.code.trim().slice(0, 100)
    : 'KYRUBIA_BRIDGE_REQUEST_FAILED';
};

export const handleKyrubiaBridgeServerlessRequest = async (
  request: KyrubiaBridgeHttpRequest,
  response: KyrubiaBridgeHttpResponse
): Promise<void> => {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Robots-Tag', 'noindex, nofollow');

  const method = (request.method ?? 'GET').toUpperCase();
  if (method !== 'POST') {
    response.status(405).json({ error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' });
    return;
  }

  const path = queryValue(request.query?.path).replace(/^\/+|\/+$/g, '');
  const authorization = headerValue(request.headers.authorization ?? request.headers.Authorization);
  const body = record(request.body);

  try {
    if (path === 'session') {
      const user = await authenticateConsultantRequest(authorization);
      const session = await createKyrubiaBridgeSession({
        user,
        ttlMinutes: body.ttlMinutes,
        label: body.label,
      });
      response.status(201).json({
        ...session,
        warning: 'Copie a credencial agora. O Kyrub armazena somente o hash e não consegue exibir o token novamente.',
      });
      return;
    }

    if (path === 'session/status') {
      response.status(200).json(await getKyrubiaBridgeSessionStatus(authorization));
      return;
    }

    if (path === 'session/revoke') {
      response.status(200).json(await revokeKyrubiaBridgeSession(authorization));
      return;
    }

    response.status(404).json({
      error: 'Rota da ponte Kyrubia não encontrada.',
      code: 'KYRUBIA_BRIDGE_ROUTE_NOT_FOUND',
    });
  } catch (error) {
    const status = errorStatus(error);
    console.warn('[Kyrubia bridge] request rejected', {
      path,
      status,
      code: errorCode(error),
    });
    response.status(status).json({
      error: status === 500
        ? 'Não foi possível concluir a solicitação da ponte Kyrubia.'
        : error instanceof Error
          ? error.message
          : 'Solicitação rejeitada.',
      code: errorCode(error),
    });
  }
};
