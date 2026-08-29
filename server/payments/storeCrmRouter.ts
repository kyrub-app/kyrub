import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { loadStoreCrmSummary } from './storeCrmService.js';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const bearerToken = (authorization: string): string => /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

export const createStoreCrmRouter = (): Router => {
  const router = Router();

  router.get('/', async (request, response) => {
    try {
      const token = bearerToken(request.get('authorization') ?? '');
      if (!token) return response.status(401).json({ error: 'Faça login novamente para acessar o CRM.' });
      const identity = await verifyFirebaseIdToken(token);
      const storeId = clean(request.query.storeId);
      if (!storeId) return response.status(400).json({ error: 'Loja não identificada.' });
      if (identity.uid !== storeId) {
        return response.status(403).json({ error: 'Apenas o proprietário pode consultar este CRM nesta versão.' });
      }

      response.status(200).json(await loadStoreCrmSummary({ storeId }));
    } catch (error) {
      console.error('[Store CRM]', error);
      response.status(503).json({ error: 'Não foi possível carregar o CRM da loja.' });
    }
  });

  return router;
};
