import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import {
  beginMercadoPagoStoreAuthorization,
  completeMercadoPagoStoreAuthorization,
  disconnectMercadoPagoStore,
  getMercadoPagoStoreConnectionStatus,
  validateMercadoPagoStoreConnection,
} from './mercadoPagoStoreOauthService.js';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const bearer = (value: string): string => /^Bearer\s+(.+)$/i.exec(value)?.[1]?.trim() ?? '';

const requireOwner = async (authorization: string, storeId: string): Promise<void> => {
  const token = bearer(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const identity = await verifyFirebaseIdToken(token);
  if (!storeId || identity.uid !== storeId) throw new Error('MERCADO_PAGO_STORE_FORBIDDEN');
};

const callbackRedirect = (status: 'connected' | 'error', code = ''): string => {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  const base = configured && /^https?:\/\//i.test(configured) ? configured : '/';
  const url = new URL(base, 'http://localhost');
  url.searchParams.set('integration', 'mercado_pago');
  url.searchParams.set('status', status);
  if (code) url.searchParams.set('code', code);
  return configured ? url.toString() : `${url.pathname}${url.search}`;
};

const errorCode = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).split(':')[0].slice(0, 100);

const mapError = (error: unknown): { status: number; message: string; code: string } => {
  const code = errorCode(error);
  if (code === 'AUTH_REQUIRED') return { status: 401, message: 'Faça login novamente.', code };
  if (code === 'MERCADO_PAGO_STORE_FORBIDDEN') return { status: 403, message: 'Você não pode administrar os recebimentos desta loja.', code };
  if (code === 'MERCADO_PAGO_STORE_NOT_CONNECTED') return { status: 409, message: 'Conecte a conta Mercado Pago desta loja.', code };
  if (code === 'MERCADO_PAGO_OAUTH_PLATFORM_NOT_CONFIGURED') return { status: 503, message: 'O OAuth do Mercado Pago ainda precisa ser configurado pela plataforma.', code };
  if (/STATE|CODE|PKCE|IDENTITY_MISMATCH|PROFILE_INVALID/.test(code)) return { status: 400, message: 'A autorização do Mercado Pago não pôde ser validada.', code };
  if (code.startsWith('MERCADO_PAGO_')) return { status: 503, message: 'A conexão Mercado Pago está temporariamente indisponível.', code };
  console.error('[Mercado Pago store connection]', error);
  return { status: 503, message: 'Não foi possível operar a conexão de recebimentos.', code };
};

export const createMercadoPagoStoreRouter = (): Router => {
  const router = Router();

  router.get('/callback', async (request, response) => {
    try {
      await completeMercadoPagoStoreAuthorization({
        code: clean(request.query.code),
        state: clean(request.query.state),
      });
      response.redirect(302, callbackRedirect('connected'));
    } catch (error) {
      const mapped = mapError(error);
      console.warn('[Mercado Pago OAuth callback]', mapped.code);
      response.redirect(302, callbackRedirect('error', mapped.code));
    }
  });

  router.get('/:storeId/status', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      await requireOwner(request.get('authorization') ?? '', storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.status(200).json(await getMercadoPagoStoreConnectionStatus(storeId));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  router.post('/:storeId/authorize', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      await requireOwner(request.get('authorization') ?? '', storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.status(201).json({
        authorizationUrl: await beginMercadoPagoStoreAuthorization(storeId),
      });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  router.post('/:storeId/validate', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      await requireOwner(request.get('authorization') ?? '', storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.status(200).json({
        ok: true,
        externalAccountId: await validateMercadoPagoStoreConnection(storeId),
      });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  router.post('/:storeId/disconnect', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      await requireOwner(request.get('authorization') ?? '', storeId);
      await disconnectMercadoPagoStore(storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.status(200).json({ disconnected: true });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  return router;
};
