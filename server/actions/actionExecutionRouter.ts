import { Router, type Request, type Response } from 'express';
import {
  executeAuthorizedKyrubAction,
  mapKyrubActionExecutionError,
} from './actionExecutionFacade';

const handleExecutionError = (response: Response, error: unknown): void => {
  const mapped = mapKyrubActionExecutionError(error);
  response.status(mapped.status).json(mapped.body);
};

export const createKyrubActionExecutionRouter = (): Router => {
  const router = Router();

  router.post('/execute', async (request: Request, response: Response) => {
    try {
      const result = await executeAuthorizedKyrubAction(
        request.get('authorization') ?? '',
        request.body
      );
      response.json(result);
    } catch (error) {
      handleExecutionError(response, error);
    }
  });

  return router;
};
