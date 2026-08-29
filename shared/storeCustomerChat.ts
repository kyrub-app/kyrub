import { buildStoreInstitutionalPrincipalId } from './storeInstitutionalIdentity.js';

export const STORE_CUSTOMER_CHAT_SCHEMA_VERSION = 1 as const;
export const STORE_CUSTOMER_CHAT_MAX_MESSAGE_LENGTH = 4000;

export type StoreCustomerChatSenderKind = 'customer' | 'store';

export interface StoreCustomerConversation {
  schemaVersion: typeof STORE_CUSTOMER_CHAT_SCHEMA_VERSION;
  threadId: string;
  storeId: string;
  customerId: string;
  storePrincipalId: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  lastMessagePreview: string;
  lastSenderKind: StoreCustomerChatSenderKind | '';
  unreadForCustomer: number;
  unreadForStore: number;
}

export interface StoreCustomerChatMessage {
  schemaVersion: typeof STORE_CUSTOMER_CHAT_SCHEMA_VERSION;
  id: string;
  threadId: string;
  storeId: string;
  customerId: string;
  senderKind: StoreCustomerChatSenderKind;
  senderPrincipalId: string;
  actorUserId: string;
  text: string;
  orderId: string;
  createdAt: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const validParticipantId = (value: string): boolean =>
  Boolean(value) &&
  value.length <= 128 &&
  /^[a-zA-Z0-9_-]+$/.test(value);

export const buildStoreCustomerThreadId = (
  storeIdInput: string,
  customerIdInput: string
): string => {
  const storeId = clean(storeIdInput);
  const customerId = clean(customerIdInput);
  if (!validParticipantId(storeId) || !validParticipantId(customerId)) {
    throw new Error('STORE_CUSTOMER_CHAT_PARTICIPANT_INVALID');
  }
  return `${storeId}__${customerId}`;
};

export const storeCustomerConversationPath = (
  storeId: string,
  customerId: string
): string =>
  `stores/${storeId}/customerConversations/${buildStoreCustomerThreadId(
    storeId,
    customerId
  )}`;

export const storeCustomerMessagesPath = (
  storeId: string,
  customerId: string
): string => `${storeCustomerConversationPath(storeId, customerId)}/messages`;

export const normalizeStoreCustomerChatText = (value: unknown): string => {
  const text = clean(value);
  if (!text) throw new Error('STORE_CUSTOMER_CHAT_MESSAGE_REQUIRED');
  if (text.length > STORE_CUSTOMER_CHAT_MAX_MESSAGE_LENGTH) {
    throw new Error('STORE_CUSTOMER_CHAT_MESSAGE_TOO_LONG');
  }
  return text;
};

export const buildStoreCustomerChatMessage = (input: {
  id: string;
  storeId: string;
  customerId: string;
  senderKind: StoreCustomerChatSenderKind;
  actorUserId: string;
  text: string;
  orderId?: string;
  createdAt: string;
}): StoreCustomerChatMessage => {
  const id = clean(input.id);
  const actorUserId = clean(input.actorUserId);
  const createdAt = clean(input.createdAt);
  const threadId = buildStoreCustomerThreadId(input.storeId, input.customerId);
  if (!id || !actorUserId || !createdAt || !Number.isFinite(Date.parse(createdAt))) {
    throw new Error('STORE_CUSTOMER_CHAT_MESSAGE_INVALID');
  }
  const senderPrincipalId = input.senderKind === 'store'
    ? buildStoreInstitutionalPrincipalId(input.storeId)
    : input.customerId;
  return {
    schemaVersion: STORE_CUSTOMER_CHAT_SCHEMA_VERSION,
    id,
    threadId,
    storeId: input.storeId,
    customerId: input.customerId,
    senderKind: input.senderKind,
    senderPrincipalId,
    actorUserId,
    text: normalizeStoreCustomerChatText(input.text),
    orderId: clean(input.orderId),
    createdAt,
  };
};

export const buildEmptyStoreCustomerConversation = (input: {
  storeId: string;
  customerId: string;
  createdAt: string;
}): StoreCustomerConversation => {
  const threadId = buildStoreCustomerThreadId(input.storeId, input.customerId);
  if (!Number.isFinite(Date.parse(input.createdAt))) {
    throw new Error('STORE_CUSTOMER_CHAT_TIME_INVALID');
  }
  return {
    schemaVersion: STORE_CUSTOMER_CHAT_SCHEMA_VERSION,
    threadId,
    storeId: input.storeId,
    customerId: input.customerId,
    storePrincipalId: buildStoreInstitutionalPrincipalId(input.storeId),
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    lastMessageAt: '',
    lastMessagePreview: '',
    lastSenderKind: '',
    unreadForCustomer: 0,
    unreadForStore: 0,
  };
};
