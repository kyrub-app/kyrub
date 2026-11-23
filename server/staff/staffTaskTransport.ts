import { Router } from 'express';
import { ConsultantHttpError } from '../ai/types.js';
import {
  createAuthorizedStaffTask,
  listAuthorizedStaffTaskAssignees,
  listAuthorizedStaffTasks,
  setAuthorizedStaffTaskStep,
} from './staffTaskService.js';

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
const clean = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const statusFor = (error: unknown): { status: number; code: string; error: string } => {
  if (error instanceof ConsultantHttpError) return error.status === 401
    ? { status: 401, code: 'AUTH_REQUIRED', error: 'Entre novamente na sua conta.' }
    : { status: 503, code: 'STAFF_TASK_AUTH_UNAVAILABLE', error: 'Não foi possível validar a sessão.' };
  const code = error instanceof Error ? error.message : '';
  const known: Record<string, [number, string]> = {
    AUTH_REQUIRED: [401, 'Entre novamente na sua conta.'],
    STAFF_NOTICE_FORBIDDEN: [403, 'Seu vínculo com a loja está inativo.'],
    STAFF_NOTICE_STORE_INVALID: [404, 'Loja indisponível.'],
    STAFF_TASK_FORBIDDEN: [403, 'Acesso não permitido ao colaborador.'],
    STAFF_TASK_NOT_FOUND: [404, 'Tarefa indisponível para sua conta.'],
    STAFF_TASK_INVALID: [400, 'Confira os dados e as etapas do checklist.'],
    STAFF_TASK_ASSIGNEE_INVALID: [400, 'Selecione um colaborador ativo da equipe.'],
    STAFF_TASK_TEAM_LIMIT: [409, 'Equipe acima do limite permitido nesta etapa.'],
    STAFF_TASK_IDEMPOTENCY_CONFLICT: [409, 'Esta operação já foi usada para outra alteração.'],
    STAFF_TASK_VERSION_CONFLICT: [409, 'Esta tarefa foi atualizada. Recarregue e tente novamente.'],
  };
  const entry = known[code];
  if (!entry) {
    console.error('[staff-tasks]', error);
    return { status: 503, code: 'STAFF_TASK_UNAVAILABLE', error: 'As tarefas da equipe estão temporariamente indisponíveis.' };
  }
  return { status: entry[0], code, error: entry[1] };
};

export const handleStaffTaskRequest = async (request: Input, response: Output): Promise<void> => {
  response.setHeader('Cache-Control', 'private, no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const method = clean(request.method).toUpperCase();
  const path = clean(request.query?.transport) === 'staff-tasks'
    ? clean(request.query?.path) : clean(request.path);
  const route = path.replace(/^\/+|\/+$/g, '');
  const rawAuth = request.headers?.authorization;
  const authorization = clean(Array.isArray(rawAuth) ? rawAuth[0] : rawAuth);
  const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
    ? request.body as Record<string, unknown> : {};
  const legacyStoreId = clean(method === 'GET' ? request.query?.storeId : body.storeId);
  try {
    if (method === 'GET' && !route) {
      response.status(200).json({ tasks: await listAuthorizedStaffTasks({ authorization, legacyStoreId }) });
      return;
    }
    if (method === 'GET' && route === 'assignees') {
      response.status(200).json({ assignees: await listAuthorizedStaffTaskAssignees({
        authorization, legacyStoreId,
      }) });
      return;
    }
    if (method === 'POST' && !route) {
      response.status(200).json({ task: await createAuthorizedStaffTask({
        authorization, legacyStoreId, requestId: body.requestId,
        title: body.title, details: body.details,
        assignedTo: body.assignedTo, dueDate: body.dueDate, steps: body.steps,
      }) });
      return;
    }
    if (method === 'POST' && route === 'step') {
      response.status(200).json({ task: await setAuthorizedStaffTaskStep({
        authorization, legacyStoreId, taskId: body.taskId,
        stepId: body.stepId, completed: body.completed,
        expectedVersion: body.expectedVersion, requestId: body.requestId,
      }) });
      return;
    }
    response.status(405).json({ code: 'METHOD_NOT_ALLOWED', error: 'Método não permitido.' });
  } catch (error) {
    const mapped = statusFor(error);
    response.status(mapped.status).json({ code: mapped.code, error: mapped.error });
  }
};

export const createStaffTaskRouter = (): Router => {
  const router = Router();
  for (const route of ['/', '/assignees', '/step']) {
    router.all(route, (req, res) => {
      void handleStaffTaskRequest(req as Input, res as Output);
    });
  }
  return router;
};
