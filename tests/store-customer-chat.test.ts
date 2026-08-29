import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  STORE_CUSTOMER_CHAT_MAX_MESSAGE_LENGTH,
  buildEmptyStoreCustomerConversation,
  buildStoreCustomerChatMessage,
  buildStoreCustomerThreadId,
  normalizeStoreCustomerChatText,
  storeCustomerConversationPath,
} from '../shared/storeCustomerChat';

describe('store customer chat', () => {
  test('thread is deterministic per store and customer', () => {
    assert.equal(
      buildStoreCustomerThreadId('store-1', 'customer-1'),
      'store-1__customer-1'
    );
    assert.equal(
      storeCustomerConversationPath('store-1', 'customer-1'),
      'stores/store-1/customerConversations/store-1__customer-1'
    );
    const thread = buildEmptyStoreCustomerConversation({
      storeId: 'store-1',
      customerId: 'customer-1',
      createdAt: '2026-08-29T12:00:00.000Z',
    });
    assert.equal(thread.storePrincipalId, 'store:store-1');
    assert.equal(thread.unreadForCustomer, 0);
    assert.equal(thread.unreadForStore, 0);
  });

  test('customer and store messages preserve public principal and human actor separately', () => {
    const customer = buildStoreCustomerChatMessage({
      id: 'm1',
      storeId: 'store-1',
      customerId: 'customer-1',
      senderKind: 'customer',
      actorUserId: 'customer-1',
      text: 'Oi, loja',
      createdAt: '2026-08-29T12:00:00.000Z',
    });
    const store = buildStoreCustomerChatMessage({
      id: 'm2',
      storeId: 'store-1',
      customerId: 'customer-1',
      senderKind: 'store',
      actorUserId: 'owner-human-1',
      text: 'Olá! Como podemos ajudar?',
      createdAt: '2026-08-29T12:01:00.000Z',
    });

    assert.equal(customer.senderPrincipalId, 'customer-1');
    assert.equal(customer.actorUserId, 'customer-1');
    assert.equal(store.senderPrincipalId, 'store:store-1');
    assert.equal(store.actorUserId, 'owner-human-1');
    assert.notEqual(store.senderPrincipalId, store.actorUserId);
  });

  test('customer cannot spoof another human actor and message length is bounded', () => {
    assert.throws(
      () => buildStoreCustomerChatMessage({
        id: 'm3',
        storeId: 'store-1',
        customerId: 'customer-1',
        senderKind: 'customer',
        actorUserId: 'customer-2',
        text: 'spoof',
        createdAt: '2026-08-29T12:00:00.000Z',
      }),
      /STORE_CUSTOMER_CHAT_SENDER_INVALID/
    );
    assert.equal(normalizeStoreCustomerChatText('  olá  '), 'olá');
    assert.throws(
      () => normalizeStoreCustomerChatText('x'.repeat(STORE_CUSTOMER_CHAT_MAX_MESSAGE_LENGTH + 1)),
      /STORE_CUSTOMER_CHAT_MESSAGE_TOO_LONG/
    );
  });

  test('server only creates chat for a real canonical store and store cannot cold-start a thread', () => {
    const service = readFileSync('server/chat/storeCustomerChatService.ts', 'utf8');
    assert.match(service, /getPrimaryUserStoreDocumentPath\(storeId\)/);
    assert.match(service, /clean\(data\?\.ownerId\) !== storeId/);
    assert.match(
      service,
      /input\.senderKind === 'store' && !conversationSnapshot\.exists/
    );
    assert.match(service, /STORE_CUSTOMER_CHAT_THREAD_NOT_FOUND/);
  });

  test('reading only clears unread state and does not reorder the inbox', () => {
    const service = readFileSync('server/chat/storeCustomerChatService.ts', 'utf8');
    const start = service.indexOf('export const markStoreCustomerChatRead');
    const end = service.indexOf('export const listStoreCustomerChatInbox');
    const readBlock = service.slice(start, end);
    assert.match(readBlock, /transaction\.update\(conversationRef/);
    assert.match(readBlock, /unreadForCustomer/);
    assert.match(readBlock, /unreadForStore/);
    assert.doesNotMatch(readBlock, /updatedAt/);
    assert.match(service, /orderBy\('updatedAt', 'desc'\)/);
  });

  test('customer identity comes from Firebase token and actor audit is hidden from customer responses', () => {
    const router = readFileSync('server/chat/storeCustomerChatRouter.ts', 'utf8');
    const customerSendStart = router.indexOf("router.post('/send'");
    const customerSendEnd = router.indexOf("router.post('/read'");
    const customerSend = router.slice(customerSendStart, customerSendEnd);
    assert.match(router, /verifyFirebaseIdToken\(token\)/);
    assert.match(customerSend, /customerId: identity\.uid/);
    assert.match(customerSend, /actorUserId: identity\.uid/);
    assert.doesNotMatch(customerSend, /request\.body\?\.customerId/);
    assert.match(customerSend, /actorUserId: _actorUserId/);
  });

  test('store replies require institutional conversation capability and keep actor audit', () => {
    const router = readFileSync('server/chat/storeCustomerChatRouter.ts', 'utf8');
    assert.match(router, /loadOwnerStoreInstitutionalRepresentation/);
    assert.match(router, /capabilities\.includes\('conversation_act'\)/);
    assert.match(router, /senderKind: 'store'/);
    assert.match(router, /actorUserId: identity\.uid/);
    assert.match(router, /includeActorUserId: true/);
  });

  test('client chat uses server API and remains separate from social chat', () => {
    const client = readFileSync('src/utils/storeCustomerChat.ts', 'utf8');
    const socialHook = readFileSync('src/hooks/useChatMessages.ts', 'utf8');
    assert.match(client, /\/api\/store-chat\/thread/);
    assert.match(client, /\/api\/store-chat\/send/);
    assert.match(client, /user\.getIdToken\(\)/);
    assert.doesNotMatch(client, /social_chats/);
    assert.doesNotMatch(client, /addDoc|collection\(db/);
    assert.match(socialHook, /social_chats/);
  });

  test('storefront and CRM expose the same institutional conversation domain', () => {
    const storefront = readFileSync('src/components/StorefrontPanel.tsx', 'utf8');
    const crm = readFileSync(
      'src/components/store/StoreCrmRelationshipPanel.tsx',
      'utf8'
    );
    const modal = readFileSync(
      'src/components/store/StoreCustomerChatModal.tsx',
      'utf8'
    );
    const app = readFileSync('src/App.tsx', 'utf8');

    assert.match(storefront, /<StoreCustomerChatLauncher/);
    assert.match(crm, /openStoreCustomerChat/);
    assert.match(crm, /perspective: 'store'/);
    assert.match(modal, /Respondendo com a identidade institucional da loja/);
    assert.match(modal, /O cliente ainda não iniciou esta conversa/);
    assert.match(app, /<StoreCustomerChatBridge \/>/);
  });

  test('store chat has no KCoin coupling', () => {
    const shared = readFileSync('shared/storeCustomerChat.ts', 'utf8');
    const service = readFileSync('server/chat/storeCustomerChatService.ts', 'utf8');
    assert.doesNotMatch(shared, /kcoin/i);
    assert.doesNotMatch(service, /kcoin/i);
  });
});
