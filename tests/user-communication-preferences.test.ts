import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  buildDefaultUserCommunicationPreferences,
  buildUserCommunicationPreferences,
  shouldDeliverUserNotificationToBrowser,
  userCommunicationPreferencesPath,
} from '../shared/userCommunicationPreferences';
import { buildUserNotification } from '../shared/userNotifications';

const notification = buildUserNotification({
  recipientUserId: 'user-1',
  category: 'store_chat',
  eventType: 'message_received',
  sourceId: 'message-1',
  actorPrincipalId: 'store:store-1',
  title: 'Nova mensagem da loja',
  body: 'Olá',
  target: {
    kind: 'store_chat',
    storeId: 'store-1',
    customerId: 'user-1',
  },
  createdAt: '2026-08-29T12:00:00.000Z',
});

const marketingNotification = buildUserNotification({
  recipientUserId: 'user-1',
  category: 'marketing',
  eventType: 'campaign_message',
  sourceId: 'campaign-1_user-1',
  actorPrincipalId: 'store:store-1',
  title: 'Oferta da loja',
  body: 'Uma novidade para você.',
  target: {
    kind: 'storefront',
    storeId: 'store-1',
    customerId: 'user-1',
  },
  createdAt: '2026-08-29T12:00:00.000Z',
});

describe('user communication preferences', () => {
  test('defaults preserve canonical inbox while browser alerts start opt-in', () => {
    const defaults = buildDefaultUserCommunicationPreferences('user-1');
    assert.equal(defaults.browser.enabled, false);
    assert.deepEqual(defaults.browser.categories, {
      store_chat: true,
      order: true,
      loyalty: true,
      marketing: false,
      system: true,
    });
    assert.equal(shouldDeliverUserNotificationToBrowser(defaults, notification), false);
    assert.equal(
      shouldDeliverUserNotificationToBrowser(defaults, marketingNotification),
      false
    );
  });

  test('browser delivery requires channel, category and recipient match', () => {
    const enabled = buildUserCommunicationPreferences({
      userId: 'user-1',
      browserEnabled: true,
      categories: {
        store_chat: true,
        order: false,
        loyalty: false,
        marketing: false,
        system: false,
      },
      updatedAt: '2026-08-29T12:01:00.000Z',
    });
    assert.equal(shouldDeliverUserNotificationToBrowser(enabled, notification), true);
    assert.equal(
      shouldDeliverUserNotificationToBrowser(enabled, marketingNotification),
      false
    );
    assert.equal(
      shouldDeliverUserNotificationToBrowser(enabled, {
        recipientUserId: 'other-user',
        category: 'store_chat',
      }),
      false
    );
    assert.equal(
      shouldDeliverUserNotificationToBrowser(enabled, {
        recipientUserId: 'user-1',
        category: 'order',
      }),
      false
    );
  });

  test('marketing browser alerts require explicit category opt-in', () => {
    const enabled = buildUserCommunicationPreferences({
      userId: 'user-1',
      browserEnabled: true,
      categories: {
        store_chat: true,
        order: true,
        loyalty: true,
        marketing: true,
        system: true,
      },
      updatedAt: '2026-08-29T12:01:00.000Z',
    });
    assert.equal(
      shouldDeliverUserNotificationToBrowser(enabled, marketingNotification),
      true
    );
  });

  test('preferences use one private deterministic document per user', () => {
    assert.equal(
      userCommunicationPreferencesPath('user-1'),
      'users/user-1/communicationPreferences/current'
    );
  });

  test('server derives preference owner from Firebase token only', () => {
    const router = readFileSync(
      'server/notifications/userCommunicationPreferenceRouter.ts',
      'utf8'
    );
    assert.match(router, /verifyFirebaseIdToken\(token\)/);
    assert.match(router, /loadUserCommunicationPreferences\(identity\.uid\)/);
    assert.match(router, /userId: identity\.uid/);
    assert.doesNotMatch(router, /request\.body\?\.userId/);
    assert.doesNotMatch(router, /request\.query\.userId/);
  });

  test('browser client does not write Firestore or send userId', () => {
    const client = readFileSync(
      'src/utils/userCommunicationPreferences.ts',
      'utf8'
    );
    assert.match(client, /\/api\/communication-preferences/);
    assert.match(client, /user\.getIdToken\(\)/);
    assert.match(client, /browserEnabled: input\.browserEnabled/);
    assert.match(client, /categories: input\.categories/);
    assert.doesNotMatch(client, /userId:/);
    assert.doesNotMatch(client, /setDoc|addDoc|collection\(db|doc\(db/);
  });

  test('canonical event generation does not consult communication preferences', () => {
    const chat = readFileSync('server/chat/storeCustomerChatService.ts', 'utf8');
    const notifications = readFileSync(
      'server/notifications/userNotificationService.ts',
      'utf8'
    );
    assert.match(chat, /transaction\.set\(notificationRef, notification\)/);
    assert.doesNotMatch(chat, /CommunicationPreference|communication-preference/i);
    assert.doesNotMatch(notifications, /CommunicationPreference|communication-preference/i);
  });

  test('browser permission is requested only from explicit preference interaction', () => {
    const modal = readFileSync(
      'src/components/UserCommunicationPreferencesModal.tsx',
      'utf8'
    );
    const toggleStart = modal.indexOf('const toggleBrowser = async');
    const saveStart = modal.indexOf('const save = async');
    const toggleBlock = modal.slice(toggleStart, saveStart);
    assert.match(toggleBlock, /Notification\.requestPermission\(\)/);
    assert.match(modal, /onClick=\{\(\) => void toggleBrowser\(\)\}/);
  });

  test('notification center establishes a silent baseline before browser alerts', () => {
    const bridge = readFileSync(
      'src/components/UserNotificationCenterBridge.tsx',
      'utf8'
    );
    assert.match(bridge, /notificationBaselineRef = useRef<Set<string> \| null>\(null\)/);
    assert.match(bridge, /if \(baseline && currentPreferences\)/);
    assert.match(bridge, /!baseline\.has\(notification\.id\)/);
    assert.match(bridge, /shouldDeliverUserNotificationToBrowser/);
    assert.match(bridge, /showBrowserNotification\(notification, user\)/);
  });

  test('preference UI explains internal inbox remains canonical', () => {
    const modal = readFileSync(
      'src/components/UserCommunicationPreferencesModal.tsx',
      'utf8'
    );
    assert.match(modal, /Caixa interna do Kyrub/);
    assert.match(modal, /não apagam histórico nem silenciam a fonte de verdade/);
    assert.match(modal, /Alertas do navegador/);
    assert.match(modal, /Mensagens de lojas e clientes/);
    assert.match(modal, /Pedidos/);
    assert.match(modal, /Fidelidade/);
    assert.match(modal, /Ofertas e campanhas/);
    assert.match(modal, /desativado por padrão/);
    assert.match(modal, /Sistema/);
  });

  test('direct Firestore access to preferences stays closed to browser clients', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    assert.doesNotMatch(rules, /match \/communicationPreferences\//);
    assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
  });

  test('campaign execution remains outside communication preference V1', () => {
    const shared = readFileSync('shared/userCommunicationPreferences.ts', 'utf8');
    const service = readFileSync(
      'server/notifications/userCommunicationPreferenceService.ts',
      'utf8'
    );
    assert.doesNotMatch(shared, /campaign/i);
    assert.doesNotMatch(service, /campaign/i);
  });
});
