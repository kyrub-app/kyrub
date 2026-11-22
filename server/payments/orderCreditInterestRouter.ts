import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { loadOwnerStoreInstitutionalRepresentation } from '../store/storeInstitutionalIdentityService.js';
import {
  listOwnCreditInterestProposals,
  loadOwnerCreditInterestProposal,
  proposeOrderCreditInterest,
  respondToOrderCreditInterest,
} from './orderCreditInterestService.js';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const bearer = (value: string): string => /^Bearer\s+(.+)$/i.exec(value)?.[1]?.trim() ?? '';
const identify = async (authorization: string) => {
  const token = bearer(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  return verifyFirebaseIdToken(token);
};
const errorResult = (error: unknown): {status: number; message: string; code: string} => {
  const code = error instanceof Error ? error.message : 'CREDIT_INTEREST_UNAVAILABLE';
  if (code === 'AUTH_REQUIRED') return {status: 401, message: 'Faça login novamente.', code};
  if (code === 'STORE_REPRESENTATION_FORBIDDEN' || code === 'CREDIT_INTEREST_INVALID_ACTOR') {
    return {status: 403, message: 'Você não pode propor crédito por esta loja.', code};
  }
  if (code === 'CREDIT_INTEREST_NOT_FOUND') return {status: 404, message: 'Proposta não encontrada para este cliente.', code};
  if (code.startsWith('CREDIT_INTEREST_')) {
    return {status: 409, message: 'Esta proposta não pode ser enviada ou respondida neste estado. Confira o pagamento e o pedido.', code};
  }
  console.error('[Credit interest consultation]', error);
  return {status: 503, message: 'Não foi possível consultar a proposta agora.', code: 'CREDIT_INTEREST_UNAVAILABLE'};
};

export const createOrderCreditInterestRouter = (): Router => {
  const router = Router();
  // Merchant status is read-only and authenticated; never repeats an offer.
  router.get('/status', async (request, response) => {
    try {
      const identity = await identify(request.get('authorization') ?? '');
      const proposal = await loadOwnerCreditInterestProposal({
        storeId: clean(request.query.storeId),
        orderId: clean(request.query.orderId),
        actorId: identity.uid,
      });
      response.setHeader('Cache-Control', 'no-store');
      response.status(200).json({ proposal });
    } catch (error) {
      const mapped = errorResult(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  // Buyer sees only proposals scoped by their validated Firebase identity.
  router.get('/mine', async (request, response) => {
    try {
      const identity = await identify(request.get('authorization') ?? '');
      const proposals = await listOwnCreditInterestProposals({
        storeId: clean(request.query.storeId), buyerId: identity.uid,
      });
      response.status(200).json({proposals});
    } catch (error) {
      const mapped = errorResult(error);
      response.status(mapped.status).json({error: mapped.message, code: mapped.code});
    }
  });
  // The owner may merely consult interest; this neither issues a coupon
  // nor substitutes for a verified refund, credit or buyer acceptance.
  router.post('/offer', async (request, response) => {
    try {
      const identity = await identify(request.get('authorization') ?? '');
      const storeId = clean(request.body?.storeId);
      await loadOwnerStoreInstitutionalRepresentation({
        storeId, authenticatedUserId: identity.uid,
      });
      const proposal = await proposeOrderCreditInterest({
        storeId, orderId: clean(request.body?.orderId), actorId: identity.uid,
        bonusPercent: request.body?.bonusPercent,
      });
      response.status(200).json({proposal});
    } catch (error) {
      const mapped = errorResult(error);
      response.status(mapped.status).json({error: mapped.message, code: mapped.code});
    }
  });
  router.post('/respond', async (request, response) => {
    try {
      const identity = await identify(request.get('authorization') ?? '');
      const choice = clean(request.body?.choice);
      if (choice !== 'interested' && choice !== 'prefers_refund') {
        throw new Error('CREDIT_INTEREST_RESPONSE_INVALID');
      }
      const proposal = await respondToOrderCreditInterest({
        storeId: clean(request.body?.storeId),
        orderId: clean(request.body?.orderId),
        buyerId: identity.uid, choice,
      });
      response.status(200).json({proposal});
    } catch (error) {
      const mapped = errorResult(error);
      response.status(mapped.status).json({error: mapped.message, code: mapped.code});
    }
  });
  return router;
};
