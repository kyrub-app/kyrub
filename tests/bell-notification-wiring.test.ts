import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildUserNotification } from '../shared/userNotifications';
import { userNotificationOrigin } from '../shared/userNotificationOrigins';

const read = (path: string): string => readFileSync(path, 'utf8');
const bell = read('src/components/UserNotificationCenterBridge.tsx');
const noteOutbox = read('src/components/NoteInvitationOutboxBridge.tsx');
const chatHook = read('src/hooks/useChatMessages.ts');
const notificationRouter = read('server/notifications/userNotificationRouter.ts');
const notificationService = read('server/notifications/userNotificationService.ts');
const noteService = read('server/notifications/noteInvitationNotificationService.ts');
const dmService = read('server/notifications/socialChatNotificationService.ts');
const serverlessTransport = read('server/notifications/userNotificationsServerlessTransport.ts');
const vercel = JSON.parse(read('vercel.json')) as {
  rewrites: Array<{ source: string; destination: string }>;
};
const routes = new Map(vercel.rewrites.map(route => [route.source, route.destination]));

test('new user notices are canonical, private and appear in the People origin', () => {
  assert.equal(userNotificationOrigin('social_chat'), 'people');
  assert.equal(userNotificationOrigin('note_invitation'), 'people');
  assert.equal(userNotificationOrigin('store_chat'), 'stores');
  for (const [category, target] of [
    ['social_chat', { kind: 'social_chat', connectionId: 'connection1' }],
    ['note_invitation', { kind: 'note_invitation', noteInvitationId: 'owner__note__buyer' }],
  ] as const) {
    const notification = buildUserNotification({
      recipientUserId: 'buyer',
      category,
      eventType: 'received',
      sourceId: 'source-123',
      actorPrincipalId: 'owner',
      title: 'Notificação',
      body: 'Aviso interno.',
      target,
      createdAt: '2026-11-22T17:00:00.000Z',
    });
    assert.equal(notification.recipientUserId, 'buyer');
    assert.equal(notification.readAt, '');
    assert.equal(notification.target.kind, target.kind);
  }
  assert.throws(() => buildUserNotification({
    recipientUserId: 'buyer', category: 'social_chat',
    eventType: 'received', sourceId: 'source-123', actorPrincipalId: 'owner',
    title: 'Notificação', body: '', target: {kind: 'social_chat'},
    createdAt: '2026-11-22T17:00:00.000Z',
  }), /TARGET_INVALID/);
});

test('the bell and its supporting APIs are routed through an existing Vercel function', () => {
  for (const [source, base] of [
    ['/api/notifications', '/api/health?transport=user-notifications'],
    ['/api/store-chat', '/api/health?transport=user-notifications&surface=store-chat'],
    ['/api/communication-preferences', '/api/health?transport=user-notifications&surface=preferences'],
  ]) {
    assert.equal(routes.get(source), base);
    assert.equal(routes.get(source + '/:path*'), base + '&path=:path*');
  }
  assert.match(read('api/health.ts'), /handleUserNotificationsServerlessRequest/);
  assert.match(serverlessTransport, /createUserNotificationRouter/);
  assert.match(serverlessTransport, /createStoreCustomerChatRouter/);
  assert.match(serverlessTransport, /createUserCommunicationPreferenceRouter/);
  assert.match(serverlessTransport, /key === 'transport' \|\| key === 'path'/);
  assert.doesNotMatch(read('server/notifications/userNotificationsServerlessTransport.ts'), /listen\(/);
});

test('note notification is issued after invitation commit, authorized by task and deduplicated', () => {
  assert.match(noteOutbox, /\.then\(\(\) => \{[\s\S]*notifyInvitation\(expected\.id\)/);
  assert.match(noteOutbox, /existing\.status === 'pending'/);
  assert.match(noteService, /invite\.ownerId !== ownerId/);
  assert.match(noteService, /invite\.recipientId/);
  assert.match(noteService, /invite\.sourcePath !== 'users\//);
  assert.match(noteService, /task\.sharedWith\.includes\(targetId\)/);
  assert.match(noteService, /if \(notificationSnap\.exists\) return \{ created: false \}/);
  assert.match(noteService, /transaction\.create\(notificationRef, notification\)/);
  assert.match(notificationRouter, /ownerId: identity\.uid/);
  assert.doesNotMatch(noteService, /transaction\.(set|update|delete)\(taskRef/);
});

test('ordinary social DM is atomic with its alert; caller cannot impersonate another sender', () => {
  assert.match(chatHook, /\/api\/notifications\/social-messages\/send/);
  assert.match(chatHook, /pendingSendRef\.current/);
  assert.doesNotMatch(chatHook, /await addDoc\(/);
  assert.match(dmService, /conn\.status !== 'accepted'/);
  assert.match(dmService, /conn\.participantIds\.includes\(senderId\)/);
  assert.match(dmService, /conn\.participantIds\.includes\(receiverId\)/);
  assert.match(dmService, /sent\.senderId !== senderId/);
  assert.match(dmService, /transaction\.create\(messageRef/);
  assert.match(dmService, /transaction\.create\(notificationRef, notification\)/);
  assert.match(notificationRouter, /senderId: identity\.uid/);
  assert.match(notificationService, /'social_chat'/);
});

test('clicking the bell opens the already authorized note or person conversation', () => {
  assert.match(bell, /kyrub:open-shared-notes/);
  assert.match(bell, /kyrub:open-social-chat/);
  assert.match(read('src/LegacyApp.tsx'), /setShowSharedNotesModal\(true\)/);
  const socialHub = read('src/components/ProfileSocialHubNative.tsx');
  assert.match(socialHub, /kyrub:open-social-chat/);
  assert.match(socialHub, /item\.connectionStatus === 'accepted'/);
  assert.match(socialHub, /setChatTarget\(friend\)/);
  assert.match(bell, /loadUserNotificationInbox/);
  assert.match(notificationRouter, /requireIdentity/);
});

test('notification counting uses aggregation and hidden polling is bounded without delaying permitted browser alerts',()=>{
  assert.match(notificationService,/\.count\(\)\.get\(\)/);
  assert.match(bell,/notificationPollInterval\(document\.hidden,browserAlerts\)/);
  assert.match(bell,/visibilitychange/);
  assert.match(bell,/generation!==refreshGeneration\.current/);
  const readAll=bell.slice(bell.indexOf('const readAll = async'),bell.indexOf('if (!user || !host'));
  assert.match(readAll,/await refresh\(\)/);
  assert.doesNotMatch(readAll,/setUnreadCount\(0\)/);
});

test('bell never disguises a failed silent poll as an empty inbox or leaks an old account response', () => {
  assert.match(bell, /currentUserIdRef\.current !== requestedUserId/);
  assert.match(bell, /auth\.currentUser\?\.uid !== requestedUserId/);
  assert.match(bell, /A silent poll must not silently claim/);
  assert.match(bell, /Não foi possível atualizar as notificações/);
  assert.match(bell, /bg-red-400/);
});
