import { Router } from 'express';
import { processPendingMercadoLivreOrderIngressBatch } from './mercadoLivreOrderIngressWorkerService.js';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const expectedSecret = (): string => process.env.CRON_SECRET?.trim() ?? '';

export const createMercadoLivreOrderIngressWorkerRouter = (): Router => {
  const router = Router();

  router.get('/orders-v2-worker', async (request, response) => {
    const secret = expectedSecret();
    const provided = bearerToken(request.get('authorization') ?? '');
    if (!secret || !provided || provided !== secret) {
      response.status(401).json({
        error: 'Worker não autorizado.',
        code: 'MERCADO_LIVRE_ORDER_WORKER_UNAUTHORIZED',
      });
      return;
    }

    try {
      const result = await processPendingMercadoLivreOrderIngressBatch({ limit: 10 });
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.status(200).json({ ok: true, ...result });
    } catch (error) {
      console.error(
        '[Mercado Livre order ingress worker]',
        error instanceof Error ? error.message : String(error)
      );
      response.status(503).json({
        error: 'O worker de pedidos do Mercado Livre está temporariamente indisponível.',
        code: 'MERCADO_LIVRE_ORDER_WORKER_UNAVAILABLE',
      });
    }
  });

  return router;
};
