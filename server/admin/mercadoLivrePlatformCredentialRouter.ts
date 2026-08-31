import { Router } from 'express';
import {
  loadAuthorizedMercadoLivrePlatformCredentialStatus,
  saveAuthorizedMercadoLivrePlatformCredentials,
  validateAuthorizedMercadoLivrePlatformConfiguration,
} from './mercadoLivrePlatformCredentialService.js';

const mapError = (error: unknown): { status: number; message: string; code: string } => {
  const message = error instanceof Error ? error.message : String(error);
  if (/AUTH_REQUIRED|id-token|expired|revoked/i.test(message)) {
    return { status: 401, message: 'Faça login novamente.', code: 'AUTH_REQUIRED' };
  }
  if (message === 'EMAIL_NOT_VERIFIED' || message === 'FORBIDDEN') {
    return { status: 403, message: 'Somente Super Admin pode alterar a integração Mercado Livre da plataforma.', code: message };
  }
  if (message.startsWith('MERCADO_LIVRE_')) {
    return { status: 400, message: 'Revise Client ID, Client Secret e Redirect URI.', code: message };
  }
  if (/INTEGRATION_MASTER_KEY/i.test(message)) {
    return { status: 503, message: 'O cofre seguro da plataforma não está disponível.', code: 'VAULT_UNAVAILABLE' };
  }
  console.error('[Admin Mercado Livre Platform]', error);
  return { status: 503, message: 'Não foi possível concluir a configuração do Mercado Livre.', code: 'MERCADO_LIVRE_PLATFORM_OPERATION_FAILED' };
};

export const createMercadoLivrePlatformCredentialRouter = (): Router => {
  const router = Router();

  router.get('/status', async (request, response) => {
    try {
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await loadAuthorizedMercadoLivrePlatformCredentialStatus(request.get('authorization') ?? ''));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  router.post('/credentials', async (request, response) => {
    try {
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await saveAuthorizedMercadoLivrePlatformCredentials({
        authorization: request.get('authorization') ?? '',
        clientId: request.body?.clientId,
        clientSecret: request.body?.clientSecret,
        redirectUri: request.body?.redirectUri,
      }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  router.post('/validate', async (request, response) => {
    try {
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await validateAuthorizedMercadoLivrePlatformConfiguration(request.get('authorization') ?? ''));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  return router;
};
