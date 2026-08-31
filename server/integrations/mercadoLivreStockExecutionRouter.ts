import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { executeAuthorizedMercadoLivreStockUpdate } from './mercadoLivreStockUpdateExecutionService.js';
import { reconcileMercadoLivreStockUpdate } from './mercadoLivreStockUpdateReconciliationService.js';

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

const errorCode = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).split(':')[0].slice(0, 100);

const mapError = (error: unknown): { status: number; message: string; code: string } => {
  const code = errorCode(error);
  if (code === 'AUTH_REQUIRED') return { status: 401, message: 'Faça login novamente.', code };
  if (code === 'STORE_CONNECTION_FORBIDDEN') return { status: 403, message: 'Você não pode administrar esta operação.', code };
  if (code.includes('NOT_FOUND')) return { status: 404, message: 'O registro selecionado não foi encontrado.', code };
  if (
    code.includes('INVALID') ||
    code.includes('CONFLICT') ||
    code.includes('STALE') ||
    code.includes('EXPIRED') ||
    code.includes('ALREADY_CONSUMED') ||
    code.includes('TARGET_NOT_OBSERVED') ||
    code.includes('RECONCILIATION_REQUIRED') ||
    code.includes('MODE_STALE') ||
    code.includes('IDENTITY_MISMATCH')
  ) {
    return { status: 409, message: 'A operação de estoque não pode avançar no estado atual.', code };
  }
  if (code.includes('CONNECTION_INVALID')) {
    return { status: 409, message: 'Conecte sua conta do Mercado Livre antes de continuar.', code };
  }
  console.error('[Mercado Livre Stock Execution]', code);
  return { status: 503, message: 'A integração Mercado Livre está temporariamente indisponível.', code };
};

export const createMercadoLivreStockExecutionRouter = (): Router => {
  const router = Router();

  router.post('/:storeId/outbound-stock-authorizations/:authorizationId/execute', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      const identity = await authenticatedOwner(request.get('authorization') ?? '', storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.status(201).json(await executeAuthorizedMercadoLivreStockUpdate({
        storeId,
        authorizationId: clean(request.params.authorizationId),
        authorizationToken: clean(request.body?.authorizationToken),
        executedByUserId: identity.uid,
      }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  router.post('/:storeId/outbound-stock-executions/:executionId/reconcile', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      const identity = await authenticatedOwner(request.get('authorization') ?? '', storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await reconcileMercadoLivreStockUpdate({
        storeId,
        executionId: clean(request.params.executionId),
        reconciledByUserId: identity.uid,
      }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  return router;
};
