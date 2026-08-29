import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import {
  listAvailableStoreRewards,
  redeemStoreReward,
} from './storeRewardService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const mapRewardError = (error: unknown): { status: number; error: string } => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED' || /id-token|expired|revoked/i.test(message)) {
    return { status: 401, error: 'Faça login novamente.' };
  }
  if (message === 'STORE_REWARD_NOT_FOUND') {
    return { status: 404, error: 'Recompensa não encontrada nesta loja.' };
  }
  if (message === 'STORE_REWARD_NOT_AVAILABLE') {
    return { status: 409, error: 'Esta recompensa não está disponível agora.' };
  }
  if (message === 'STORE_REWARD_INSUFFICIENT_POINTS') {
    return { status: 409, error: 'Saldo de Pontos da Loja insuficiente para este resgate.' };
  }
  if (message === 'STORE_REWARD_REDEMPTION_CONFLICT') {
    return { status: 409, error: 'O resgate entrou em conflito com um registro existente.' };
  }
  if (message.startsWith('STORE_REWARD_')) {
    return { status: 400, error: 'Não foi possível concluir este resgate.' };
  }
  console.error('Store reward request failed.', error);
  return { status: 500, error: 'Não foi possível processar a recompensa.' };
};

export const createStoreRewardRouter = (): Router => {
  const router = Router();

  router.get('/public', async (request, response) => {
    try {
      const storeId = clean(request.query.storeId);
      if (!storeId) {
        response.status(400).json({ error: 'Loja não identificada.' });
        return;
      }
      response.status(200).json({
        rewards: await listAvailableStoreRewards(storeId),
      });
    } catch (error) {
      const mapped = mapRewardError(error);
      response.status(mapped.status).json({ error: mapped.error });
    }
  });

  router.post('/redeem', async (request, response) => {
    try {
      const token = bearerToken(request.get('authorization') ?? '');
      if (!token) throw new Error('AUTH_REQUIRED');
      const identity = await verifyFirebaseIdToken(token);
      const body = request.body && typeof request.body === 'object'
        ? request.body as Record<string, unknown>
        : {};
      const storeId = clean(body.storeId);
      const rewardId = clean(body.rewardId);
      if (!storeId || !rewardId) {
        throw new Error('STORE_REWARD_REDEMPTION_REQUIRED');
      }

      const result = await redeemStoreReward({
        storeId,
        rewardId,
        customerId: identity.uid,
      });
      response.status(result.duplicate ? 200 : 201).json(result);
    } catch (error) {
      const mapped = mapRewardError(error);
      response.status(mapped.status).json({ error: mapped.error });
    }
  });

  return router;
};
