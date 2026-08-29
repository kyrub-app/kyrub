import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import {
  listUserNotifications,
  markAllUserNotificationsRead,
  markUserNotificationRead,
} from './userNotificationService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const requireIdentity = async (authorization: string) => {
  const token = bearerToken(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  return verifyFirebaseIdToken(token);
};

const mapError = (error: unknown): { status: number; message: string } => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED') {
    return { status: 401, message: 'Faça login novamente para ver suas notificações.' };
  }
  if (message === 'USER_NOTIFICATION_NOT_FOUND') {
    return { status: 404, message: 'Notificação não encontrada.' };
  }
  if (
    message === 'USER_NOTIFICATION_REQUIRED' ||
    message === 'USER_NOTIFICATION_USER_REQUIRED'
  ) {
    return { status: 400, message: 'Notificação não identificada.' };
  }
  if (message.startsWith('USER_NOTIFICATION_')) {
    console.warn('[User notifications]', message);
    return { status: 409, message: 'As notificações estão com dados inconsistentes.' };
  }
  console.error('[User notifications]', error);
  return { status: 503, message: 'As notificações estão temporariamente indisponíveis.' };
};

export const createUserNotificationRouter = (): Router => {
  const router = Router();

  router.get('/', async (request, response) => {
    try {
      const identity = await requireIdentity(request.get('authorization') ?? '');
      const requestedLimit = Number(request.query.limit ?? 50);
      const inbox = await listUserNotifications({
        recipientUserId: identity.uid,
        limit: Number.isFinite(requestedLimit) ? requestedLimit : 50,
      });
      response.status(200).json(inbox);
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.post('/read', async (request, response) => {
    try {
      const identity = await requireIdentity(request.get('authorization') ?? '');
      await markUserNotificationRead({
        recipientUserId: identity.uid,
        notificationId: clean(request.body?.notificationId),
      });
      response.status(204).end();
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.post('/read-all', async (request, response) => {
    try {
      const identity = await requireIdentity(request.get('authorization') ?? '');
      const marked = await markAllUserNotificationsRead({
        recipientUserId: identity.uid,
      });
      response.status(200).json({ marked });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  return router;
};
