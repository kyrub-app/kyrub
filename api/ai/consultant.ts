import type {
  KyrubAiConsultantErrorResponse,
} from '../../shared/aiConsultant';
import { authenticateConsultantRequest } from '../../server/ai/consultantAuth';
import { runKyrubConsultant } from '../../server/ai/consultantService';
import { ConsultantHttpError } from '../../server/ai/types';

const json = (body: unknown, status = 200): Response =>
  Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  });

const errorResponse = (error: unknown): Response => {
  if (error instanceof ConsultantHttpError) {
    const payload: KyrubAiConsultantErrorResponse = {
      error: error.message,
      code: error.code,
    };
    return json(payload, error.status);
  }

  console.error('[Kyrub AI] Unhandled Vercel function failure.', error);
  const payload: KyrubAiConsultantErrorResponse = {
    error: 'O Consultor Kyrub está temporariamente indisponível.',
    code: 'AI_UNAVAILABLE',
  };
  return json(payload, 503);
};

export const maxDuration = 30;

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      const payload: KyrubAiConsultantErrorResponse = {
        error: 'Método não permitido.',
        code: 'METHOD_NOT_ALLOWED',
      };
      return json(payload, 405);
    }

    try {
      const user = await authenticateConsultantRequest(
        request.headers.get('authorization')
      );
      const body = await request.json().catch(() => ({}));
      return json(await runKyrubConsultant(body, user));
    } catch (error) {
      return errorResponse(error);
    }
  },
};
