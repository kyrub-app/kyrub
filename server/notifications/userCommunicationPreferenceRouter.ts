import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import type { UserCommunicationCategoryPreferences } from '../../shared/userCommunicationPreferences.js';
import {
  loadUserCommunicationPreferences,
  saveUserCommunicationPreferences,
} from './userCommunicationPreferenceService.js';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const requireIdentity = async (authorization: string) => {
  const token = bearerToken(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  return verifyFirebaseIdToken(token);
};

const boolean = (value: unknown): boolean => {
  if (value === true || value === false) return value;
  throw new Error('USER_COMMUNICATION_PREFERENCES_INVALID');
};

const categoriesFromBody = (
  value: unknown
): UserCommunicationCategoryPreferences => {
  const data = value as Record<string, unknown> | null;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('USER_COMMUNICATION_PREFERENCES_INVALID');
  }
  return {
    store_chat: boolean(data.store_chat),
    order: boolean(data.order),
    loyalty: boolean(data.loyalty),
    marketing: boolean(data.marketing),
    system: boolean(data.system),
  };
};

const mapError = (error: unknown): { status: number; message: string } => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED') {
    return { status: 401, message: 'Faça login novamente para alterar suas preferências.' };
  }
  if (message.startsWith('USER_COMMUNICATION_PREFERENCES_')) {
    console.warn('[Communication preferences]', message);
    return { status: 400, message: 'As preferências informadas são inválidas.' };
  }
  console.error('[Communication preferences]', error);
  return { status: 503, message: 'As preferências estão temporariamente indisponíveis.' };
};

export const createUserCommunicationPreferenceRouter = (): Router => {
  const router = Router();

  router.get('/', async (request, response) => {
    try {
      const identity = await requireIdentity(request.get('authorization') ?? '');
      response.status(200).json(
        await loadUserCommunicationPreferences(identity.uid)
      );
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.put('/', async (request, response) => {
    try {
      const identity = await requireIdentity(request.get('authorization') ?? '');
      const preferences = await saveUserCommunicationPreferences({
        userId: identity.uid,
        browserEnabled: boolean(request.body?.browserEnabled),
        categories: categoriesFromBody(request.body?.categories),
      });
      response.status(200).json(preferences);
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  return router;
};
