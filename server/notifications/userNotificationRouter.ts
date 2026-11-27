import { Router } from 'express';
import {adminAuth,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import { sendNotifiedSocialMessage } from './socialChatNotificationService.js';
import { issueNoteInvitationNotification } from './noteInvitationNotificationService.js';
import { issueCommunityGroupInvitation } from './communityGroupInvitationIssueService.js';
import { issueCommunityPostForwardNotification } from './communityPostForwardNotificationService.js';
import { respondToCommunityGroupInvitation } from './communityGroupInvitationResponseService.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { ConsultantHttpError } from '../ai/types.js';
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

// Only inbox reads/read acknowledgements in the existing isolated Freelas
// environment accept Auth emulator tokens. All production and other operations
// retain the existing signed-token verifier; no change to Kyrubia.
const requireInboxIdentity=async(authorization:string)=>{
 if(process.env.KYRUB_FREELANCE_LOCAL_HOMOLOGATION==='true'&&process.env.KYRUB_PERSONAL_FINANCE_LOCAL_HOMOLOGATION==='true'&&
 !process.env.VERCEL&&!process.env.VERCEL_ENV&&!process.env.FIREBASE_SERVICE_ACCOUNT_JSON&&!process.env.GOOGLE_APPLICATION_CREDENTIALS&&
 process.env.FIREBASE_AUTH_EMULATOR_HOST==='127.0.0.1:9099'&&process.env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8088'&&getFirebaseAdminProjectId()==='kyrub-security-test'){
  try{const token=bearerToken(authorization);if(!token||token.length>8192)throw Error();
   const identity=await adminAuth.verifyIdToken(token,true);if(!/^[A-Za-z0-9_-]{1,128}$/.test(identity.uid))throw Error();
   return {uid:identity.uid};
  }catch{throw Error('AUTH_REQUIRED');}
 }
 return requireIdentity(authorization);
};

const mapError = (error: unknown): { status: number; message: string } => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED' ||
      (error instanceof ConsultantHttpError && error.status === 401)) {
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
  router.use((_request,response,next)=>{response.setHeader('Cache-Control','private, no-store, max-age=0');next();});

  router.get('/', async (request, response) => {
    try {
      const identity = await requireInboxIdentity(request.get('authorization') ?? '');
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
      const identity = await requireInboxIdentity(request.get('authorization') ?? '');
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
      const identity = await requireInboxIdentity(request.get('authorization') ?? '');
      const marked = await markAllUserNotificationsRead({
        recipientUserId: identity.uid,
      });
      response.status(200).json({ marked });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.post('/social-messages/send', async (request, response) => {
    try {
      const identity = await requireIdentity(request.get('authorization') ?? '');
      const result = await sendNotifiedSocialMessage({
        senderId: identity.uid,
        connectionId: clean(request.body?.connectionId),
        receiverId: clean(request.body?.receiverId),
        messageId: clean(request.body?.messageId),
        text: request.body?.text,
      });
      response.status(200).json(result);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'SOCIAL_CHAT_INVALID') {
        response.status(400).json({ error: 'Mensagem ou conversa inválida.' });
      } else if (code.startsWith('SOCIAL_CHAT_')) {
        response.status(403).json({ error: 'Esta conversa não está disponível para envio.' });
      } else {
        const mapped = mapError(error);
        response.status(mapped.status).json({ error: mapped.message });
      }
    }
  });

  router.post('/note-invitations/received', async (request, response) => {
    try {
      const identity = await requireIdentity(request.get('authorization') ?? '');
      const result = await issueNoteInvitationNotification({
        ownerId: identity.uid,
        invitationId: clean(request.body?.invitationId),
      });
      response.status(200).json(result);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'NOTE_INVITATION_NOTIFICATION_INVALID') {
        response.status(400).json({ error: 'Convite inválido.' });
      } else if (code.startsWith('NOTE_INVITATION_NOTIFICATION_')) {
        response.status(403).json({ error: 'Este convite não está disponível.' });
      } else {
        const mapped = mapError(error);
        response.status(mapped.status).json({ error: mapped.message });
      }
    }
  });

  router.post('/community-post-forward/received', async (request, response) => {
    try {
      const identity = await requireIdentity(request.get('authorization') ?? '');
      const result = await issueCommunityPostForwardNotification({
        actorId: identity.uid,
        connectionId: clean(request.body?.connectionId),
        messageId: clean(request.body?.messageId),
        postId: clean(request.body?.postId),
      });
      response.status(200).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'COMMUNITY_FORWARD_NOTIFICATION_INVALID') {
        response.status(400).json({ error: 'Encaminhamento inválido.' });
      } else if (message.startsWith('COMMUNITY_FORWARD_')) {
        response.status(403).json({ error: 'Este encaminhamento não está disponível.' });
      } else {
        const mapped = mapError(error);
        response.status(mapped.status).json({ error: mapped.message });
      }
    }
  });

  router.post('/community-group-invitations/issue', async (request, response) => {
    try {
      const identity = await requireIdentity(request.get('authorization') ?? '');
      const result = await issueCommunityGroupInvitation({
        groupId: clean(request.body?.groupId),
        inviterUserId: identity.uid,
        inviteeUserId: clean(request.body?.inviteeUserId),
      });
      response.status(200).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'COMMUNITY_GROUP_INVITATION_INVALID') {
        response.status(400).json({ error: 'Convite inválido.' });
      } else if (message === 'COMMUNITY_GROUP_INVITATION_NOT_FOUND') {
        response.status(404).json({ error: 'Grupo não encontrado.' });
      } else if (message.startsWith('COMMUNITY_GROUP_')) {
        response.status(403).json({ error: 'Não foi possível convidar este integrante.' });
      } else {
        const mapped = mapError(error);
        response.status(mapped.status).json({ error: mapped.message });
      }
    }
  });

  router.post('/community-group-invitations/respond', async (request, response) => {
    try {
      const identity = await requireIdentity(request.get('authorization') ?? '');
      const decision = request.body?.decision;
      if (decision !== 'accepted' && decision !== 'declined') {
        response.status(400).json({ error: 'Resposta inválida para o convite.' });
        return;
      }
      const result = await respondToCommunityGroupInvitation({
        recipientUserId: identity.uid,
        groupId: clean(request.body?.groupId),
        decision,
      });
      response.status(200).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'COMMUNITY_GROUP_INVITATION_NOT_FOUND') {
        response.status(404).json({ error: 'Convite não encontrado.' });
      } else if (message === 'COMMUNITY_GROUP_INVITATION_NOT_PENDING' ||
        message === 'COMMUNITY_GROUP_MEMBERSHIP_REQUIRED') {
        response.status(409).json({ error: 'Este convite não está mais disponível.' });
      } else if (message === 'COMMUNITY_GROUP_INVITATION_INVALID') {
        response.status(400).json({ error: 'Convite inválido.' });
      } else {
        const mapped = mapError(error);
        response.status(mapped.status).json({ error: mapped.message });
      }
    }
  });

  return router;
};
