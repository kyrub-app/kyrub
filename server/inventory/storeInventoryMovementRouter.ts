import { Router } from 'express';
import { listAuthorizedStoreInventoryMovements } from './storeInventoryMovementService.js';

const first = (value: unknown): string =>
  Array.isArray(value) ? String(value[0] ?? '').trim() : typeof value === 'string' ? value.trim() : '';

const authorizationHeader = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

const errorResponse = (error: unknown): { status: number; code: string; message: string } => {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'AUTH_REQUIRED') return { status: 401, code, message: 'Faça login novamente.' };
  if (code === 'STORE_INVENTORY_MOVEMENTS_FORBIDDEN') {
    return { status: 403, code, message: 'Você não pode consultar as movimentações desta loja.' };
  }
  if (code === 'STORE_INVENTORY_MOVEMENTS_STORE_REQUIRED') {
    return { status: 400, code, message: 'Loja não identificada.' };
  }
  console.error('[Store inventory movements]', error);
  return {
    status: 503,
    code: 'STORE_INVENTORY_MOVEMENTS_UNAVAILABLE',
    message: 'As movimentações do estoque estão temporariamente indisponíveis.',
  };
};

export const createStoreInventoryMovementRouter = (): Router => {
  const router = Router();
  router.get('/', async (request, response) => {
    try {
      const result = await listAuthorizedStoreInventoryMovements(
        authorizationHeader(request.headers.authorization),
        first(request.query.storeId)
      );
      response.status(200).json(result);
    } catch (error) {
      const mapped = errorResponse(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });
  return router;
};
