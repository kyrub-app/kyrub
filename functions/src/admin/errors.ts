import { HttpsError } from 'firebase-functions/v2/https';
import { AdminAuthorizationError } from './contracts';
import { AdminAuditConflictError } from './audit';
import { AdminRateLimitError } from './rateLimit';

export const toAdminHttpsError = (error: unknown): HttpsError => {
  if (error instanceof HttpsError) return error;

  if (error instanceof AdminAuthorizationError) {
    if (error.code === 'unauthenticated') {
      return new HttpsError('unauthenticated', error.message);
    }
    if (
      error.code === 'admin-suspended' ||
      error.code === 'admin-revoked' ||
      error.code === 'permission-denied'
    ) {
      return new HttpsError('permission-denied', error.message);
    }
    return new HttpsError('failed-precondition', error.message);
  }

  if (error instanceof AdminRateLimitError) {
    return new HttpsError('resource-exhausted', error.message);
  }

  if (error instanceof AdminAuditConflictError) {
    return new HttpsError('already-exists', error.message);
  }

  if (error instanceof Error && error.message.startsWith('requestId')) {
    return new HttpsError('invalid-argument', error.message);
  }

  return new HttpsError(
    'internal',
    'Não foi possível concluir a operação administrativa.'
  );
};
