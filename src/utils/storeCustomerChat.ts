import type { User } from 'firebase/auth';
import type {
  StoreCustomerChatMessage,
  StoreCustomerConversation,
} from '../../shared/storeCustomerChat';
import { auth } from './firebase';

export type StoreCustomerChatMessageView = Omit<
  StoreCustomerChatMessage,
  'actorUserId'
> & {
  actorUserId?: string;
};

export interface StoreCustomerChatThreadView {
  exists: boolean;
  conversation: StoreCustomerConversation;
  messages: StoreCustomerChatMessageView[];
}

const currentUser = (): User => {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente para acessar a conversa.');
  return user;
};

const json = async <T>(response: Response): Promise<T> => {
  const payload = response.status === 204
    ? null
    : await response.json() as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      payload && typeof payload.error === 'string'
        ? payload.error
        : 'O chat da loja está temporariamente indisponível.'
    );
  }
  return payload as T;
};

const authorizedFetch = async (
  user: User,
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> => {
  const token = await user.getIdToken();
  return fetch(input, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
      authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });
};

export const loadCustomerStoreChatThread = async (
  storeId: string
): Promise<StoreCustomerChatThreadView> => {
  const user = currentUser();
  return json<StoreCustomerChatThreadView>(
    await authorizedFetch(
      user,
      `/api/store-chat/thread?storeId=${encodeURIComponent(storeId)}`
    )
  );
};

export const sendCustomerStoreChatMessage = async (input: {
  storeId: string;
  text: string;
}): Promise<StoreCustomerChatMessageView> => {
  const user = currentUser();
  return json<StoreCustomerChatMessageView>(
    await authorizedFetch(user, '/api/store-chat/send', {
      method: 'POST',
      body: JSON.stringify({
        storeId: input.storeId,
        text: input.text,
      }),
    })
  );
};

export const markCustomerStoreChatRead = async (
  storeId: string
): Promise<void> => {
  const user = currentUser();
  await json<null>(
    await authorizedFetch(user, '/api/store-chat/read', {
      method: 'POST',
      body: JSON.stringify({ storeId }),
    })
  );
};

export const loadStoreCustomerChatThreadAsStore = async (input: {
  storeId: string;
  customerId: string;
}): Promise<StoreCustomerChatThreadView> => {
  const user = currentUser();
  return json<StoreCustomerChatThreadView>(
    await authorizedFetch(
      user,
      `/api/store-chat/thread-as-store?storeId=${encodeURIComponent(
        input.storeId
      )}&customerId=${encodeURIComponent(input.customerId)}`
    )
  );
};

export const sendStoreCustomerChatMessageAsStore = async (input: {
  storeId: string;
  customerId: string;
  text: string;
}): Promise<StoreCustomerChatMessageView> => {
  const user = currentUser();
  return json<StoreCustomerChatMessageView>(
    await authorizedFetch(user, '/api/store-chat/send-as-store', {
      method: 'POST',
      body: JSON.stringify({
        storeId: input.storeId,
        customerId: input.customerId,
        text: input.text,
      }),
    })
  );
};

export const markStoreCustomerChatReadAsStore = async (input: {
  storeId: string;
  customerId: string;
}): Promise<void> => {
  const user = currentUser();
  await json<null>(
    await authorizedFetch(user, '/api/store-chat/read-as-store', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  );
};

export const listStoreCustomerChatInbox = async (
  storeId: string
): Promise<StoreCustomerConversation[]> => {
  const user = currentUser();
  const payload = await json<{ conversations?: StoreCustomerConversation[] }>(
    await authorizedFetch(
      user,
      `/api/store-chat/inbox?storeId=${encodeURIComponent(storeId)}`
    )
  );
  return Array.isArray(payload.conversations) ? payload.conversations : [];
};
