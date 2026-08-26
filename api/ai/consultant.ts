import type {
  KyrubAiConsultantErrorResponse,
} from '../../shared/aiConsultant';
import { authenticateConsultantRequest } from '../../server/ai/consultantAuth';
import { runKyrubConsultant } from '../../server/ai/consultantService';
import { ConsultantHttpError } from '../../server/ai/types';

const json = (body: unknown, status = 200): Response =>
  Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  });

const errorResponse = (error: unknown): Response => {
  if (error instanceof ConsultantHttpError) {
    const payload: KyrubAiConsultantErrorResponse = {
      error: error.message,
      code: error.code,
    };
    return json(payload, error.status);
  }

  console.error('[Kyrub AI] Unhandled Vercel function failure.', error);
  const payload: KyrubAiConsultantErrorResponse = {
    error: 'O Consultor Kyrub está temporariamente indisponível.',
    code: 'AI_UNAVAILABLE',
  };
  return json(payload, 503);
};

const storePromotionResponse = async (request: Request): Promise<Response> => {
  let mapError: ((error: unknown) => { status: number; body: unknown }) | null = null;
  try {
    const [promotion, actionService] = await Promise.all([
      import('../../server/actions/storePromotionExecutionService.js'),
      import('../../server/actions/actionExecutionService.js'),
    ]);
    mapError = actionService.mapKyrubActionExecutionError;
    const body = await request.json().catch(() => ({}));
    if (!promotion.isKyrubStorePromotionExecutionRequest(body)) {
      return json({
        error: 'A promoção precisa ser revisada e confirmada.',
        code: 'INVALID_STORE_PROMOTION_REQUEST',
      }, 400);
    }
    return json(await promotion.executeAuthorizedKyrubStorePromotion(
      request.headers.get('authorization') ?? '',
      body
    ));
  } catch (error) {
    console.error('[StorePromotionExecution]', error);
    const mapped = mapError
      ? mapError(error)
      : {
          status: 503,
          body: {
            error: 'Não foi possível publicar a promoção agora.',
            code: 'STORE_PROMOTION_EXECUTION_UNAVAILABLE',
          },
        };
    return json(mapped.body, mapped.status);
  }
};

export const maxDuration = 30;

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      const payload: KyrubAiConsultantErrorResponse = {
        error: 'Método não permitido.',
        code: 'METHOD_NOT_ALLOWED',
      };
      return json(payload, 405);
    }

    const transport = new URL(request.url).searchParams.get('transport');
    if (transport === 'store-promotion-execute') {
      return storePromotionResponse(request);
    }

    try {
      const user = await authenticateConsultantRequest(
        request.headers.get('authorization')
      );
      const body = await request.json().catch(() => ({}));
      return json(await runKyrubConsultant(body, user));
    } catch (error) {
      return errorResponse(error);
    }
  },
};
