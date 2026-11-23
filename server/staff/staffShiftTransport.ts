import { Router } from 'express';
import { ConsultantHttpError } from '../ai/types.js';
import {
  listAuthorizedStaffShifts,
  listAuthorizedStaffShiftAssignees,
  publishAuthorizedStaffShift,
  cancelAuthorizedStaffShift,
} from './staffShiftService.js';

type Input = {
  method?: string;
  path?: string;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};
type Output = {
  setHeader: (key: string, value: string) => unknown;
  status: (code: number) => {json: (value: unknown) => unknown};
};
const clean = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const errorStatus = (err: unknown): {status: number; code:string; error:string} => {
  if (err instanceof ConsultantHttpError) return err.status === 401
    ? {status:401,code:'AUTH_REQUIRED',error:'Entre na sua conta novamente.'}
    : {status:503,code:'STAFF_SHIFT_AUTH_UNAVAILABLE',error:'Não foi possível validar sua sessão.'};
  const code = err instanceof Error ? err.message : '';
  const known: Record<string,[number,string]> = {
    AUTH_REQUIRED: [401,'Entre na sua conta novamente.'],
    STAFF_NOTICE_FORBIDDEN: [403,'Seu vínculo com a loja está inativo.'],
    STAFF_NOTICE_STORE_INVALID: [404,'Loja indisponível.'],
    STAFF_SHIFT_FORBIDDEN: [403,'Acesso não permitido para esta operação.'],
    STAFF_SHIFT_NOT_FOUND: [404,'Escala indisponível para sua conta.'],
    STAFF_SHIFT_INVALID: [400,'Confira os dados da escala, o horário e o responsável.'],
    STAFF_SHIFT_ASSIGNEE_INVALID: [400,'Escolha um membro ativo da loja.'],
    STAFF_SHIFT_OVERLAP: [409,'Este colaborador já tem uma escala ou folga nesse período.'],
    STAFF_SHIFT_DAY_LIMIT: [409,'O limite de registros deste dia foi atingido.'],
    STAFF_SHIFT_INDEX_INVALID: [503,'O controle de horários precisa de verificação administrativa.'],
    STAFF_SHIFT_IDEMPOTENCY_CONFLICT: [409,'Esta solicitação já foi usada para outra alteração.'],
    STAFF_SHIFT_VERSION_CONFLICT: [409,'Esta escala foi atualizada. Recarregue antes de alterar.'],
    STAFF_TASK_TEAM_LIMIT: [409,'Equipe acima do limite desta versão.'],
    STAFF_TASK_FORBIDDEN: [403,'Acesso exclusivo do gestor.'],
  };
  const mapped = known[code];
  if (!mapped) {
    console.error('[staff-shifts]', err);
    return {status:503,code:'STAFF_SHIFT_UNAVAILABLE',error:'Escalas de trabalho temporariamente indisponíveis.'};
  }
  return {status:mapped[0],code,error:mapped[1]};
};

export const handleStaffShiftRequest = async (request:Input,response:Output):Promise<void> => {
  response.setHeader('Cache-Control','private, no-store, max-age=0');
  response.setHeader('X-Content-Type-Options','nosniff');
  const method=clean(request.method).toUpperCase();
  const path=clean(request.query?.transport)==='staff-shifts'
    ?clean(request.query?.path):clean(request.path);
  const route=path.replace(/^\/+|\/+$/g,'');
  const rawAuth=request.headers?.authorization;
  const authorization=clean(Array.isArray(rawAuth)?rawAuth[0]:rawAuth);
  const body=request.body && typeof request.body==='object' && !Array.isArray(request.body)
    ?request.body as Record<string,unknown>:{};
  const legacyStoreId=clean(method==='GET'?request.query?.storeId:body.storeId);
  try {
    if (method==='GET' && !route) {
      response.status(200).json({shifts:await listAuthorizedStaffShifts({authorization,legacyStoreId})});
      return;
    }
    if (method==='GET' && route==='assignees') {
      response.status(200).json({assignees:await listAuthorizedStaffShiftAssignees({authorization,legacyStoreId})});
      return;
    }
    if (method==='POST' && !route) {
      response.status(200).json({shift:await publishAuthorizedStaffShift({
        authorization,legacyStoreId,requestId:body.requestId,
        kind:body.kind,assignedTo:body.assignedTo,scheduledDate:body.scheduledDate,
        startTime:body.startTime,endTime:body.endTime,endsNextDay:body.endsNextDay,
        sector:body.sector,notes:body.notes,
      })});
      return;
    }
    if (method==='POST' && route==='cancel') {
      response.status(200).json({shift:await cancelAuthorizedStaffShift({
        authorization,legacyStoreId,shiftId:body.shiftId,requestId:body.requestId,
        expectedVersion:body.expectedVersion,reason:body.reason,
      })});
      return;
    }
    response.status(405).json({code:'METHOD_NOT_ALLOWED',error:'Método não permitido.'});
  } catch(err) {
    const mapped=errorStatus(err);
    response.status(mapped.status).json({code:mapped.code,error:mapped.error});
  }
};
export const createStaffShiftRouter=():Router=>{
  const router=Router();
  for(const route of ['/','/assignees','/cancel']) {
    router.all(route,(req,res)=>{
      void handleStaffShiftRequest(req as Input,res as Output);
    });
  }
  return router;
};
