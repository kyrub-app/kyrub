import { adminDb } from '../firebaseAdmin.js';
import {
  buildEmptyStoreCustomerConversation,
  buildStoreCustomerChatMessage,
  storeCustomerConversationPath,
  storeCustomerMessagesPath,
  type StoreCustomerChatMessage,
  type StoreCustomerConversation,
  type StoreCustomerChatSenderKind,
} from '../../shared/storeCustomerChat.js';

export type StoreCustomerChatMessageView = Omit<StoreCustomerChatMessage, 'actorUserId'>;

export interface StoreCustomerChatThreadView {
  conversation: StoreCustomerConversation;
  messages: StoreCustomerChatMessageView[];
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const messageView = (
  message: StoreCustomerChatMessage
): StoreCustomerChatMessageView => {
  const { actorUserId: _actorUserId, ...view } = message;
  return view;
};

const parseConversation = (
  value: unknown,
  storeId: string,
  customerId: string
): StoreCustomerConversation => {
  const data = value as Partial<StoreCustomerConversation>;
  if (
    data.schemaVersion !== 1 ||
    data.storeId !== storeId ||
    data.customerId !== customerId ||
    typeof data.threadId !== 'string' ||
    typeof data.storePrincipalId !== 'string' ||
    typeof data.createdAt !== 'string' ||
    typeof data.updatedAt !== 'string' ||
    !Number.isSafeInteger(data.unreadForCustomer) ||
    !Number.isSafeInteger(data.unreadForStore)
  ) {
    throw new Error('STORE_CUSTOMER_CHAT_THREAD_INVALID');
  }
  return data as StoreCustomerConversation;
};

const parseMessage = (
  value: unknown,
  storeId: string,
  customerId: string
): StoreCustomerChatMessage => {
  const data = value as Partial<StoreCustomerChatMessage>;
  if (
    data.schemaVersion !== 1 ||
    data.storeId !== storeId ||
    data.customerId !== customerId ||
    typeof data.id !== 'string' ||
    typeof data.threadId !== 'string' ||
    (data.senderKind !== 'customer' && data.senderKind !== 'store') ||
    typeof data.senderPrincipalId !== 'string' ||
    typeof data.actorUserId !== 'string' ||
    typeof data.text !== 'string' ||
    typeof data.orderId !== 'string' ||
    typeof data.createdAt !== 'string'
  ) {
    throw new Error('STORE_CUSTOMER_CHAT_MESSAGE_INVALID');
  }
  return data as StoreCustomerChatMessage;
};

const assertOrderContext = async (input: {
  storeId: string;
  customerId: string;
  orderId: string;
}): Promise<void> => {
  if (!input.orderId) return;
  const snapshot = await adminDb.doc(
    `stores/${input.storeId}/orders/${input.orderId}`
  ).get();
  if (!snapshot.exists) throw new Error('STORE_CUSTOMER_CHAT_ORDER_NOT_FOUND');
  const order = snapshot.data() as Record<string, unknown>;
  if (
    clean(order.storeId) !== input.storeId ||
    clean(order.buyerId) !== input.customerId
  ) {
    throw new Error('STORE_CUSTOMER_CHAT_ORDER_SCOPE_INVALID');
  }
};

export const sendStoreCustomerChatMessage = async (input: {
  storeId: string;
  customerId: string;
  senderKind: StoreCustomerChatSenderKind;
  actorUserId: string;
  text: string;
  orderId?: string;
  now?: Date;
}): Promise<StoreCustomerChatMessageView> => {
  const storeId = clean(input.storeId);
  const customerId = clean(input.customerId);
  const actorUserId = clean(input.actorUserId);
  const orderId = clean(input.orderId);
  if (!storeId || !customerId || !actorUserId) {
    throw new Error('STORE_CUSTOMER_CHAT_PARTICIPANT_INVALID');
  }
  if (input.senderKind === 'customer' && actorUserId !== customerId) {
    throw new Error('STORE_CUSTOMER_CHAT_SENDER_INVALID');
  }

  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('STORE_CUSTOMER_CHAT_TIME_INVALID');
  const createdAt = now.toISOString();
  await assertOrderContext({ storeId, customerId, orderId });

  const conversationRef = adminDb.doc(
    storeCustomerConversationPath(storeId, customerId)
  );
  const messageRef = adminDb.collection(
    storeCustomerMessagesPath(storeId, customerId)
  ).doc();
  const message = buildStoreCustomerChatMessage({
    id: messageRef.id,
    storeId,
    customerId,
    senderKind: input.senderKind,
    actorUserId,
    text: input.text,
    orderId,
    createdAt,
  });

  await adminDb.runTransaction(async transaction => {
    const conversationSnapshot = await transaction.get(conversationRef);
    const current = conversationSnapshot.exists
      ? parseConversation(conversationSnapshot.data(), storeId, customerId)
      : buildEmptyStoreCustomerConversation({ storeId, customerId, createdAt });
    const preview = message.text.slice(0, 160);
    const next: StoreCustomerConversation = {
      ...current,
      updatedAt: createdAt,
      lastMessageAt: createdAt,
      lastMessagePreview: preview,
      lastSenderKind: message.senderKind,
      unreadForCustomer:
        message.senderKind === 'store' ? current.unreadForCustomer + 1 : 0,
      unreadForStore:
        message.senderKind === 'customer' ? current.unreadForStore + 1 : 0,
    };
    transaction.set(conversationRef, next);
    transaction.set(messageRef, message);
  });

  return messageView(message);
};

export const loadStoreCustomerChatThread = async (input: {
  storeId: string;
  customerId: string;
  limit?: number;
}): Promise<StoreCustomerChatThreadView> => {
  const storeId = clean(input.storeId);
  const customerId = clean(input.customerId);
  if (!storeId || !customerId) {
    throw new Error('STORE_CUSTOMER_CHAT_PARTICIPANT_INVALID');
  }
  const maxMessages = Math.max(1, Math.min(200, input.limit ?? 100));
  const conversationRef = adminDb.doc(
    storeCustomerConversationPath(storeId, customerId)
  );
  const [conversationSnapshot, messageSnapshot] = await Promise.all([
    conversationRef.get(),
    adminDb
      .collection(storeCustomerMessagesPath(storeId, customerId))
      .orderBy('createdAt', 'asc')
      .limitToLast(maxMessages)
      .get(),
  ]);
  const conversation = conversationSnapshot.exists
    ? parseConversation(conversationSnapshot.data(), storeId, customerId)
    : buildEmptyStoreCustomerConversation({
        storeId,
        customerId,
        createdAt: new Date().toISOString(),
      });
  const messages = messageSnapshot.docs.map(document =>
    messageView(parseMessage(document.data(), storeId, customerId))
  );
  return { conversation, messages };
};

export const markStoreCustomerChatRead = async (input: {
  storeId: string;
  customerId: string;
  perspective: 'customer' | 'store';
  now?: Date;
}): Promise<void> => {
  const storeId = clean(input.storeId);
  const customerId = clean(input.customerId);
  if (!storeId || !customerId) {
    throw new Error('STORE_CUSTOMER_CHAT_PARTICIPANT_INVALID');
  }
  const conversationRef = adminDb.doc(
    storeCustomerConversationPath(storeId, customerId)
  );
  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(conversationRef);
    if (!snapshot.exists) return;
    const current = parseConversation(snapshot.data(), storeId, customerId);
    transaction.update(conversationRef, {
      updatedAt: (input.now ?? new Date()).toISOString(),
      [input.perspective === 'customer'
        ? 'unreadForCustomer'
        : 'unreadForStore']: 0,
    });
    void current;
  });
};

export const listStoreCustomerChatInbox = async (input: {
  storeId: string;
  limit?: number;
}): Promise<StoreCustomerConversation[]> => {
  const storeId = clean(input.storeId);
  if (!storeId) throw new Error('STORE_CUSTOMER_CHAT_PARTICIPANT_INVALID');
  const maxThreads = Math.max(1, Math.min(100, input.limit ?? 50));
  const snapshot = await adminDb
    .collection(`stores/${storeId}/customerConversations`)
    .orderBy('updatedAt', 'desc')
    .limit(maxThreads)
    .get();
  return snapshot.docs.map(document => {
    const data = document.data() as Partial<StoreCustomerConversation>;
    return parseConversation(data, storeId, clean(data.customerId));
  });
};
