import type {
  KyrubAiConsultantErrorResponse,
} from '../shared/aiConsultant';
import { authenticateConsultantRequest } from '../server/ai/consultantAuth';
import { runKyrubConsultant } from '../server/ai/consultantService';
import { ConsultantHttpError } from '../server/ai/types';

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

const sendError = (
  response: VercelResponseLike,
  error: unknown
): void => {
  if (error instanceof ConsultantHttpError) {
    const payload: KyrubAiConsultantErrorResponse = {
      error: error.message,
      code: error.code,
    };
    response.status(error.status).json(payload);
    return;
  }

  console.error('[Kyrub AI] Unhandled root Vercel function failure.', error);
  const payload: KyrubAiConsultantErrorResponse = {
    error: 'O Consultor Kyrub está temporariamente indisponível.',
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
    const user = await authenticateConsultantRequest(
      authorizationHeader(request)
    );
    const result = await runKyrubConsultant(requestBody(request.body), user);
    response.status(200).json(result);
  } catch (error) {
    sendError(response, error);
  }
}
