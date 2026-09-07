import express from 'express';
import rateLimit from 'express-rate-limit';
import { createStoreConnectionOnboardingRouter } from '../../server/integrations/storeConnectionOnboardingRouter';
import { createMercadoLivreRouter } from '../../server/integrations/mercadoLivreRouter';
import { createMercadoLivreStockExecutionRouter } from '../../server/integrations/mercadoLivreStockExecutionRouter';
import { createMercadoLivreE2ETestRouter } from '../../server/integrations/mercadoLivreE2ETestRouter';

const app = express();

app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

const integrationRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  message: {
    error: 'Muitas solicitações de integração. Tente novamente em instantes.',
    code: 'TOO_MANY_INTEGRATION_REQUESTS',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(
  '/api/store-connections/mercado-livre',
  integrationRateLimiter,
  createMercadoLivreRouter()
);

app.use(
  '/api/store-connections/mercado-livre',
  integrationRateLimiter,
  createMercadoLivreStockExecutionRouter()
);

app.use(
  '/api/store-connections/mercado-livre',
  integrationRateLimiter,
  createMercadoLivreE2ETestRouter()
);

app.use(
  '/api/store-connections',
  integrationRateLimiter,
  createStoreConnectionOnboardingRouter()
);

export default app;
