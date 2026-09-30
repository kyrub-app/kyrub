import { Router } from 'express';
import {
  executeAuthorizedStoreProcurementAction,
  listAuthorizedStoreProcurement,
} from './storeProcurementService.js';

const first = (value: unknown): string =>
  Array.isArray(value) ? String(value[0] ?? '').trim() : typeof value === 'string' ? value.trim() : '';

const authorizationHeader = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? '' : value ?? '';

const errorResponse = (error: unknown): { status: number; code: string; message: string } => {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'AUTH_REQUIRED') return { status: 401, code, message: 'Faça login novamente.' };
  if (code === 'STORE_PROCUREMENT_FORBIDDEN') {
    return { status: 403, code, message: 'Você não pode administrar compras desta loja.' };
  }
  if (code === 'STORE_PROCUREMENT_SUPPLIER_NOT_FOUND') {
    return { status: 404, code, message: 'Fornecedor não encontrado.' };
  }
  if (code === 'STORE_PROCUREMENT_PURCHASE_NOT_FOUND') {
    return { status: 404, code, message: 'Compra não encontrada.' };
  }
  if (code === 'STORE_PROCUREMENT_RECEIPT_NOT_FOUND' || code === 'PURCHASE_RECEIPT_NOT_FOUND') {
    return { status: 404, code, message: 'Recebimento não encontrado.' };
  }
  if (
    code.includes('TRANSITION_INVALID')
    || code.includes('NOT_RECEIVABLE')
    || code.includes('OVER_RECEIPT')
    || code.includes('IDEMPOTENCY_CONFLICT')
    || code.includes('NOT_CONFIRMED')
  ) {
    return { status: 409, code, message: 'Esta operação não é compatível com o estado atual da compra ou do recebimento.' };
  }
  if (
    code.startsWith('STORE_PROCUREMENT_')
    || code.startsWith('STORE_PURCHASE_')
    || code.startsWith('PURCHASE_RECEIPT_')
  ) {
    return { status: 400, code, message: 'Revise os dados desta operação de compras.' };
  }
  console.error('[Store procurement]', error);
  return {
    status: 503,
    code: 'STORE_PROCUREMENT_UNAVAILABLE',
    message: 'O módulo de compras está temporariamente indisponível.',
  };
};

export const createStoreProcurementRouter = (): Router => {
  const router = Router();

  router.get('/', async (request, response) => {
    try {
      const result = await listAuthorizedStoreProcurement(
        authorizationHeader(request.headers.authorization),
        first(request.query.storeId)
      );
      response.status(200).json(result);
    } catch (error) {
      const mapped = errorResponse(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  router.post('/', async (request, response) => {
    try {
      const result = await executeAuthorizedStoreProcurementAction(
        authorizationHeader(request.headers.authorization),
        request.body
      );
      response.status(200).json(result);
    } catch (error) {
      const mapped = errorResponse(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  return router;
};
