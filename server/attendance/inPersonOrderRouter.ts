import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { loadOwnerStoreInstitutionalRepresentation } from '../store/storeInstitutionalIdentityService.js';
import {
  createInPersonOrder,
  listInPersonOrderCatalog,
} from './inPersonOrderService.js';
import {
  loadFiscalConsumerIdentitySelection,
  saveFiscalConsumerIdentitySelection,
} from './fiscalConsumerIdentityService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const authorizeOwnerStore = async (input: {
  authorization: string;
  storeId: string;
}) => {
  const token = bearerToken(input.authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const identity = await verifyFirebaseIdToken(token);
  const representation = await loadOwnerStoreInstitutionalRepresentation({
    storeId: input.storeId,
    authenticatedUserId: identity.uid,
  });
  return representation;
};

const mapError = (error: unknown): { status: number; message: string; code?: string } => {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'AUTH_REQUIRED') {
    return { status: 401, message: 'Faça login novamente para operar o PDV local.' };
  }
  if (
    code === 'STORE_REPRESENTATION_FORBIDDEN' ||
    code === 'IN_PERSON_ORDER_FORBIDDEN' ||
    code === 'FISCAL_CONSUMER_IDENTITY_FORBIDDEN'
  ) {
    return { status: 403, message: 'Você não pode operar pedidos desta loja.' };
  }
  if (code === 'FISCAL_CONSUMER_ORDER_NOT_FOUND') {
    return { status: 404, message: 'Um dos pedidos selecionados não foi encontrado.', code };
  }
  if (code === 'FISCAL_CONSUMER_TAX_IDENTIFIER_INVALID') {
    return { status: 400, message: 'Informe um CPF ou CNPJ válido.', code };
  }
  if (
    code === 'FISCAL_CONSUMER_ORDER_IDS_REQUIRED' ||
    code === 'FISCAL_CONSUMER_ORDER_IDS_INVALID'
  ) {
    return { status: 400, message: 'Selecione os pedidos que receberão a identificação fiscal.', code };
  }
  if (
    code === 'FISCAL_CONSUMER_ORDER_INTEGRITY_INVALID' ||
    code === 'FISCAL_CONSUMER_IDENTITY_STORED_INVALID'
  ) {
    return { status: 409, message: 'A identidade fiscal do pedido precisa ser reconciliada.', code };
  }
  if (
    code === 'STORE_INSTITUTIONAL_NOT_FOUND' ||
    code === 'IN_PERSON_ORDER_STORE_NOT_FOUND' ||
    code === 'IN_PERSON_ORDER_CANONICAL_STORE_NOT_FOUND'
  ) {
    return { status: 404, message: 'A loja ainda não está disponível para pedido presencial.' };
  }
  if (code === 'SERVICE_LOCATION_NOT_FOUND') {
    return { status: 404, message: 'O local de atendimento não foi encontrado.' };
  }
  if (code === 'SERVICE_LOCATION_INACTIVE') {
    return { status: 409, message: 'Este local de atendimento está desativado.', code };
  }
  if (code === 'IN_PERSON_ORDER_PRODUCT_NOT_FOUND') {
    return { status: 404, message: 'Um dos produtos não foi encontrado no catálogo canônico.' };
  }
  if (code === 'IN_PERSON_ORDER_PRODUCT_NOT_SELLABLE') {
    return { status: 409, message: 'Um dos produtos não está disponível para venda no PDV.', code };
  }
  if (code === 'IN_PERSON_ORDER_PRODUCT_STOCK_INSUFFICIENT') {
    return { status: 409, message: 'Estoque insuficiente para um dos itens solicitados.', code };
  }
  if (
    code === 'IN_PERSON_ORDER_CANONICAL_STORE_CONFLICT' ||
    code === 'IN_PERSON_ORDER_CANONICAL_STORE_AMBIGUOUS' ||
    code === 'IN_PERSON_ORDER_CANONICAL_STORE_REQUIRED' ||
    code === 'IN_PERSON_ORDER_CANONICAL_CUTOVER_REQUIRED'
  ) {
    return {
      status: 409,
      message: 'O vínculo da loja canônica precisa ser reconciliado antes de criar pedidos presenciais.',
      code,
    };
  }
  if (
    code.startsWith('IN_PERSON_ORDER_') ||
    code.startsWith('SERVICE_LOCATION_') ||
    code.startsWith('STORE_INSTITUTIONAL_') ||
    code.startsWith('STORE_REPRESENTATION_') ||
    code.startsWith('FISCAL_CONSUMER_')
  ) {
    return { status: 400, message: 'Revise os dados do pedido presencial.', code };
  }
  console.error('[In-person order]', error);
  return { status: 503, message: 'O PDV local está temporariamente indisponível.' };
};

export const createInPersonOrderRouter = (): Router => {
  const router = Router();

  router.get('/catalog', async (request, response) => {
    try {
      const storeId = clean(request.query.storeId);
      if (!storeId) throw new Error('IN_PERSON_ORDER_STORE_REQUIRED');
      await authorizeOwnerStore({
        authorization: request.get('authorization') ?? '',
        storeId,
      });
      response.status(200).json(
        await listInPersonOrderCatalog({ legacyStoreId: storeId })
      );
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({
        error: mapped.message,
        ...(mapped.code ? { code: mapped.code } : {}),
      });
    }
  });

  router.get('/fiscal-consumer-identity', async (request, response) => {
    try {
      const storeId = clean(request.query.storeId);
      if (!storeId) throw new Error('IN_PERSON_ORDER_STORE_REQUIRED');
      const representation = await authorizeOwnerStore({
        authorization: request.get('authorization') ?? '',
        storeId,
      });
      const orderIds = clean(request.query.orderIds)
        .split(',')
        .map(orderId => orderId.trim())
        .filter(Boolean);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.status(200).json({
        fiscalConsumerIdentity: await loadFiscalConsumerIdentitySelection({
          legacyStoreId: storeId,
          requestedByUserId: representation.authenticatedUserId,
          orderIds,
        }),
      });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({
        error: mapped.message,
        ...(mapped.code ? { code: mapped.code } : {}),
      });
    }
  });

  router.put('/fiscal-consumer-identity', async (request, response) => {
    try {
      const storeId = clean(request.body?.storeId);
      if (!storeId) throw new Error('IN_PERSON_ORDER_STORE_REQUIRED');
      const representation = await authorizeOwnerStore({
        authorization: request.get('authorization') ?? '',
        storeId,
      });
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.status(200).json({
        fiscalConsumerIdentity: await saveFiscalConsumerIdentitySelection({
          legacyStoreId: storeId,
          requestedByUserId: representation.authenticatedUserId,
          orderIds: request.body?.orderIds,
          taxIdentifier: request.body?.taxIdentifier,
        }),
      });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({
        error: mapped.message,
        ...(mapped.code ? { code: mapped.code } : {}),
      });
    }
  });

  router.post('/', async (request, response) => {
    try {
      const storeId = clean(request.body?.storeId);
      if (!storeId) throw new Error('IN_PERSON_ORDER_STORE_REQUIRED');
      const representation = await authorizeOwnerStore({
        authorization: request.get('authorization') ?? '',
        storeId,
      });
      const order = await createInPersonOrder({
        authenticatedUserId: representation.authenticatedUserId,
        value: request.body,
      });
      response.status(201).json({ order });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({
        error: mapped.message,
        ...(mapped.code ? { code: mapped.code } : {}),
      });
    }
  });

  return router;
};
