import { Router } from 'express';
import { ConsultantHttpError } from '../ai/types.js';
import {
  acknowledgeAuthorizedStaffPop,
  listAuthorizedStaffPopHistory,
  listAuthorizedStaffProcedures,
  publishAuthorizedStaffProcedure,
  readAuthorizedStaffPopAttachment,
  uploadAuthorizedStaffPopFile,
} from './staffProcedureService.js';

type Request = {
  method?: string;
  path?: string;
  query?: Record<string, unknown>;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
};
type Response = {
  setHeader: (key: string, value: string) => unknown;
  status: (code: number) => Response;
  json: (payload: unknown) => unknown;
  send: (payload: Buffer) => unknown;
};
const clean = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const statusFor = (err: unknown): { status: number; code: string; error: string } => {
  if (err instanceof ConsultantHttpError) return {
    status: err.status === 401 ? 401 : 503,
    code: err.status === 401 ? 'AUTH_REQUIRED' : 'STAFF_POP_AUTH_UNAVAILABLE',
    error: err.status === 401 ? 'Entre na sua conta novamente.' : 'Não foi possível verificar a sessão.',
  };
  const code = err instanceof Error ? err.message : '';
  const errors: Record<string, [number, string]> = {
    AUTH_REQUIRED: [401, 'Entre na sua conta novamente.'],
    STAFF_NOTICE_FORBIDDEN: [403, 'Seu vínculo com a loja não está ativo.'],
    STAFF_NOTICE_STORE_INVALID: [404, 'Loja indisponível.'],
    STAFF_POP_FORBIDDEN: [403, 'Este acesso é exclusivo do gestor autorizado.'],
    STAFF_POP_INVALID: [400, 'Confira o procedimento e seus campos obrigatórios.'],
    STAFF_POP_AUDIENCE_INVALID: [400, 'Selecione um público válido.'],
    STAFF_POP_ATTACHMENT_INVALID: [400, 'Anexo inválido. Use PDF ou imagem com até 1,5 MB.'],
    STAFF_POP_NOT_FOUND: [404, 'Manual indisponível para sua conta.'],
    STAFF_POP_VERSION_CONFLICT: [409, 'O manual foi atualizado por outra pessoa. Atualize e tente novamente.'],
    STAFF_POP_IDEMPOTENCY_CONFLICT: [409, 'Esta tentativa já foi usada com dados diferentes.'],
    STAFF_POP_VERSION_LIMIT: [409, 'O limite de revisões do manual foi atingido.'],
    STAFF_POP_TEAM_LIMIT: [409, 'A equipe excede o limite da versão atual.'],
  };
  const entry = errors[code];
  if (!entry) {
    console.error('[staff-pops]', err);
    return { status: 503, code: 'STAFF_POP_UNAVAILABLE', error: 'Manuais POP temporariamente indisponíveis.' };
  }
  return { status: entry[0], code, error: entry[1] };
};

export async function handleStaffProcedureRequest(request: Request, response: Response): Promise<void> {
  response.setHeader('Cache-Control', 'private, no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const method = clean(request.method).toUpperCase();
  const action = clean(request.query?.transport) === 'staff-pops'
    ? clean(request.query?.path)
    : clean(request.path);
  const route = action.replace(/^\/+|\/+$/g, '');
  const headerValue = request.headers?.authorization;
  const authorization = clean(Array.isArray(headerValue) ? headerValue[0] : headerValue);
  const body = request.body && typeof request.body === 'object' &&
    !Array.isArray(request.body) ? request.body as Record<string, unknown> : {};
  const legacyStoreId = clean(method === 'GET' ? request.query?.storeId : body.storeId);
  try {
    if (method === 'GET' && !route) {
      const procedures = await listAuthorizedStaffProcedures({ authorization, legacyStoreId });
      response.status(200).json({ procedures });
      return;
    }
    if (method === 'GET' && route === 'history') {
      const versions = await listAuthorizedStaffPopHistory({
        authorization, legacyStoreId, procedureId: clean(request.query?.procedureId),
      });
      response.status(200).json({ versions });
      return;
    }
    if (method === 'GET' && route === 'file') {
      const {bytes, name, mimeType} = await readAuthorizedStaffPopAttachment({
        authorization, legacyStoreId,
        procedureId: clean(request.query?.procedureId),
        version: Number(request.query?.version),
      });
      response.setHeader('Content-Type', mimeType);
      response.setHeader('Content-Disposition', 'attachment; filename*=UTF-8' + "''" +
        encodeURIComponent(name.replace(/[\r\n]/g, '_')));
      response.setHeader('Content-Length', String(bytes.length));
      response.status(200).send(bytes);
      return;
    }
    if (method === 'POST' && route === 'upload') {
      const attachment = await uploadAuthorizedStaffPopFile({
        authorization, legacyStoreId,
        procedureId: body.procedureId, requestId: body.requestId,
        name: body.name, mimeType: body.mimeType, dataBase64: body.dataBase64,
      });
      response.status(200).json({ attachment });
      return;
    }
    if (method === 'POST' && !route) {
      const procedure = await publishAuthorizedStaffProcedure({
        authorization, legacyStoreId,
        procedureId: body.procedureId, requestId: body.requestId,
        expectedVersion: body.expectedVersion,
        title: body.title, body: body.body,
        audienceRoles: body.audienceRoles, attachment: body.attachment,
      });
      response.status(200).json({ procedure });
      return;
    }
    if (method === 'POST' && route === 'read') {
      const readAt = await acknowledgeAuthorizedStaffPop({
        authorization, legacyStoreId,
        procedureId: clean(body.procedureId), version: Number(body.version),
      });
      response.status(200).json({ readAt });
      return;
    }
    response.status(405).json({code:'METHOD_NOT_ALLOWED',error:'Método não permitido.'});
  } catch (err) {
    const mapped = statusFor(err);
    response.status(mapped.status).json({code:mapped.code,error:mapped.error});
  }
}

export const createStaffProcedureRouter = (): Router => {
  const router = Router();
  for (const route of ['/', '/upload', '/read', '/history', '/file']) {
    router.all(route, (request, response) => {
      void handleStaffProcedureRequest(request as Request, response as Response);
    });
  }
  return router;
};
