import { Router } from 'express';
import { authorizePlatformEconomy, mapPlatformEconomyError } from './platformEconomyRouter.js';
import { readEcosystemFunnelCounts } from './ecosystemFunnelCountsService.js';

/** Global ecosystem totals are restricted to active super administrators. */
export const createEcosystemFunnelRouter = (): Router => {
  const router = Router();
  router.get('/', async (request, response) => {
    try {
      const admin = await authorizePlatformEconomy(request.get('authorization') ?? '');
      if (admin.role !== 'super_admin') {
        response.status(403).json({ error: 'Acesso não autorizado.', code: 'FORBIDDEN' });
        return;
      }
      const result = await readEcosystemFunnelCounts();
      response.json(result);
    } catch (error) {
      const mapped = mapPlatformEconomyError(error);
      response.status(mapped.status).json(mapped.body);
    }
  });
  return router;
};
