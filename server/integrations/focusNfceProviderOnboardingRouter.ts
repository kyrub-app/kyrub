import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import {
  configureOrRotateFocusNfceProvider,
  deactivateFocusNfceProvider,
  loadFocusNfceProviderReadiness,
  reactivateFocusNfceProvider,
} from './focusNfceProviderOnboardingService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const authenticatedOwner = async (authorization: string, storeId: string) => {
  const token = bearerToken(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const identity = await verifyFirebaseIdToken(token);
  if (identity.uid !== storeId) throw new Error('STORE_CONNECTION_FORBIDDEN');
  return identity;
};

const mapError = (error: unknown): { status: number; message: string } => {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'AUTH_REQUIRED') {
    return { status: 401, message: 'Faça login novamente.' };
  }
  if (code === 'STORE_CONNECTION_FORBIDDEN') {
    return { status: 403, message: 'Você não pode administrar o provedor fiscal desta loja.' };
  }
  if (code === 'FISCAL_PROVIDER_CANONICAL_STORE_REQUIRED') {
    return { status: 409, message: 'A loja canônica precisa estar resolvida antes de configurar o provedor fiscal.' };
  }
  if (code === 'FOCUS_SANDBOX_TOKEN_REQUIRED' || code === 'FOCUS_SANDBOX_TOKEN_INVALID') {
    return { status: 400, message: 'Informe uma credencial de homologação válida da Focus.' };
  }
  if (code === 'FISCAL_PROVIDER_NOT_CONFIGURED') {
    return { status: 404, message: 'A Focus NFC-e ainda não está configurada para esta loja.' };
  }
  if (
    code === 'FISCAL_PROVIDER_CREDENTIAL_MISSING' ||
    code === 'FISCAL_PROVIDER_CONFIGURATION_INACTIVE' ||
    code === 'FISCAL_PROVIDER_CONFIGURATION_INVALID'
  ) {
    return { status: 409, message: 'A configuração fiscal protegida precisa ser revisada antes de continuar.' };
  }
  if (
    code === 'KYRUB_CREDENTIAL_VAULT_DISABLED' ||
    code === 'FIREBASE_ADMIN_PROJECT_ID_UNAVAILABLE' ||
    code.startsWith('KYRUB_VAULT_')
  ) {
    return { status: 503, message: 'O cofre seguro de credenciais fiscais não está disponível agora.' };
  }
  return { status: 503, message: 'Não foi possível atualizar a configuração fiscal protegida agora.' };
};

export const createFocusNfceProviderOnboardingRouter = (): Router => {
  const router = Router();

  router.get('/:storeId', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      const identity = await authenticatedOwner(request.get('authorization') ?? '', storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await loadFocusNfceProviderReadiness({
        tenantId: identity.uid,
        requestedByUserId: identity.uid,
      }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.put('/:storeId', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      const identity = await authenticatedOwner(request.get('authorization') ?? '', storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await configureOrRotateFocusNfceProvider({
        tenantId: identity.uid,
        requestedByUserId: identity.uid,
        token: typeof request.body?.token === 'string' ? request.body.token : '',
      }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.post('/:storeId/deactivate', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      const identity = await authenticatedOwner(request.get('authorization') ?? '', storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await deactivateFocusNfceProvider({
        tenantId: identity.uid,
        requestedByUserId: identity.uid,
      }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.post('/:storeId/reactivate', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      const identity = await authenticatedOwner(request.get('authorization') ?? '', storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await reactivateFocusNfceProvider({
        tenantId: identity.uid,
        requestedByUserId: identity.uid,
      }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  return router;
};
