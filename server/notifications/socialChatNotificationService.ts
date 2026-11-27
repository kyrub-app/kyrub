import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { buildUserNotification, userNotificationPath } from '../../shared/userNotifications.js';

const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

/**
 * A normal social DM and its recipient notification share one Firestore
 * transaction. The authenticated sender cannot choose an arbitrary recipient.
 * A stable messageId makes a retry after a network timeout idempotent.
 */
export async function sendNotifiedSocialMessage(input: {
  senderId: string;
  connectionId: string;
  receiverId: string;
  messageId: string;
  text: string;
}): Promise<{ messageId: string; created: boolean }> {
  const { senderId, receiverId, connectionId, messageId } = input;
  const content = typeof input.text === 'string' ? input.text.trim() : '';
  if (![senderId, receiverId, connectionId, messageId].every(validId) ||
      senderId === receiverId || !content || content.length > 4000) {
    throw new Error('SOCIAL_CHAT_INVALID');
  }
  const connectionRef = adminDb.doc('connections/' + connectionId);
  const messageRef = adminDb.doc('social_chats/' + connectionId + '/messages/' + messageId);
  const notification = buildUserNotification({
    recipientUserId: receiverId,
    category: 'social_chat',
    eventType: 'message_received',
    sourceId: createHash('sha256').update(JSON.stringify([connectionId, senderId, messageId])).digest('hex'),
    actorPrincipalId: senderId,
    title: 'Nova mensagem de um Kairubido',
    body: 'Uma pessoa conectada a você enviou uma mensagem. Toque para abrir a conversa.',
    target: { kind: 'social_chat', connectionId },
    createdAt: new Date().toISOString(),
  });
  const notificationRef = adminDb.doc(userNotificationPath(receiverId, notification.id));
  return adminDb.runTransaction(async transaction => {
    const [connSnap, sentSnap, noticeSnap] = await transaction.getAll(
      connectionRef, messageRef, notificationRef,
    );
    const conn = connSnap.data();
    if (!connSnap.exists || !conn || conn.status !== 'accepted' ||
        !Array.isArray(conn.participantIds) || conn.participantIds.length !== 2 ||
        !conn.participantIds.includes(senderId) || !conn.participantIds.includes(receiverId) ||
        new Set(conn.participantIds).size !== 2 ||
        ![conn.senderId, conn.receiverId].includes(senderId) ||
        ![conn.senderId, conn.receiverId].includes(receiverId)) {
      throw new Error('SOCIAL_CHAT_FORBIDDEN');
    }
    if (sentSnap.exists) {
      const sent = sentSnap.data();
      if (!sent || sent.senderId !== senderId || sent.receiverId !== receiverId ||
          sent.text !== content || !noticeSnap.exists ||
          noticeSnap.get('actorPrincipalId') !== senderId || noticeSnap.get('target.connectionId') !== connectionId) {
        throw new Error('SOCIAL_CHAT_MESSAGE_CONFLICT');
      }
      return { messageId, created: false };
    }
    if (noticeSnap.exists) throw new Error('SOCIAL_CHAT_NOTIFICATION_CONFLICT');
    transaction.create(messageRef, {
      senderId, receiverId, text: content, createdAt: FieldValue.serverTimestamp(),
    });
    transaction.create(notificationRef, notification);
    return { messageId, created: true };
  });
}
