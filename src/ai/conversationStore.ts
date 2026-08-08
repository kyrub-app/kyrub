import type {
  KyrubAiConversationMessage,
  KyrubAiHistoricalLink,
} from '../../shared/aiConsultant';
import type { KyrubiaTurnContext } from '../../shared/kyrubiaContext';

const STORAGE_PREFIX = 'kyrub_ai_conversations_v1';
const HISTORICAL_LINKS_PREFIX = 'kyrub_ai_historical_links_v1';
const MAX_CONVERSATIONS = 20;
const MAX_MESSAGES_PER_CONVERSATION = 100;
const MAX_HISTORICAL_LINKS = 40;

export type KyrubAiLocalConversation = {
  id: string;
  title: string;
  topic: string;
  createdAt: string;
  updatedAt: string;
  messages: KyrubAiConversationMessage[];
  lastTurnContext?: KyrubiaTurnContext;
  historicalLink?: KyrubAiHistoricalLink;
};

const createId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `kyrub-ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const storageKey = (uid: string): string =>
  `${STORAGE_PREFIX}:${uid || 'guest'}`;

const historicalLinksKey = (uid: string): string =>
  `${HISTORICAL_LINKS_PREFIX}:${uid || 'guest'}`;

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

const isHistoricalLink = (value: unknown): value is KyrubAiHistoricalLink => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sourceConversationId === 'string' &&
    typeof candidate.sourceTitle === 'string' &&
    typeof candidate.sourceTopic === 'string' &&
    typeof candidate.sourceUpdatedAt === 'string' &&
    typeof candidate.linkedAt === 'string' &&
    typeof candidate.memoryContext === 'string' &&
    candidate.sourceConversationId.length > 0 &&
    candidate.memoryContext.length > 0
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
    (candidate.lastTurnContext === undefined || isTurnContext(candidate.lastTurnContext)) &&
    (candidate.historicalLink === undefined || isHistoricalLink(candidate.historicalLink))
  );
};

const removeDanglingHistoricalLinks = (
  conversations: KyrubAiLocalConversation[]
): KyrubAiLocalConversation[] => {
  const availableIds = new Set(conversations.map(conversation => conversation.id));
  return conversations.map(conversation => {
    const link = conversation.historicalLink;
    if (!link || availableIds.has(link.sourceConversationId)) return conversation;
    const { historicalLink: _removed, ...withoutLink } = conversation;
    return withoutLink;
  });
};

export const loadKyrubAiConversations = (
  storage: Storage,
  uid: string
): KyrubAiLocalConversation[] => {
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(uid)) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    const conversations = parsed
      .filter(isConversation)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, MAX_CONVERSATIONS);
    return removeDanglingHistoricalLinks(conversations);
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
      historicalLink: conversation.historicalLink && isHistoricalLink(conversation.historicalLink)
        ? {
            ...conversation.historicalLink,
            sourceTitle: conversation.historicalLink.sourceTitle.trim().slice(0, 80),
            sourceTopic: conversation.historicalLink.sourceTopic.trim().slice(0, 80),
            memoryContext: conversation.historicalLink.memoryContext.trim().slice(0, 240),
          }
        : undefined,
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_CONVERSATIONS);
  storage.setItem(
    storageKey(uid),
    JSON.stringify(removeDanglingHistoricalLinks(sanitized))
  );
};

const readHistoricalLinks = (
  storage: Storage,
  uid: string
): Record<string, KyrubAiHistoricalLink> => {
  try {
    const parsed = JSON.parse(storage.getItem(historicalLinksKey(uid)) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter((entry): entry is [string, KyrubAiHistoricalLink] =>
          Boolean(entry[0]) && isHistoricalLink(entry[1])
        )
        .sort((left, right) => right[1].linkedAt.localeCompare(left[1].linkedAt))
        .slice(0, MAX_HISTORICAL_LINKS)
    );
  } catch {
    return {};
  }
};

const writeHistoricalLinks = (
  storage: Storage,
  uid: string,
  links: Record<string, KyrubAiHistoricalLink>
): void => {
  const trimmed = Object.fromEntries(
    Object.entries(links)
      .filter((entry): entry is [string, KyrubAiHistoricalLink] =>
        Boolean(entry[0]) && isHistoricalLink(entry[1])
      )
      .sort((left, right) => right[1].linkedAt.localeCompare(left[1].linkedAt))
      .slice(0, MAX_HISTORICAL_LINKS)
  );
  storage.setItem(historicalLinksKey(uid), JSON.stringify(trimmed));
};

export const saveKyrubAiHistoricalLink = (
  storage: Storage,
  uid: string,
  conversationId: string,
  link: KyrubAiHistoricalLink
): void => {
  if (!conversationId || !isHistoricalLink(link)) return;
  const links = readHistoricalLinks(storage, uid);
  links[conversationId] = {
    ...link,
    sourceTitle: link.sourceTitle.trim().slice(0, 80),
    sourceTopic: link.sourceTopic.trim().slice(0, 80),
    memoryContext: link.memoryContext.trim().slice(0, 240),
  };
  writeHistoricalLinks(storage, uid, links);
};

export const loadKyrubAiHistoricalLink = (
  storage: Storage,
  uid: string,
  conversationId: string
): KyrubAiHistoricalLink | undefined => {
  if (!conversationId) return undefined;
  const links = readHistoricalLinks(storage, uid);
  const link = links[conversationId];
  if (!link) return undefined;

  const sourceStillExists = loadKyrubAiConversations(storage, uid)
    .some(conversation => conversation.id === link.sourceConversationId);
  if (sourceStillExists) return link;

  delete links[conversationId];
  writeHistoricalLinks(storage, uid, links);
  return undefined;
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