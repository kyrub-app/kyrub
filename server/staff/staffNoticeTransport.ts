import { Router } from 'express';
import {
  acknowledgeAuthorizedStaffNotice,
  listAuthorizedStaffNotices,
  publishAuthorizedStaffNotice,
} from './staffNoticeService.js';

type Input = {
  method?: string;
  path?: string;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};
type Output = {
  setHeader: (key: string, value: string) => unknown;
  status: (code: number) => { json: (value: unknown) => unknown };
};
const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';
const errorResult = (error: unknown): { status: number; code: string; error: string } => {
  const code = error instanceof Error ? error.message : '';
  const known: Record<string, [number, string]> = {
    AUTH_REQUIRED: [401, 'Entre novamente na sua conta.'],
    STAFF_NOTICE_FORBIDDEN: [403, 'Seu vínculo com a loja não permite esta operação.'],
    STAFF_NOTICE_STORE_INVALID: [404, 'Não foi possível verificar a loja e seu vínculo.'],
    STAFF_NOTICE_NOT_FOUND: [404, 'Aviso indisponível para este colaborador.'],
    STAFF_NOTICE_INVALID: [400, 'Confira o título, a mensagem e o identificador do aviso.'],
    STAFF_NOTICE_INVALID_AUDIENCE: [400, 'Selecione um público válido para o aviso.'],
    STAFF_NOTICE_IDEMPOTENCY_CONFLICT: [409, 'Esta publicação já tem conteúdo diferente.'],
    STAFF_NOTICE_TEAM_LIMIT: [409, 'A equipe excedeu o limite desta primeira versão.'],
  };
  const entry = known[code];
  if (!entry) {
    console.error('[staff-notices]', error);
    return { status: 503, code: 'STAFF_NOTICE_UNAVAILABLE', error: 'Os avisos estão temporariamente indisponíveis.' };
  }
  return { status: entry[0], code, error: entry[1] };
};

export const handleStaffNoticeRequest = async (
  request: Input,
  response: Output
): Promise<void> => {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  const method = clean(request.method).toUpperCase();
  const path = clean(request.query?.path) || clean(request.path);
  const route = path.replace(/^\/+|\/+$/g, '');
  const authorization = clean(request.headers?.authorization);
  const body = request.body && typeof request.body === 'object' &&
    !Array.isArray(request.body) ? request.body as Record<string, unknown> : {};
  const legacyStoreId = clean(method === 'GET' ? request.query?.storeId : body.storeId);
  try {
    if (method === 'GET' && !route) {
      response.status(200).json({
        notices: await listAuthorizedStaffNotices({ authorization, legacyStoreId }),
      });
      return;
    }
    if (method === 'POST' && !route) {
      const notice = await publishAuthorizedStaffNotice({
        authorization,
        legacyStoreId,
        requestId: body.requestId,
        title: body.title,
        body: body.body,
        audienceRoles: body.audienceRoles,
      });
      response.status(200).json({ notice });
      return;
    }
    if (method === 'POST' && route === 'read') {
      const readAt = await acknowledgeAuthorizedStaffNotice({
        authorization, legacyStoreId, noticeId: clean(body.noticeId),
      });
      response.status(200).json({ readAt });
      return;
    }
    response.status(405).json({ code: 'METHOD_NOT_ALLOWED', error: 'Método não permitido.' });
  } catch (error) {
    const mapped = errorResult(error);
    response.status(mapped.status).json({ code: mapped.code, error: mapped.error });
  }
};

export const createStaffNoticeRouter = (): Router => {
  const router = Router();
  router.all('/', (request, response) => {
    void handleStaffNoticeRequest(request as Input, response as Output);
  });
  router.all('/read', (request, response) => {
    void handleStaffNoticeRequest(request as Input, response as Output);
  });
  return router;
};
