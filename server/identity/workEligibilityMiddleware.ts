import type { NextFunction, Request, Response } from 'express';
import { adminAuth, adminDb } from '../firebaseAdmin';

export type ServerWorkProfile =
  | 'requester'
  | 'freelancer'
  | 'bicycle_courier'
  | 'motorized_courier'
  | 'courier';

const bearerToken = (request: Request): string => {
  const authorization = request.get('authorization') ?? '';
  return /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';
};

export const approvedWorkProfiles = async (uid: string): Promise<Set<string>> => {
  const snapshot = await adminDb.doc(`identity_verifications/${uid}`).get();
  const data = snapshot.data() as Record<string, unknown> | undefined;
  if (!snapshot.exists || data?.status !== 'approved') return new Set();
  return new Set(
    Array.isArray(data.approvedProfiles)
      ? data.approvedProfiles.filter(
          (item): item is string => typeof item === 'string'
        )
      : []
  );
};

export const requireApprovedWorkProfile = async (
  uid: string,
  profile: ServerWorkProfile
): Promise<void> => {
  const profiles = await approvedWorkProfiles(uid);
  const approved = profile === 'courier'
    ? profiles.has('bicycle_courier') || profiles.has('motorized_courier')
    : profiles.has(profile);
  if (!approved) throw new Error('IDENTITY_VERIFICATION_REQUIRED');
};

const requiredProfile = (request: Request): ServerWorkProfile | null => {
  if (
    request.method === 'POST'
    && /^\/orders\/[^/]+\/publish\/?$/.test(request.path)
  ) {
    return 'requester';
  }
  if (
    request.method === 'POST'
    && /^\/[^/]+\/(?:status|secure-pickup|customer-arrival)\/?$/.test(request.path)
  ) {
    return 'courier';
  }
  if (
    request.method === 'POST'
    && /^\/[^/]+\/(?:location|stop)\/?$/.test(request.path)
  ) {
    return 'courier';
  }
  return null;
};

export const enforceDeliveryWorkEligibility = async (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  const profile = requiredProfile(request);
  if (!profile) {
    next();
    return;
  }

  try {
    const token = bearerToken(request);
    if (!token) {
      response.status(401).json({ error: 'Faça login novamente.' });
      return;
    }
    const actor = await adminAuth.verifyIdToken(token, true);
    await requireApprovedWorkProfile(actor.uid, profile);
    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'IDENTITY_VERIFICATION_REQUIRED') {
      response.status(403).json({
        error:
          profile === 'requester'
            ? 'Verifique sua identidade como contratante antes de solicitar uma entrega.'
            : 'Seu perfil de entregador precisa estar aprovado antes de aceitar ou atualizar entregas.',
        code: 'IDENTITY_VERIFICATION_REQUIRED',
      });
      return;
    }
    if (/id-token|expired|revoked|auth/i.test(message)) {
      response.status(401).json({ error: 'Sua sessão expirou. Entre novamente.' });
      return;
    }
    console.error('[Kyrub Work Eligibility]', error);
    response.status(503).json({
      error: 'Não foi possível confirmar sua elegibilidade agora.',
    });
  }
};
