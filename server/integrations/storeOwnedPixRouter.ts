import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import {
  disableStoreOwnedPixConfiguration,
  loadStoreOwnedPixConnectionMetadata,
  saveStoreOwnedPixConfiguration,
} from './storeOwnedPixSecretStore.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';
const bearer = (value: string): string =>
  /^Bearer\s+(.+)$/i.exec(value)?.[1]?.trim() ?? '';

const requireOwner = async (
  authorization: string,
  storeId: string
): Promise<string> => {
  const token = bearer(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const identity = await verifyFirebaseIdToken(token);
  if (!storeId || identity.uid !== storeId) throw new Error('STORE_PIX_FORBIDDEN');
  return identity.uid;
};

const errorCode = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).split(':')[0].slice(0, 100);

const mapError = (error: unknown): { status: number; message: string; code: string } => {
  const code = errorCode(error);
  if (code === 'AUTH_REQUIRED') return { status: 401, message: 'Faça login novamente.', code };
  if (code === 'STORE_PIX_FORBIDDEN') return { status: 403, message: 'Você não pode administrar os recebimentos desta loja.', code };
  if (code === 'STORE_PIX_NOT_CONFIGURED') return { status: 409, message: 'O Pix próprio ainda não está configurado nesta loja.', code };
  if (
    code === 'STORE_PIX_KEY_REQUIRED' ||
    code === 'STORE_PIX_KEY_TYPE_INVALID' ||
    code === 'STORE_PIX_CPF_INVALID' ||
    code === 'STORE_PIX_CNPJ_INVALID' ||
    code === 'STORE_PIX_EMAIL_INVALID' ||
    code === 'STORE_PIX_PHONE_INVALID' ||
    code === 'STORE_PIX_EVP_INVALID' ||
    code === 'STORE_PIX_RECIPIENT_NAME_INVALID' ||
    code === 'STORE_PIX_RECIPIENT_CITY_INVALID'
  ) {
    return { status: 400, message: 'Revise a chave Pix e os dados do recebedor.', code };
  }
  if (code.startsWith('STORE_PIX_')) {
    return { status: 400, message: 'Não foi possível validar a configuração do Pix próprio.', code };
  }
  console.error('[Store-owned Pix connection]', error);
  return { status: 503, message: 'O cadastro do Pix próprio está temporariamente indisponível.', code };
};

export const createStoreOwnedPixRouter = (): Router => {
  const router = Router();

  router.get('/:storeId/status', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      await requireOwner(request.get('authorization') ?? '', storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.status(200).json(await loadStoreOwnedPixConnectionMetadata(storeId));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  router.put('/:storeId/configuration', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      const actorUserId = await requireOwner(request.get('authorization') ?? '', storeId);
      const metadata = await saveStoreOwnedPixConfiguration({
        storeId,
        configuredByUserId: actorUserId,
        value: request.body,
      });
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.status(200).json(metadata);
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  router.post('/:storeId/disable', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      const actorUserId = await requireOwner(request.get('authorization') ?? '', storeId);
      await disableStoreOwnedPixConfiguration(storeId, actorUserId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.status(200).json({ disabled: true });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  return router;
};
