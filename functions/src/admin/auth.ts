import type { Firestore } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import {
  AdminAuthorizationError,
  authorizeAdminIdentity,
  type AdminPermission,
  type AdminPrincipal,
  type AuthenticatedIdentity,
} from './contracts';

const adminProfilePath = (uid: string): string =>
  `kyrub_admin/control_plane/admins/${uid}`;

const identityFromCallableRequest = (
  request: CallableRequest<unknown>
): AuthenticatedIdentity | null => {
  if (!request.auth?.uid) return null;
  const token = request.auth.token;

  return {
    uid: request.auth.uid,
    email: typeof token.email === 'string' ? token.email.toLowerCase() : '',
    emailVerified: token.email_verified === true,
  };
};

export const requireActiveAdmin = async (
  firestore: Firestore,
  request: CallableRequest<unknown>,
  requiredPermission: AdminPermission
): Promise<AdminPrincipal> => {
  const identity = identityFromCallableRequest(request);
  if (!identity) {
    throw new AdminAuthorizationError(
      'unauthenticated',
      'Autenticação administrativa obrigatória.'
    );
  }

  const snapshot = await firestore.doc(adminProfilePath(identity.uid)).get();
  return authorizeAdminIdentity(
    identity,
    snapshot.exists ? snapshot.data() : undefined,
    requiredPermission
  );
};
