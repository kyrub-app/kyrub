import { Router, type Request, type Response } from 'express';
import type { KyrubAiConsultantErrorResponse } from '../../shared/aiConsultant';
import { authenticateConsultantRequest } from './consultantAuth';
import { runKyrubConsultant } from './consultantService';
import { ConsultantHttpError } from './types';

const sendConsultantError = (
  response: Response,
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

  console.error('[Kyrub AI] Unhandled consultant route failure.', error);
  const payload: KyrubAiConsultantErrorResponse = {
    error: 'O Consultor Kyrub está temporariamente indisponível.',
    code: 'AI_UNAVAILABLE',
  };
  response.status(503).json(payload);
};

export const createKyrubAiConsultantRouter = (): Router => {
  const router = Router();

  router.post('/', async (request: Request, response: Response) => {
    try {
      const user = await authenticateConsultantRequest(
        request.get('authorization')
      );
      response.json(await runKyrubConsultant(request.body, user));
    } catch (error) {
      sendConsultantError(response, error);
    }
  });

  return router;
};
