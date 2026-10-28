import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { claimExternalTeamInvitation } from './externalInviteClaimService.js';
import { issueExternalTeamInvitation } from './externalInviteIssueService.js';

const bearer = (value: string): string => /^Bearer\s+(.+)$/i.exec(value)?.[1]?.trim() ?? '';
const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const respondError = (response: import('express').Response, error: unknown): void => {
  const code = error instanceof Error ? error.message : '';
  if (code === 'TEAM_INVITE_INVALID_INPUT') {
    response.status(400).json({ error: 'Dados do convite inválidos.' });
  } else if (code === 'TEAM_INVITE_FORBIDDEN') {
    response.status(403).json({ error: 'Sem permissão para convidar esta função.' });
  } else if (code === 'TEAM_INVITE_STORE_NOT_FOUND') {
    response.status(404).json({ error: 'Loja não encontrada.' });
  } else if (code === 'TEAM_INVITE_MEMBERSHIP_EXISTS') {
    response.status(409).json({ error: 'Já existe um vínculo com esta loja.' });
  } else if (code === 'TEAM_INVITE_UNAVAILABLE') {
    response.status(404).json({ error: 'Convite indisponível ou expirado.' });
  } else if (code === 'AUTH_REQUIRED') {
    response.status(401).json({ error: 'Faça login novamente.' });
  } else {
    console.error('[External team invitations]', error);
    response.status(503).json({ error: 'Serviço de convites temporariamente indisponível.' });
  }
};

export const createExternalTeamInvitationRouter = (): Router => {
  const router = Router();
  router.post('/issue', async (request, response) => {
    try {
      const token = bearer(request.get('authorization') ?? '');
      if (!token) throw new Error('AUTH_REQUIRED');
      const identity = await verifyFirebaseIdToken(token);
      const result = await issueExternalTeamInvitation({
        storeId: clean(request.body?.storeId),
        actorUserId: identity.uid,
        recipientEmail: clean(request.body?.recipientEmail),
        invitedRole: request.body?.role,
      });
      response.status(201).json(result);
    } catch (error) {
      respondError(response, error);
    }
  });
  router.post('/claim', async (request, response) => {
    try {
      const token = bearer(request.get('authorization') ?? '');
      if (!token) throw new Error('AUTH_REQUIRED');
      const identity = await verifyFirebaseIdToken(token);
      const result = await claimExternalTeamInvitation({
        storeId: clean(request.body?.storeId),
        invitationId: clean(request.body?.invitationId),
        token: clean(request.body?.token),
        recipientUserId: identity.uid,
        authenticatedEmail: identity.email,
        emailVerified: identity.emailVerified === true,
        displayName: identity.name,
      });
      response.status(200).json(result);
    } catch (error) {
      respondError(response, error);
    }
  });
  return router;
};
