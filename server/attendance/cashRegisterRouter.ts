import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import {
  createCanonicalCashRegister,
  listCanonicalCashRegisters,
  openCanonicalCashRegisterSession,
  addCanonicalCashRegisterMovement,
  closeCanonicalCashRegisterSession,
} from './cashRegisterSessionService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const requireActorId = async (authorization: string): Promise<string> => {
  const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim();
  if (!token) throw new Error('AUTH_REQUIRED');
  const identity = await verifyFirebaseIdToken(token);
  if (!identity.uid) throw new Error('AUTH_REQUIRED');
  return identity.uid;
};

const sendError = (response: import('express').Response, error: unknown): void => {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'AUTH_REQUIRED') {
    response.status(401).json({ error: 'Entre novamente para acessar o Caixa.', code });
  } else if (code === 'CASH_REGISTER_FORBIDDEN' || code === 'IN_PERSON_ORDER_FORBIDDEN') {
    response.status(403).json({ error: 'Sua função não autoriza esta operação do Caixa.', code: 'CASH_REGISTER_FORBIDDEN' });
  } else if (code === 'CASH_REGISTER_NOT_FOUND') {
    response.status(404).json({ error: 'Terminal não encontrado ou desativado.', code });
   } else if (code === 'CASH_REGISTER_ALREADY_EXISTS') {
    response.status(409).json({ error: 'Já existe um terminal com esse nome.', code });
  } else if (code === 'CASH_REGISTER_SESSION_CLOSED') {
    response.status(409).json({ error: 'A sessão já foi encerrada ou deixou de pertencer a este terminal.', code });
  } else if (code === 'CASH_REGISTER_BALANCE_INVALID') {
    response.status(409).json({ error: 'O lançamento faria o saldo físico ficar inválido.', code });
  } else if (code === 'CASH_REGISTER_CLOSE_REASON_REQUIRED') {
    response.status(400).json({ error: 'Justifique a diferença de numerário antes do fechamento.', code });
  } else if (code === 'CASH_REGISTER_ALREADY_OPEN') {
    response.status(409).json({ error: 'Já existe uma sessão aberta neste terminal.', code });
  } else if (
    code === 'CASH_REGISTER_IDEMPOTENCY_CONFLICT' ||
    code === 'CASH_REGISTER_INTEGRITY_CONFLICT'
  ) {
    response.status(409).json({ error: 'A sessão mudou ou possui dados inconsistentes. Recarregue o Caixa.', code });
  } else if (code.startsWith('CASH_REGISTER_')) {
    response.status(400).json({ error: 'Revise os dados do terminal e da abertura de turno.', code });
  } else {
    console.error('[Canonical Cash register]', error);
    response.status(503).json({ error: 'Não foi possível operar o terminal agora.', code: 'CASH_REGISTER_UNAVAILABLE' });
  }
};

/**
 * Inactive by default: the existing Cash workspace still uses legacy client
 * create/close and must be migrated with compatible cash rules before this
 * route may accept any managed register mutations. No new serverless entrypoint.
 */
export const createCashRegisterRouter = (): Router => {
  const router = Router();
  router.use((_request, response, next) => {
    if (process.env.CASH_REGISTER_MANAGED_SESSIONS_ENABLED !== 'true') {
      response.status(409).json({
        error: 'A abertura compartilhada por terminal ainda está em preparação.',
        code: 'CASH_REGISTER_COORDINATION_NOT_ENABLED',
      });
      return;
    }
    next();
  });

  router.get('/', async (request, response) => {
    try {
      const authenticatedUserId = await requireActorId(request.get('authorization') ?? '');
      const registers = await listCanonicalCashRegisters({
        legacyStoreId: clean(request.query.storeId),
        authenticatedUserId,
      });
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.status(200).json({ registers });
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post('/', async (request, response) => {
    try {
      const authenticatedUserId = await requireActorId(request.get('authorization') ?? '');
      const register = await createCanonicalCashRegister({
        legacyStoreId: clean(request.body?.storeId),
        authenticatedUserId,
        name: request.body?.name,
      });
      response.status(201).json({ register });
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post('/:registerId/open', async (request, response) => {
    try {
      const authenticatedUserId = await requireActorId(request.get('authorization') ?? '');
      const result = await openCanonicalCashRegisterSession({
        legacyStoreId: clean(request.body?.storeId),
        authenticatedUserId,
        registerId: request.params.registerId,
        operationId: request.body?.operationId,
        openingMinor: request.body?.openingMinor,
        shiftLabel: request.body?.shiftLabel,
      });
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.status(result.replay ? 200 : 201).json(result);
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post('/:registerId/sessions/:sessionId/movements', async (request, response) => {
    try {
      const authenticatedUserId = await requireActorId(request.get('authorization') ?? '');
      const result = await addCanonicalCashRegisterMovement({
        legacyStoreId: clean(request.body?.storeId),
        authenticatedUserId,
        registerId: request.params.registerId,
        sessionId: request.params.sessionId,
        operationId: request.body?.operationId,
        type: request.body?.type,
        direction: request.body?.direction,
        amountMinor: request.body?.amountMinor,
        description: request.body?.description,
        category: request.body?.category,
        reason: request.body?.reason,
      });
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.status(result.replay ? 200 : 201).json(result);
    } catch (error) {
      sendError(response, error);
    }
  });

  router.post('/:registerId/sessions/:sessionId/close', async (request, response) => {
    try {
      const authenticatedUserId = await requireActorId(request.get('authorization') ?? '');
      const result = await closeCanonicalCashRegisterSession({
        legacyStoreId: clean(request.body?.storeId),
        authenticatedUserId,
        registerId: request.params.registerId,
        sessionId: request.params.sessionId,
        operationId: request.body?.operationId,
        countedMinor: request.body?.countedMinor,
        reason: request.body?.reason,
      });
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.status(200).json(result);
    } catch (error) {
      sendError(response, error);
    }
  });

  return router;
};
