import type { KyrubAiConversationMessage } from '../../shared/aiConsultant';
import type { KyrubiaTurnContext } from '../../shared/kyrubiaContext';

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
  lastTurnContext?: KyrubiaTurnContext;
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

const isTurnContext = (value: unknown): value is KyrubiaTurnContext => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  const scope = candidate.scope && typeof candidate.scope === 'object'
    ? candidate.scope as Record<string, unknown>
    : null;
  return (
    candidate.version === 1 &&
    candidate.source === 'kyrub_runtime' &&
    typeof candidate.id === 'string' &&
    typeof candidate.sourceAction === 'string' &&
    typeof candidate.generatedAt === 'string' &&
    scope !== null &&
    scope.kind === 'own_store' &&
    (scope.storeId === null || typeof scope.storeId === 'string') &&
    Array.isArray(candidate.entities) &&
    candidate.entities.every(entity => {
      if (!entity || typeof entity !== 'object') return false;
      const reference = entity as Record<string, unknown>;
      return (
        (reference.entityType === 'product' ||
          reference.entityType === 'order' ||
          reference.entityType === 'store') &&
        typeof reference.entityId === 'string' &&
        typeof reference.label === 'string' &&
        typeof reference.position === 'number'
      );
    })
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
    candidate.messages.every(isMessage) &&
    (candidate.lastTurnContext === undefined || isTurnContext(candidate.lastTurnContext))
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
      lastTurnContext: conversation.lastTurnContext && isTurnContext(conversation.lastTurnContext)
        ? conversation.lastTurnContext
        : undefined,
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
