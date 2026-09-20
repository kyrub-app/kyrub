import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { loadOwnerStoreInstitutionalRepresentation } from '../store/storeInstitutionalIdentityService.js';
import { quoteLocalOrderCoupon } from './localCouponQuoteService.js';

const clean = (value: unknown, max = 220): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const mapError = (error: unknown): { status: number; message: string } => {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'AUTH_REQUIRED') return { status: 401, message: 'Faça login novamente para validar o cupom.' };
  if (code === 'STORE_REPRESENTATION_FORBIDDEN') return { status: 403, message: 'Você não pode operar os cupons desta loja.' };
  if (code === 'LOCAL_COUPON_ORDER_NOT_FOUND') return { status: 404, message: 'Pedido não encontrado para aplicar o cupom.' };
  if (code === 'CHECKOUT_COUPON_NOT_FOUND') return { status: 404, message: 'Cupom não encontrado.' };
  if (code === 'CHECKOUT_COUPON_NOT_AVAILABLE') return { status: 409, message: 'Este cupom não está disponível agora.' };
  if (code === 'CHECKOUT_COUPON_NOT_ELIGIBLE') return { status: 409, message: 'Este cupom não é elegível para este cliente.' };
  if (code === 'CHECKOUT_COUPON_BUYER_LIMIT_REACHED') return { status: 409, message: 'O cliente já atingiu o limite de uso deste cupom.' };
  if (code === 'PROMOTION_NOT_APPLICABLE' || code === 'LOCAL_COUPON_NO_DISCOUNT') return { status: 409, message: 'Este cupom não se aplica aos itens desta conta.' };
  if (code === 'LOCAL_COUPON_CUSTOMER_IDENTIFICATION_REQUIRED') return { status: 409, message: 'Identifique o Cairubido antes de aplicar o cupom.' };
  if (code === 'LOCAL_COUPON_RECONCILIATION_REQUIRED') return { status: 409, message: 'A conta precisa ser conciliada antes de aplicar um cupom.' };
  if (code.startsWith('LOCAL_COUPON_')) return { status: 400, message: 'Não foi possível validar este cupom para a conta.' };
  console.error('[Local coupon quote]', error);
  return { status: 503, message: 'Não foi possível validar o cupom agora.' };
};

export const createLocalCouponQuoteRouter = (): Router => {
  const router = Router();
  router.post('/coupon-quote', async (request, response) => {
    try {
      const storeId = clean(request.body?.storeId);
      const orderId = clean(request.body?.orderId);
      const couponCode = clean(request.body?.couponCode, 48);
      if (!storeId || !orderId || !couponCode) throw new Error('LOCAL_COUPON_QUOTE_REQUIRED');
      const token = bearerToken(request.get('authorization') ?? '');
      if (!token) throw new Error('AUTH_REQUIRED');
      const identity = await verifyFirebaseIdToken(token);
      await loadOwnerStoreInstitutionalRepresentation({
        storeId,
        authenticatedUserId: identity.uid,
      });
      response.status(200).json(await quoteLocalOrderCoupon({
        legacyStoreId: storeId,
        orderId,
        couponCode,
      }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });
  return router;
};
