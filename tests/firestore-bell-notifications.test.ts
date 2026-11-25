import assert from 'node:assert/strict';
import { after, test } from 'node:test';

// This is a transactional integration test, never a production Firebase test.
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) {
  throw new Error('LOCAL_FIRESTORE_EMULATOR_REQUIRED');
}
process.env.FIREBASE_PROJECT_ID = 'kyrub-security-test';
delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
delete process.env.VERCEL;

const { adminDb } = await import('../server/firebaseAdmin.js');
const { sendNotifiedSocialMessage } = await import('../server/notifications/socialChatNotificationService.js');
const { issueNoteInvitationNotification } = await import('../server/notifications/noteInvitationNotificationService.js');
const { listUserNotifications, markUserNotificationRead } = await import('../server/notifications/userNotificationService.js');

after(async () => {
  await adminDb.terminate();
});

test('authenticated social participants get one DM and one bell alert for retried send', async () => {
  const connectionId = 'notif_dm_accepted';
  const senderId = 'notif_dm_sender';
  const receiverId = 'notif_dm_receiver';
  const messageId = 'notif_dm_message_1';
  await adminDb.doc('connections/' + connectionId).set({
    senderId, receiverId, participantIds: [senderId, receiverId], status: 'accepted',
  });
  const input = { senderId, receiverId, connectionId, messageId, text: 'Oi! Convite para conversar.' };
  const [first, second] = await Promise.all([
    sendNotifiedSocialMessage(input),
    sendNotifiedSocialMessage(input),
  ]);
  assert.deepEqual(new Set([first.created, second.created]), new Set([true, false]));
  const message = await adminDb.doc('social_chats/' + connectionId + '/messages/' + messageId).get();
  assert.equal(message.get('senderId'), senderId);
  assert.equal(message.get('receiverId'), receiverId);
  assert.equal(message.get('text'), input.text);
  assert.ok(message.get('createdAt'));

  const inbox = await listUserNotifications({ recipientUserId: receiverId });
  const alerts = inbox.notifications.filter(n => n.category === 'social_chat');
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].target.kind, 'social_chat');
  assert.equal(alerts[0].target.connectionId, connectionId);
  assert.equal(alerts[0].actorPrincipalId, senderId);
  assert.equal(inbox.unreadCount, 1);
  assert.equal((await listUserNotifications({recipientUserId: senderId})).unreadCount, 0);
  await markUserNotificationRead({recipientUserId: receiverId, notificationId: alerts[0].id});
  assert.equal((await listUserNotifications({recipientUserId: receiverId})).unreadCount, 0);
  await assert.rejects(
    sendNotifiedSocialMessage({ ...input, senderId: 'third_party', messageId: 'forged_message' }),
    /SOCIAL_CHAT_FORBIDDEN/,
  );
  await assert.rejects(
    sendNotifiedSocialMessage({ ...input, text: 'replaced text' }),
    /SOCIAL_CHAT_MESSAGE_CONFLICT/,
  );
  assert.equal((await adminDb.collection('social_chats/' + connectionId + '/messages').get()).size, 1);
});

test('real pending note invitation notifies only its recipient, once', async () => {
  const ownerId = 'notif_note_owner';
  const recipientId = 'notif_note_recipient';
  const noteId = 'notif_note_1';
  const invitationId = ownerId + '__' + noteId + '__' + recipientId;
  await adminDb.doc('users/' + ownerId + '/tasks/' + noteId).set({
    ownerId, title: 'Nota de colaboração', sharedWith: [recipientId],
  });
  await adminDb.doc('note_invitations/' + invitationId).set({
    ownerId, recipientId, noteId,
    sourcePath: 'users/' + ownerId + '/tasks/' + noteId, status: 'pending',
  });
  assert.deepEqual(await issueNoteInvitationNotification({ownerId, invitationId}), {created: true});
  assert.deepEqual(await issueNoteInvitationNotification({ownerId, invitationId}), {created: false});

  const inbox = await listUserNotifications({recipientUserId: recipientId});
  const invitations = inbox.notifications.filter(n => n.category === 'note_invitation');
  assert.equal(invitations.length, 1);
  assert.equal(invitations[0].target.kind, 'note_invitation');
  assert.equal(invitations[0].target.noteInvitationId, invitationId);
  assert.equal(invitations[0].actorPrincipalId, ownerId);
  assert.equal((await listUserNotifications({recipientUserId: ownerId})).unreadCount, 0);

  await assert.rejects(
    issueNoteInvitationNotification({ownerId: 'third_party', invitationId}),
    /NOTE_INVITATION_NOTIFICATION_FORBIDDEN/,
  );
  await adminDb.doc('note_invitations/' + invitationId).update({status: 'revoked'});
  await assert.rejects(
    issueNoteInvitationNotification({ownerId, invitationId}),
    /NOTE_INVITATION_NOTIFICATION_FORBIDDEN/,
  );
  assert.equal((await listUserNotifications({recipientUserId: recipientId})).notifications.length, 1);
});

test('a fabricated or revoked invite cannot trigger an alert for an unrelated user', async () => {
  const ownerId = 'notif_untrusted_owner';
  const recipientId = 'notif_untrusted_recipient';
  const noteId = 'notif_untrusted_note';
  const invitationId = ownerId + '__' + noteId + '__' + recipientId;
  await adminDb.doc('users/' + ownerId + '/tasks/' + noteId).set({
    ownerId, title: 'Privada', sharedWith: ['someone_else'],
  });
  await adminDb.doc('note_invitations/' + invitationId).set({
    ownerId, noteId, recipientId, sourcePath: 'users/' + ownerId + '/tasks/' + noteId,
    status: 'pending',
  });
  await assert.rejects(issueNoteInvitationNotification({ownerId, invitationId}), /NOTE_INVITATION_NOTIFICATION_FORBIDDEN/);
  assert.equal((await listUserNotifications({recipientUserId: recipientId})).notifications.length, 0);
});
