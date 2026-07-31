import type { KyrubAiConversationMessage } from '../../shared/aiConsultant';

const STORAGE_PREFIX = 'kyrub_ai_conversations_v1';
const MAX_CONVERSATIONS = 20;
const MAX_MESSAGES_PER_CONVERSATION = 100;

export type KyrubAiLocalConversation = {
  id: string;
  title: string;
  topic: string;
  createdAt: string;
  updatedAt: string;
  messages: KyrubAiConversationMessage[];
};

const createId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `kyrub-ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const storageKey = (uid: string): string =>
  `${STORAGE_PREFIX}:${uid || 'guest'}`;

const isMessage = (value: unknown): value is KyrubAiConversationMessage => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.role === 'user' || candidate.role === 'assistant') &&
    typeof candidate.content === 'string'
  );
};

const isConversation = (value: unknown): value is KyrubAiLocalConversation => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.topic === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string' &&
    Array.isArray(candidate.messages) &&
    candidate.messages.every(isMessage)
  );
};

export const loadKyrubAiConversations = (
  storage: Storage,
  uid: string
): KyrubAiLocalConversation[] => {
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(uid)) ?? '[]');
    return Array.isArray(parsed)
      ? parsed
          .filter(isConversation)
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
          .slice(0, MAX_CONVERSATIONS)
      : [];
  } catch {
    return [];
  }
};

export const saveKyrubAiConversations = (
  storage: Storage,
  uid: string,
  conversations: KyrubAiLocalConversation[]
): void => {
  const sanitized = conversations
    .map(conversation => ({
      ...conversation,
      title: conversation.title.trim().slice(0, 80) || 'Nova solicitação',
      topic: conversation.topic.trim().slice(0, 80) || 'Nova solicitação',
      messages: conversation.messages
        .filter(isMessage)
        .slice(-MAX_MESSAGES_PER_CONVERSATION),
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_CONVERSATIONS);
  storage.setItem(storageKey(uid), JSON.stringify(sanitized));
};

export const createKyrubAiConversation = (
  topic: string,
  title = 'Nova solicitação'
): KyrubAiLocalConversation => {
  const now = new Date().toISOString();
  return {
    id: createId(),
    title,
    topic: topic.trim().slice(0, 80) || 'Nova solicitação',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
};

export const createKyrubAiMessage = (
  role: KyrubAiConversationMessage['role'],
  content: string
): KyrubAiConversationMessage => ({
  id: createId(),
  role,
  content: content.trim(),
  createdAt: new Date().toISOString(),
});

export const titleFromFirstRequest = (content: string): string => {
  const clean = content.replace(/\s+/g, ' ').trim();
  return clean.length > 48 ? `${clean.slice(0, 47).trim()}…` : clean || 'Nova solicitação';
};
