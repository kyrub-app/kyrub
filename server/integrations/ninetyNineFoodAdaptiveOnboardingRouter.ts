import { Router, type Request, type Response } from 'express';
import { adminAuth } from '../firebaseAdmin.js';
import { resolvePlatformCredentials } from './platformCredentialStore.js';
import { connectNinetyNineFood } from './ninetyNineFoodService.js';
import {
  resolveNinetyNineFoodOnboardingPlan,
  resolveNinetyNineFoodPlatformConnectionMaterial,
} from './ninetyNineFoodAdaptiveOnboardingService.js';

const PROVIDER = '99food' as const;

const clean = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string' ? value.trim().slice(0, maximum) : '';

const bearerToken = (request: Request): string => {
  const authorization = request.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() ?? '';
};

const authenticatedTenantId = async (request: Request): Promise<string> => {
  const token = bearerToken(request);
  if (!token) throw new Error('AUTH_REQUIRED');
  const decoded = await adminAuth.verifyIdToken(token, true);
  return decoded.uid;
};

const publicAppUrl = (request: Request): string => {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  if (configured) return configured;
  return `${request.protocol}://${request.get('host') ?? 'localhost:3000'}`;
};

const errorResponse = (response: Response, error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED' || /id-token|expired|revoked/i.test(message)) {
    response.status(401).json({ error: 'Faça login novamente.' });
    return;
  }
  if (/PLATFORM_MANAGED_NOT_AVAILABLE|ONBOARDING_MODE_CHANGED/.test(message)) {
    response.status(409).json({ error: message });
    return;
  }
  if (/CREDENTIALS_REQUIRED|INPUT_INVALID|PROVIDER_CONFIGURATION_REQUIRED/.test(message)) {
    response.status(400).json({ error: message });
    return;
  }
  console.error('[99Food Adaptive Onboarding]', error);
  response.status(503).json({
    error: message || 'Não foi possível concluir a conexão com a 99Food.',
  });
};

const providerEndpoints = async (environment: 'sandbox' | 'production') => {
  const configuration = await resolvePlatformCredentials(PROVIDER, environment);
  const baseUrl = clean(configuration?.base_url);
  const tokenUrl = clean(configuration?.token_url) || (baseUrl
    ? new URL('/oauth/token', `${baseUrl.replace(/\/$/, '')}/`).toString()
    : '');
  if (!baseUrl || !tokenUrl) {
    throw new Error('NINETY_NINE_FOOD_PROVIDER_CONFIGURATION_REQUIRED');
  }
  return { baseUrl, tokenUrl };
};

export const createNinetyNineFoodAdaptiveOnboardingRouter = (): Router => {
  const router = Router();

  router.get('/onboarding-plan', async (request, response) => {
    try {
      await authenticatedTenantId(request);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await resolveNinetyNineFoodOnboardingPlan(request.query.environment));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/connect-adaptive', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      const environment: 'sandbox' | 'production' = request.body?.environment === 'production'
        ? 'production'
        : 'sandbox';
      const plan = await resolveNinetyNineFoodOnboardingPlan(environment);
      if (!plan.discoveryVerified || !plan.merchantCanConnect) {
        throw new Error('NINETY_NINE_FOOD_ONBOARDING_MODE_CHANGED');
      }

      let clientId = '';
      let clientSecret = '';
      let baseUrl = '';
      let tokenUrl = '';
      let credentialAuthority: 'platform_vault' | 'merchant_vault' = 'platform_vault';

      if (plan.mode === 'platform_managed') {
        const material = await resolveNinetyNineFoodPlatformConnectionMaterial(environment);
        clientId = material.clientId;
        clientSecret = material.clientSecret;
        baseUrl = material.baseUrl;
        tokenUrl = material.tokenUrl;
      } else if (plan.mode === 'merchant_credentials_required') {
        clientId = clean(request.body?.clientId, 500);
        clientSecret = clean(request.body?.clientSecret, 2_000);
        if (!clientId || !clientSecret) {
          throw new Error('NINETY_NINE_FOOD_MERCHANT_CREDENTIALS_REQUIRED');
        }
        const endpoints = await providerEndpoints(environment);
        baseUrl = endpoints.baseUrl;
        tokenUrl = endpoints.tokenUrl;
        credentialAuthority = 'merchant_vault';
      } else {
        throw new Error('NINETY_NINE_FOOD_ONBOARDING_MODE_CHANGED');
      }

      const status = await connectNinetyNineFood(tenantId, {
        externalStoreId: clean(request.body?.externalStoreId, 500),
        accountLabel: clean(request.body?.accountLabel, 500),
        routingTarget: clean(request.body?.routingTarget, 500),
        environment,
        baseUrl,
        tokenUrl,
        clientId,
        clientSecret,
      }, publicAppUrl(request));

      await (await import('../firebaseAdmin.js')).adminDb
        .doc(`integrationConnections/${tenantId}__99food`)
        .set({
          credentialAuthority,
          onboardingAuthority: 'provider_public_discovery',
          onboardingManifestHash: plan.manifestHash,
          onboardingMode: plan.mode,
          onboardingGrantTypes: plan.supportedGrantTypes,
          onboardingClientIdGeneration: plan.clientIdGeneration,
        }, { merge: true });

      response.json({
        ...status,
        credentialAuthority,
        onboardingMode: plan.mode,
      });
    } catch (error) {
      errorResponse(response, error);
    }
  });

  return router;
};
