import { adminDb } from '../firebaseAdmin.js';
import { buildUserNotification, userNotificationPath } from '../../shared/userNotifications.js';

const validId = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);

/** The recipient is derived exclusively from a committed authenticated chat
 * message and the matching atomic cooldown receipt, never from request input.
 * A second request for the same message returns an idempotent no-op. */
export const issueCommunityPostForwardNotification = async (input: {
  actorId: string;
  connectionId: string;
  messageId: string;
  postId: string;
}): Promise<{ created: boolean }> => {
  const { actorId, connectionId, messageId, postId } = input;
  if (![actorId, connectionId, messageId, postId].every(validId)) {
    throw new Error('COMMUNITY_FORWARD_NOTIFICATION_INVALID');
  }

  const connectionRef = adminDb.doc(`connections/${connectionId}`);
  const messageRef = adminDb.doc(`social_chats/${connectionId}/messages/${messageId}`);
  return adminDb.runTransaction(async transaction => {
    const [connection, message] = await transaction.getAll(connectionRef, messageRef);
    const conn = connection.data();
    const sent = message.data();
    if (!conn || !sent || conn.status !== 'accepted' ||
      sent.senderId !== actorId ||
      !Array.isArray(conn.participantIds) || !conn.participantIds.includes(actorId) ||
      typeof sent.receiverId !== 'string' || !validId(sent.receiverId) ||
      sent.receiverId === actorId || !conn.participantIds.includes(sent.receiverId)) {
      throw new Error('COMMUNITY_FORWARD_NOTIFICATION_FORBIDDEN');
    }
    const recipientId = sent.receiverId;
    const receiptId = `${postId}__${actorId}__${recipientId}`;
    const receiptRef = adminDb.doc(`community_direct_forward_receipts/${receiptId}`);
    const originalRef = adminDb.doc(`community_posts/${postId}`);
    const notification = buildUserNotification({
      recipientUserId: recipientId,
      category: 'user_forward',
      eventType: 'received',
      sourceId: messageId,
      actorPrincipalId: actorId,
      title: 'Publicação encaminhada por um Kairubido',
      body: 'Abra a publicação original dentro da comunidade.',
      target: { kind: 'community_post', communityId: '', postId },
      createdAt: new Date().toISOString(),
    });
    // The final target is based on the verified canonical post, never on input.
    const notificationRef = adminDb.doc(userNotificationPath(recipientId, notification.id));
    const [receiptSnap, postSnap, existingNotification] = await transaction.getAll(
      receiptRef, originalRef, notificationRef,
    );
    const receipt = receiptSnap.data();
    const source = postSnap.data();
    if (!receipt || !source || receipt.actorId !== actorId ||
      receipt.receiverId !== recipientId || receipt.messageId !== messageId ||
      receipt.connectionId !== connectionId || receipt.postId !== postId ||
      receipt.communityId !== source.communityId || !validId(source.communityId) ||
      typeof sent.text !== 'string' ||
      !sent.text.includes(`?community=${source.communityId}&post=${postId}`)) {
      throw new Error('COMMUNITY_FORWARD_NOTIFICATION_FORBIDDEN');
    }
    const communitySnap = await transaction.get(adminDb.doc(`communities/${source.communityId}`));
    if (!communitySnap.exists || communitySnap.data()?.visibility !== 'public') {
      throw new Error('COMMUNITY_FORWARD_NOTIFICATION_SOURCE_UNAVAILABLE');
    }
    if (existingNotification.exists) return { created: false };
    transaction.create(notificationRef, {
      ...notification,
      target: {
        ...notification.target,
        communityId: source.communityId,
      },
    });
    return { created: true };
  });
};
