import type {
  KyrubAiConsultantErrorCode,
  KyrubAiConsultantErrorResponse,
} from '../shared/aiConsultant';

type HeaderValue = string | string[] | undefined;

type VercelRequestLike = {
  method?: string;
  headers: Record<string, HeaderValue>;
  body?: unknown;
};

type VercelResponseLike = {
  setHeader(name: string, value: string): void;
  status(code: number): VercelResponseLike;
  json(body: unknown): void;
};

type StructuredConsultantError = {
  status: number;
  code: KyrubAiConsultantErrorCode;
  message: string;
};

const authorizationHeader = (request: VercelRequestLike): string => {
  const value = request.headers.authorization;
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
};

const requestBody = (value: unknown): unknown => {
  if (typeof value !== 'string') return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

const readStructuredError = (
  error: unknown
): StructuredConsultantError | null => {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as Record<string, unknown>;
  const status = Number(candidate.status);
  const code = typeof candidate.code === 'string' ? candidate.code : '';
  const message = typeof candidate.message === 'string'
    ? candidate.message.trim()
    : '';

  if (
    !Number.isInteger(status) ||
    status < 400 ||
    status > 599 ||
    !code ||
    !message
  ) {
    return null;
  }

  return {
    status,
    code: code as KyrubAiConsultantErrorCode,
    message,
  };
};

const sendError = (
  response: VercelResponseLike,
  error: unknown
): void => {
  const structured = readStructuredError(error);
  if (structured) {
    const payload: KyrubAiConsultantErrorResponse = {
      error: structured.message,
      code: structured.code,
    };
    response.status(structured.status).json(payload);
    return;
  }

  console.error('[Kyrub AI] Unhandled root Vercel function failure.', error);
  const payload: KyrubAiConsultantErrorResponse = {
    error: 'O servidor da Kyrub I.A encontrou uma falha temporária ao iniciar o Consultor.',
    code: 'AI_UNAVAILABLE',
  };
  response.status(503).json(payload);
};

export const maxDuration = 30;

export default async function handler(
  request: VercelRequestLike,
  response: VercelResponseLike
): Promise<void> {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-type', 'application/json; charset=utf-8');

  if (request.method === 'GET') {
    response.status(200).json({
      status: 'ok',
      service: 'consultor-kyrub',
      configured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      model: process.env.GEMINI_MODEL?.trim() || 'gemini-3.6-flash',
      actionsEnabled: false,
    });
    return;
  }

  if (request.method !== 'POST') {
    const payload: KyrubAiConsultantErrorResponse = {
      error: 'Método não permitido.',
      code: 'METHOD_NOT_ALLOWED',
    };
    response.status(405).json(payload);
    return;
  }

  try {
    const [authModule, consultantModule] = await Promise.all([
      import('../server/ai/consultantAuth'),
      import('../server/ai/consultantService'),
    ]);
    const user = await authModule.authenticateConsultantRequest(
      authorizationHeader(request)
    );
    const result = await consultantModule.runKyrubConsultant(
      requestBody(request.body),
      user
    );
    response.status(200).json(result);
  } catch (error) {
    sendError(response, error);
  }
}
