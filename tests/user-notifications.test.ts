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
import { USER_NOTIFICATION_ORIGIN_TABS, filterUserNotificationsByOrigin, userNotificationOrigin } from '../shared/userNotificationOrigins';

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
    assert.match(allBlock, /transaction\.update\(document\.ref,\{readAt\}\)/);
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

  test('existing notification categories map to the proper single-header tabs without changing the inbox', () => {
    assert.deepEqual(USER_NOTIFICATION_ORIGIN_TABS.map(tab => tab.label), [
      'Todas', 'Comunidades', 'Lojas', 'Pessoas', 'Plataforma',
    ]);
    assert.equal(userNotificationOrigin('community_group_invite'), 'communities');
    assert.equal(userNotificationOrigin('store_chat'), 'stores');
    assert.equal(userNotificationOrigin('order'), 'stores');
    assert.equal(userNotificationOrigin('loyalty'), 'stores');
    assert.equal(userNotificationOrigin('marketing'), 'stores');
    assert.equal(userNotificationOrigin('system'), 'platform');
    assert.equal(userNotificationOrigin('user_forward'), 'people');

    const base = {
      recipientUserId: 'recipient-1',
      eventType: 'received',
      actorPrincipalId: 'actor-1',
      title: 'Evento',
      body: 'Aviso operacional',
      createdAt: '2026-11-20T12:00:00.000Z',
    };
    const items = [
      buildUserNotification({ ...base, category: 'community_group_invite', sourceId: 'g1', target: {
        kind: 'community_group_invite', groupId: 'group1', communityId: 'community1',
      } }),
      buildUserNotification({ ...base, category: 'store_chat', sourceId: 'm1' }),
      buildUserNotification({ ...base, category: 'user_forward', sourceId: 'f1', target: {
        kind: 'community_post', postId: 'post1', communityId: 'community1',
      } }),
      buildUserNotification({ ...base, category: 'system', sourceId: 's1' }),
    ];
    assert.equal(filterUserNotificationsByOrigin(items, 'all').length, 4);
    assert.equal(filterUserNotificationsByOrigin(items, 'communities').length, 1);
    assert.equal(filterUserNotificationsByOrigin(items, 'stores').length, 1);
    assert.equal(filterUserNotificationsByOrigin(items, 'people').length, 1);
    assert.equal(filterUserNotificationsByOrigin(items, 'platform').length, 1);
  });

  test('notification center preserves one global badge and actions across origin tabs', () => {
    const bridge = readFileSync('src/components/UserNotificationCenterBridge.tsx', 'utf8');
    const service = readFileSync('server/notifications/userNotificationService.ts', 'utf8');
    assert.match(bridge, /USER_NOTIFICATION_ORIGIN_TABS\.map\(tab =>/);
    assert.match(bridge, /filterUserNotificationsByOrigin\(notifications, activeOrigin\)/);
    assert.match(bridge, /role="tablist"/);
    assert.match(bridge, /aria-selected=\{activeOrigin === tab\.id\}/);
    assert.match(bridge, /visibleNotifications\.map\(notification =>/);
    assert.match(bridge, /id="canonical-notification-trigger"/);
    assert.match(bridge, /unreadCount > 0/);
    assert.match(bridge, /markAllUserNotificationsRead\(\)/);
    assert.match(bridge, /respondToCommunityGroupInvite\(groupId, decision\)/);
    assert.match(bridge, /OPEN_COMMUNITY_FROM_SQUARE_EVENT/);
    assert.match(service, /'community_group_invite'/);
    assert.match(service, /'user_forward'/);
    assert.match(service, /'community_post'/);
  });

  test('person forwarded publication notifications are authenticated, canonical and idempotent', () => {
    const service = readFileSync('server/notifications/communityPostForwardNotificationService.ts', 'utf8');
    const router = readFileSync('server/notifications/userNotificationRouter.ts', 'utf8');
    const client = readFileSync('src/utils/userNotifications.ts', 'utf8');
    const modal = readFileSync('src/components/modals/ChatModal.tsx', 'utf8');
    const forward = readFileSync('src/utils/communityPostForwarding.ts', 'utf8');
    const rules = readFileSync('firestore.communities.fragment.rules', 'utf8');
    assert.match(router, /issueCommunityPostForwardNotification/);
    assert.match(router, /actorId: identity\.uid/);
    assert.doesNotMatch(router, /recipientId: clean\(request\.body/);
    assert.match(service, /transaction\.getAll\(connectionRef, messageRef\)/);
    assert.match(service, /receipt\.messageId !== messageId/);
    assert.match(service, /conn\.status !== 'accepted'/);
    assert.match(service, /sent\.senderId !== actorId/);
    assert.match(service, /recipientId = sent\.receiverId/);
    assert.match(service, /communitySnap\.data\(\)\?\.visibility !== 'public'/);
    assert.match(service, /if \(existingNotification\.exists\) return \{ created: false \}/);
    assert.match(service, /transaction\.create\(notificationRef, notification\)/);
    assert.match(client, /issueCommunityForwardReceivedNotification/);
    assert.match(modal, /sendCommunityPostToConnectedUser/);
    assert.match(modal, /issueCommunityForwardReceivedNotification/);
    assert.match(forward, /tx\.set\(messageRef/);
    assert.match(forward, /tx\.set\(receiptRef/);
    assert.match(forward, /community_direct_forward_receipts/);
    assert.match(rules, /match \/community_direct_forward_receipts\/\{receiptId\}/);
    assert.match(rules, /duration\.value\(24, 'h'\)/);
    assert.match(rules, /existsAfter\(\/databases\/\$\(database\)\/documents\/social_chats/);
  });

});

test('reserved person notifications are projected server-side before inbox delivery',()=>{
 const service=readFileSync('server/notifications/userNotificationService.ts','utf8');
 const bridge=readFileSync('src/components/UserNotificationCenterBridge.tsx','utf8');
 assert.match(service,/isReservedNotification\(notification,policy.peers\)/);
 assert.match(service,/unread.docs.filter/);
 assert.match(service,/listReservedUserNotifications/);
 assert.match(bridge,/inbox.personalBrowserNotificationsAllowed===true/);
 assert.match(bridge,/sequence!==refreshSequence.current/);
});
