import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  USER_NOTIFICATION_MAX_BODY_LENGTH,
  USER_NOTIFICATION_MAX_TITLE_LENGTH,
  buildUserNotification,
  buildUserNotificationId,
  isUserNotificationUnread,
  userNotificationPath,
} from '../shared/userNotifications';

describe('canonical user notifications', () => {
  test('notification id and path are deterministic for one source event', () => {
    const id = buildUserNotificationId({
      category: 'store_chat',
      eventType: 'message_received',
      sourceId: 'message-123',
    });
    assert.equal(id, 'store_chat_message_received_message-123');
    assert.equal(
      userNotificationPath('customer-1', id),
      'users/customer-1/notifications/store_chat_message_received_message-123'
    );
  });

  test('contract truncates display content and starts unread', () => {
    const notification = buildUserNotification({
      recipientUserId: 'customer-1',
      category: 'store_chat',
      eventType: 'message_received',
      sourceId: 'message-1',
      actorPrincipalId: 'store:store-1',
      title: 'T'.repeat(USER_NOTIFICATION_MAX_TITLE_LENGTH + 20),
      body: 'B'.repeat(USER_NOTIFICATION_MAX_BODY_LENGTH + 20),
      target: {
        kind: 'store_chat',
        storeId: 'store-1',
        customerId: 'customer-1',
      },
      createdAt: '2026-08-29T12:00:00.000Z',
    });

    assert.equal(notification.title.length, USER_NOTIFICATION_MAX_TITLE_LENGTH);
    assert.equal(notification.body.length, USER_NOTIFICATION_MAX_BODY_LENGTH);
    assert.equal(notification.readAt, '');
    assert.equal(isUserNotificationUnread(notification), true);
  });

  test('chat message and recipient notification are written in the same transaction', () => {
    const service = readFileSync('server/chat/storeCustomerChatService.ts', 'utf8');
    const transactionStart = service.indexOf('await adminDb.runTransaction');
    const transactionEnd = service.indexOf('\n  return message;', transactionStart);
    const transactionBlock = service.slice(transactionStart, transactionEnd);

    assert.match(service, /buildUserNotification\(/);
    assert.match(service, /userNotificationPath\(/);
    assert.match(service, /message\.senderKind === 'customer' \? storeId : customerId/);
    assert.match(transactionBlock, /transaction\.set\(conversationRef, next\)/);
    assert.match(transactionBlock, /transaction\.set\(messageRef, message\)/);
    assert.match(transactionBlock, /transaction\.set\(notificationRef, notification\)/);
  });

  test('chat event never lets the browser choose notification recipient', () => {
    const chatClient = readFileSync('src/utils/storeCustomerChat.ts', 'utf8');
    const chatRouter = readFileSync('server/chat/storeCustomerChatRouter.ts', 'utf8');
    const notificationClient = readFileSync('src/utils/userNotifications.ts', 'utf8');

    assert.doesNotMatch(chatClient, /recipientUserId/);
    assert.doesNotMatch(chatRouter, /recipientUserId: request\.body/);
    assert.doesNotMatch(notificationClient, /recipientUserId/);
    assert.doesNotMatch(notificationClient, /addDoc|setDoc|collection\(db|doc\(db/);
  });

  test('notification inbox identity comes only from Firebase token', () => {
    const router = readFileSync('server/notifications/userNotificationRouter.ts', 'utf8');
    assert.match(router, /verifyFirebaseIdToken\(token\)/);
    assert.match(router, /recipientUserId: identity\.uid/);
    assert.doesNotMatch(router, /request\.query\.userId/);
    assert.doesNotMatch(router, /request\.body\?\.recipientUserId/);
  });

  test('read operations only mutate readAt and do not rewrite notification payload', () => {
    const service = readFileSync(
      'server/notifications/userNotificationService.ts',
      'utf8'
    );
    const singleStart = service.indexOf('export const markUserNotificationRead');
    const allStart = service.indexOf('export const markAllUserNotificationsRead');
    const singleBlock = service.slice(singleStart, allStart);
    const allBlock = service.slice(allStart);
    const singleUpdates = singleBlock.match(/transaction\.update\([^;]+;/g) ?? [];

    assert.equal(singleUpdates.length, 1);
    assert.match(
      singleUpdates[0],
      /transaction\.update\(reference, \{ readAt: now\.toISOString\(\) \}\);/
    );
    assert.match(allBlock, /batch\.update\(document\.ref, \{ readAt \}\)/);
  });

  test('direct browser Firestore access has no notification rule surface', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    assert.doesNotMatch(rules, /match \/notifications\//);
    assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
  });

  test('app mounts one canonical notification center in the existing header', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    const bridge = readFileSync('src/components/UserNotificationCenterBridge.tsx', 'utf8');

    assert.match(app, /<UserNotificationCenterBridge \/>/);
    assert.match(bridge, /getElementById\('app-header'\)/);
    assert.match(bridge, /canonical-notification-trigger/);
    assert.match(bridge, /canonical-notification-center/);
    assert.match(bridge, /unreadCount/);
    assert.match(bridge, /markAllUserNotificationsRead/);
  });

  test('store chat notification opens the same customer-store thread', () => {
    const bridge = readFileSync('src/components/UserNotificationCenterBridge.tsx', 'utf8');
    assert.match(bridge, /const openNotificationTarget =/);
    assert.match(bridge, /notification\.target\.kind !== 'store_chat'/);
    assert.match(bridge, /openStoreCustomerChat\(/);
    assert.match(bridge, /storeId: notification\.target\.storeId/);
    assert.match(bridge, /customerId: notification\.target\.customerId/);
  });

  test('browser Web Notification remains a channel, not the canonical inbox', () => {
    const legacy = readFileSync('src/LegacyApp.tsx', 'utf8');
    const notificationClient = readFileSync('src/utils/userNotifications.ts', 'utf8');

    assert.match(legacy, /new Notification\(/);
    assert.match(notificationClient, /\/api\/notifications/);
    assert.doesNotMatch(notificationClient, /new Notification\(/);
  });

  test('notifications remain separate from communication preferences and campaigns', () => {
    const shared = readFileSync('shared/userNotifications.ts', 'utf8');
    const service = readFileSync(
      'server/notifications/userNotificationService.ts',
      'utf8'
    );

    assert.doesNotMatch(shared, /preference|campaign/i);
    assert.doesNotMatch(service, /preference|campaign/i);
  });
});
