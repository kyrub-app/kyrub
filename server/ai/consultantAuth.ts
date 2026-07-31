import { adminAuth } from '../firebaseAdmin';
import type { AuthenticatedConsultantUser } from './types';
import { ConsultantHttpError } from './types';

const readBearerToken = (authorization: string | null | undefined): string =>
  /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1]?.trim() ?? '';

export const authenticateConsultantRequest = async (
  authorization: string | null | undefined
): Promise<AuthenticatedConsultantUser> => {
  const token = readBearerToken(authorization);
  if (!token) {
    throw new ConsultantHttpError(
      401,
      'AUTH_REQUIRED',
      'Faça login para conversar com o Consultor Kyrub.'
    );
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token, true);
    return {
      uid: decoded.uid,
      name:
        typeof decoded.name === 'string'
          ? decoded.name
          : typeof decoded.email === 'string'
            ? decoded.email.split('@')[0] ?? 'Usuário do Kyrub'
            : 'Usuário do Kyrub',
      email: typeof decoded.email === 'string' ? decoded.email : '',
    };
  } catch (error) {
    console.warn('[Kyrub AI] Invalid Firebase ID token.', error);
    throw new ConsultantHttpError(
      401,
      'AUTH_REQUIRED',
      'Sua sessão expirou. Entre novamente para usar a Kyrub I.A.'
    );
  }
};
