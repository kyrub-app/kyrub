import { Router } from 'express';
import {
  loadAuthorizedNinetyNineFoodPlatformCredentialStatus,
  saveAuthorizedNinetyNineFoodPlatformCredentials,
  validateAuthorizedNinetyNineFoodPlatformConfiguration,
} from './ninetyNineFoodPlatformCredentialService.js';

const mapError = (error: unknown): { status: number; message: string; code: string } => {
  const message = error instanceof Error ? error.message : String(error);
  if (/AUTH_REQUIRED|id-token|expired|revoked/i.test(message)) {
    return { status: 401, message: 'Faça login novamente.', code: 'AUTH_REQUIRED' };
  }
  if (message === 'EMAIL_NOT_VERIFIED' || message === 'FORBIDDEN') {
    return { status: 403, message: 'Somente Super Admin pode alterar a integração 99Food da plataforma.', code: message };
  }
  if (message.startsWith('NINETY_NINE_FOOD_')) {
    return { status: 400, message: 'Revise a configuração técnica da 99Food.', code: message };
  }
  if (/INTEGRATION_MASTER_KEY/i.test(message)) {
    return { status: 503, message: 'O cofre seguro da plataforma não está disponível.', code: 'VAULT_UNAVAILABLE' };
  }
  console.error('[Admin 99Food Platform]', error);
  return { status: 503, message: 'Não foi possível concluir a configuração da 99Food.', code: 'NINETY_NINE_FOOD_PLATFORM_OPERATION_FAILED' };
};

export const createNinetyNineFoodPlatformCredentialRouter = (): Router => {
  const router = Router();

  router.get('/status', async (request, response) => {
    try {
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await loadAuthorizedNinetyNineFoodPlatformCredentialStatus(
        request.get('authorization') ?? '',
        request.query.environment
      ));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  router.post('/credentials', async (request, response) => {
    try {
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await saveAuthorizedNinetyNineFoodPlatformCredentials({
        authorization: request.get('authorization') ?? '',
        environment: request.body?.environment,
        clientId: request.body?.clientId,
        clientSecret: request.body?.clientSecret,
        baseUrl: request.body?.baseUrl,
        tokenUrl: request.body?.tokenUrl,
      }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  router.post('/validate', async (request, response) => {
    try {
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await validateAuthorizedNinetyNineFoodPlatformConfiguration({
        authorization: request.get('authorization') ?? '',
        environment: request.body?.environment,
      }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  return router;
};
