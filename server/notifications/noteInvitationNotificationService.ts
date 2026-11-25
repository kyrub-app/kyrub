import { createHash } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import { buildUserNotification, userNotificationPath } from '../../shared/userNotifications.js';

const validId = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(id);

/**
 * Produces the bell notification for an already-committed note invitation.
 * Verifies the owner, recipient and actual task membership on the server.
 * It does not create/accept notes and never trusts a client recipient field.
 */
export async function issueNoteInvitationNotification(input: {
  ownerId: string;
  invitationId: string;
}): Promise<{ created: boolean }> {
  const { ownerId, invitationId } = input;
  if (!validId(ownerId) || !validId(invitationId)) {
    throw new Error('NOTE_INVITATION_NOTIFICATION_INVALID');
  }
  const invitationRef = adminDb.doc('note_invitations/' + invitationId);
  return adminDb.runTransaction(async transaction => {
    const invitationSnap = await transaction.get(invitationRef);
    const invite = invitationSnap.data();
    if (!invitationSnap.exists || !invite ||
        invite.ownerId !== ownerId || invite.status !== 'pending' ||
        !validId(invite.recipientId) || !validId(invite.noteId) ||
        invite.recipientId === ownerId ||
        invitationId !== ownerId + '__' + invite.noteId + '__' + invite.recipientId ||
        invite.sourcePath !== 'users/' + ownerId + '/tasks/' + invite.noteId) {
      throw new Error('NOTE_INVITATION_NOTIFICATION_FORBIDDEN');
    }
    const taskRef = adminDb.doc('users/' + ownerId + '/tasks/' + invite.noteId);
    const targetId = invite.recipientId as string;
    const sourceHash = createHash('sha256').update(invitationId).digest('hex');
    const notification = buildUserNotification({
      recipientUserId: targetId,
      category: 'note_invitation',
      eventType: 'invited',
      sourceId: sourceHash,
      actorPrincipalId: ownerId,
      title: 'Convite para colaborar em nota',
      body: 'Você foi convidado a participar de uma nota ou tarefa. Abra suas notas compartilhadas para responder.',
      target: { kind: 'note_invitation', noteInvitationId: invitationId },
      createdAt: new Date().toISOString(),
    });
    const notificationRef = adminDb.doc(userNotificationPath(targetId, notification.id));
    const [taskSnap, notificationSnap] = await transaction.getAll(taskRef, notificationRef);
    const task = taskSnap.data();
    if (!taskSnap.exists || !task ||
        !Array.isArray(task.sharedWith) || !task.sharedWith.includes(targetId) ||
        (typeof task.ownerId === 'string' && task.ownerId !== ownerId)) {
      throw new Error('NOTE_INVITATION_NOTIFICATION_FORBIDDEN');
    }
    if (notificationSnap.exists) return { created: false };
    transaction.create(notificationRef, notification);
    return { created: true };
  });
}
