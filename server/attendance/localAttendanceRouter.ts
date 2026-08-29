import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { loadOwnerStoreInstitutionalRepresentation } from '../store/storeInstitutionalIdentityService.js';
import {
  closeLocalAttendanceSession,
  listLocalAttendanceSessions,
  openLocalAttendanceSession,
} from './localAttendanceService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const requireStoreAuthority = async (input: {
  authorization: string;
  storeId: string;
}) => {
  const token = bearerToken(input.authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const identity = await verifyFirebaseIdToken(token);
  const representation = await loadOwnerStoreInstitutionalRepresentation({
    storeId: input.storeId,
    authenticatedUserId: identity.uid,
  });
  return representation;
};

const mapError = (error: unknown): { status: number; message: string } => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED') {
    return { status: 401, message: 'Faça login novamente para acessar o atendimento local.' };
  }
  if (message === 'STORE_REPRESENTATION_FORBIDDEN') {
    return { status: 403, message: 'Você não pode operar o atendimento desta loja.' };
  }
  if (message === 'STORE_INSTITUTIONAL_NOT_FOUND') {
    return { status: 404, message: 'A loja ainda não está disponível para atendimento.' };
  }
  if (message === 'LOCAL_ATTENDANCE_NOT_FOUND') {
    return { status: 404, message: 'Atendimento não encontrado.' };
  }
  if (
    message.startsWith('LOCAL_ATTENDANCE_') ||
    message.startsWith('STORE_INSTITUTIONAL_') ||
    message.startsWith('STORE_REPRESENTATION_')
  ) {
    console.warn('[Local attendance]', message);
    return { status: 400, message: 'Os dados do atendimento local são inválidos.' };
  }
  console.error('[Local attendance]', error);
  return { status: 503, message: 'O atendimento local está temporariamente indisponível.' };
};

export const createLocalAttendanceRouter = (): Router => {
  const router = Router();

  router.get('/', async (request, response) => {
    try {
      const storeId = clean(request.query.storeId);
      if (!storeId) throw new Error('LOCAL_ATTENDANCE_STORE_REQUIRED');
      await requireStoreAuthority({
        authorization: request.get('authorization') ?? '',
        storeId,
      });
      response.status(200).json({
        sessions: await listLocalAttendanceSessions({ storeId }),
      });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.post('/open', async (request, response) => {
    try {
      const storeId = clean(request.body?.storeId);
      if (!storeId) throw new Error('LOCAL_ATTENDANCE_STORE_REQUIRED');
      const representation = await requireStoreAuthority({
        authorization: request.get('authorization') ?? '',
        storeId,
      });
      const session = await openLocalAttendanceSession({
        storeId,
        actorUserId: representation.authenticatedUserId,
        customerLabel: request.body?.customerLabel,
        space: request.body?.space,
        itemCount: request.body?.itemCount,
      });
      response.status(201).json({ session });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.post('/:attendanceId/close', async (request, response) => {
    try {
      const storeId = clean(request.body?.storeId);
      if (!storeId) throw new Error('LOCAL_ATTENDANCE_STORE_REQUIRED');
      const representation = await requireStoreAuthority({
        authorization: request.get('authorization') ?? '',
        storeId,
      });
      const session = await closeLocalAttendanceSession({
        storeId,
        attendanceId: clean(request.params.attendanceId),
        actorUserId: representation.authenticatedUserId,
      });
      response.status(200).json({ session });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  return router;
};
