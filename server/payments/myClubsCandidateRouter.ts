import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { loadStoreRelationshipSummary } from './storeRelationshipService.js';

const MAX_STORES = 12;
const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const bearer = (value: string): string => /^Bearer\s+(.+)$/i.exec(value)?.[1]?.trim() ?? '';

/**
 * Bounded candidate summary, not a global membership index.
 * The client supplies candidate store IDs; the server derives customer identity
 * from the verified Firebase token and returns only that customer's relationship.
 */
export const createMyClubsCandidateRouter = (): Router => {
  const router = Router();
  router.post('/candidates', async (request, response) => {
    try {
      const token = bearer(request.get('authorization') ?? '');
      if (!token) {
        response.status(401).json({ error: 'Faça login para consultar seus clubes.' });
        return;
      }
      const identity = await verifyFirebaseIdToken(token);
      const raw = request.body?.storeIds;
      if (!Array.isArray(raw) || raw.length > MAX_STORES || raw.some(value => typeof value !== 'string')) {
        response.status(400).json({ error: 'Informe até 12 lojas válidas.' });
        return;
      }
      const storeIds = Array.from(new Set(raw.map(clean)));
      if (storeIds.some(id => !id || id.length > 128 || id.includes('/'))) {
        response.status(400).json({ error: 'Identificador de loja inválido.' });
        return;
      }
      const results = await Promise.allSettled(storeIds.map(storeId =>
        loadStoreRelationshipSummary({ storeId, customerId: identity.uid })
      ));
      const clubs = results.flatMap((result, index) => {
        if (result.status !== 'fulfilled') return [];
        const summary = result.value;
        const hasActivity = summary.level.confirmedPurchases > 0 ||
          summary.points.balance > 0 ||
          summary.points.lifetimeEarned > 0 ||
          summary.vouchers.some(voucher => voucher.status === 'active') ||
          summary.history.length > 0;
        if (!hasActivity) return [];
        return [{
          storeId: storeIds[index],
          pointsBalance: summary.points.balance,
          activeVouchers: summary.vouchers.filter(voucher => voucher.status === 'active').length,
          redeemableRewards: summary.rewards.filter(reward => reward.canRedeem).length,
        }];
      });
      if (results.some(result => result.status === 'rejected')) {
        response.status(503).json({ error: 'Não foi possível consultar todos os relacionamentos.' });
        return;
      }
      response.status(200).json({ schemaVersion: 1, clubs, checkedStores: storeIds.length, complete: false });
    } catch (error) {
      if (error instanceof Error && error.message === 'AUTH_REQUIRED') {
        response.status(401).json({ error: 'Faça login para consultar seus clubes.' });
        return;
      }
      console.error('[My Clubs candidates]', error);
      response.status(503).json({ error: 'Não foi possível consultar seus clubes.' });
    }
  });
  return router;
};
