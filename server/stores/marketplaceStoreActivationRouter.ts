import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { publishMarketplaceStoreAndRecordFirstActivation } from './marketplaceStoreActivation.js';

/**
 * Authenticated, owner-only commercial publication endpoint.
 * Intentionally not called from checkout and not automatically invoked by
 * legacy profile saves. The UI must validate activation fields before calling.
 */
export const createMarketplaceStoreActivationRouter = (): Router => {
  const router = Router();
  router.post('/:storeId/activate', async (request, response) => {
    try {
      const token = /^Bearer\s+(.+)$/i.exec(request.get('authorization') ?? '')?.[1]?.trim();
      if (!token) return response.status(401).json({ error: 'Faça login para ativar sua loja.' });
      const identity = await verifyFirebaseIdToken(token);
      const storeId = String(request.params.storeId ?? '').trim();
      if (!storeId || storeId.includes('/')) {
        return response.status(400).json({ error: 'Loja inválida.' });
      }
      const activation = await publishMarketplaceStoreAndRecordFirstActivation(storeId, identity.uid);
      return response.status(200).json({ storeId, publicationStatus: 'published', ...activation });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'Store not found.') return response.status(404).json({ error: 'Loja não encontrada.' });
      if (message === 'Store owner does not match activation request.') {
        return response.status(403).json({ error: 'Somente o proprietário pode ativar esta loja.' });
      }
      if (message.startsWith('Invalid ') || message.includes('reconciliation required')) {
        return response.status(409).json({ error: 'Ativação pendente de conferência do cadastro comercial.' });
      }
      console.error('[Marketplace store activation]', error);
      return response.status(503).json({ error: 'Não foi possível ativar a loja agora.' });
    }
  });
  return router;
};
