import { adminDb } from '../firebaseAdmin.js';
import {
  buildEmptyStoreCustomerConversation,
  buildStoreCustomerChatMessage,
  buildStoreCustomerThreadId,
  storeCustomerConversationPath,
  storeCustomerMessagesPath,
  type StoreCustomerChatMessage,
  type StoreCustomerChatSenderKind,
  type StoreCustomerConversation,
} from '../../shared/storeCustomerChat.js';
import { buildStoreInstitutionalPrincipalId } from '../../shared/storeInstitutionalIdentity.js';

export type StoreCustomerChatPublicMessage = Omit<
  StoreCustomerChatMessage,
  'actorUserId'
>;

export type StoreCustomerChatMessageView = StoreCustomerChatPublicMessage & {
  actorUserId?: string;
};

export interface StoreCustomerChatThreadView {
  exists: boolean;
  conversation: StoreCustomerConversation;
  messages: StoreCustomerChatMessageView[];
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finiteIso = (value: unknown): string => {
  const normalized = clean(value);
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : '';
};

const parseConversation = (
  value: unknown,
  storeId: string,
  customerId: string
): StoreCustomerConversation => {
  const data = value as Partial<StoreCustomerConversation>;
  const expectedThreadId = buildStoreCustomerThreadId(storeId, customerId);
  const expectedPrincipal = buildStoreInstitutionalPrincipalId(storeId);
  if (
    data.schemaVersion !== 1 ||
    data.storeId !== storeId ||
    data.customerId !== customerId ||
    data.threadId !== expectedThreadId ||
    data.storePrincipalId !== expectedPrincipal ||
    !finiteIso(data.createdAt) ||
    !finiteIso(data.updatedAt) ||
    (data.lastMessageAt !== '' && !finiteIso(data.lastMessageAt)) ||
    typeof data.lastMessagePreview !== 'string' ||
    (data.lastSenderKind !== '' &&
      data.lastSenderKind !== 'customer' &&
      data.lastSenderKind !== 'store') ||
    !Number.isSafeInteger(data.unreadForCustomer) ||
    Number(data.unreadForCustomer) < 0 ||
    !Number.isSafeInteger(data.unreadForStore) ||
    Number(data.unreadForStore) < 0
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
  const expectedThreadId = buildStoreCustomerThreadId(storeId, customerId);
  const expectedPrincipal = data.senderKind === 'store'
    ? buildStoreInstitutionalPrincipalId(storeId)
    : customerId;
  if (
    data.schemaVersion !== 1 ||
    data.storeId !== storeId ||
    data.customerId !== customerId ||
    data.threadId !== expectedThreadId ||
    (data.senderKind !== 'customer' && data.senderKind !== 'store') ||
    data.senderPrincipalId !== expectedPrincipal ||
    !clean(data.id) ||
    !clean(data.actorUserId) ||
    !clean(data.text) ||
    !finiteIso(data.createdAt) ||
    (data.senderKind === 'customer' && data.actorUserId !== customerId)
  ) {
    throw new Error('STORE_CUSTOMER_CHAT_MESSAGE_INVALID');
  }
  return data as StoreCustomerChatMessage;
};

const messageView = (
  message: StoreCustomerChatMessage,
  includeActorUserId: boolean
): StoreCustomerChatMessageView => {
  if (includeActorUserId) return { ...message };
  const { actorUserId: _actorUserId, ...publicMessage } = message;
  return publicMessage;
};

export const sendStoreCustomerChatMessage = async (input: {
  storeId: string;
  customerId: string;
  senderKind: StoreCustomerChatSenderKind;
  actorUserId: string;
  text: string;
  now?: Date;
}): Promise<StoreCustomerChatMessage> => {
  const storeId = clean(input.storeId);
  const customerId = clean(input.customerId);
  const actorUserId = clean(input.actorUserId);
  if (!storeId || !customerId || !actorUserId) {
    throw new Error('STORE_CUSTOMER_CHAT_PARTICIPANT_INVALID');
  }
  if (storeId === customerId) {
    throw new Error('STORE_CUSTOMER_CHAT_SELF_CONVERSATION_INVALID');
  }

  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error('STORE_CUSTOMER_CHAT_TIME_INVALID');
  }
  const createdAt = now.toISOString();
  const conversationRef = adminDb.doc(
    storeCustomerConversationPath(storeId, customerId)
  );
  const messageRef = adminDb
    .collection(storeCustomerMessagesPath(storeId, customerId))
    .doc();
  const message = buildStoreCustomerChatMessage({
    id: messageRef.id,
    storeId,
    customerId,
    senderKind: input.senderKind,
    actorUserId,
    text: input.text,
    createdAt,
  });

  await adminDb.runTransaction(async transaction => {
    const conversationSnapshot = await transaction.get(conversationRef);
    if (input.senderKind === 'store' && !conversationSnapshot.exists) {
      throw new Error('STORE_CUSTOMER_CHAT_THREAD_NOT_FOUND');
    }
    const current = conversationSnapshot.exists
      ? parseConversation(conversationSnapshot.data(), storeId, customerId)
      : buildEmptyStoreCustomerConversation({ storeId, customerId, createdAt });
    const next: StoreCustomerConversation = {
      ...current,
      updatedAt: createdAt,
      lastMessageAt: createdAt,
      lastMessagePreview: message.text.slice(0, 160),
      lastSenderKind: message.senderKind,
      unreadForCustomer:
        message.senderKind === 'store' ? current.unreadForCustomer + 1 : 0,
      unreadForStore:
        message.senderKind === 'customer' ? current.unreadForStore + 1 : 0,
    };
    transaction.set(conversationRef, next);
    transaction.set(messageRef, message);
  });

  return message;
};

export const loadStoreCustomerChatThread = async (input: {
  storeId: string;
  customerId: string;
  includeActorUserId?: boolean;
  limit?: number;
  now?: Date;
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
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error('STORE_CUSTOMER_CHAT_TIME_INVALID');
  }
  const conversation = conversationSnapshot.exists
    ? parseConversation(conversationSnapshot.data(), storeId, customerId)
    : buildEmptyStoreCustomerConversation({
        storeId,
        customerId,
        createdAt: now.toISOString(),
      });
  return {
    exists: conversationSnapshot.exists,
    conversation,
    messages: messageSnapshot.docs.map(document =>
      messageView(
        parseMessage(document.data(), storeId, customerId),
        input.includeActorUserId === true
      )
    ),
  };
};

export const markStoreCustomerChatRead = async (input: {
  storeId: string;
  customerId: string;
  perspective: 'customer' | 'store';
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
    parseConversation(snapshot.data(), storeId, customerId);
    transaction.update(conversationRef, {
      [input.perspective === 'customer'
        ? 'unreadForCustomer'
        : 'unreadForStore']: 0,
    });
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
