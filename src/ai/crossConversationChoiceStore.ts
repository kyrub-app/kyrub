import type { KyrubAiLocalConversation } from './conversationStore';
import {
  resolveKyrubiaCrossChatContinuation,
  type KyrubiaCrossChatResolution,
} from './crossConversationMemory';

const STORAGE_PREFIX = 'kyrub_ai_cross_chat_choices_v1';
const MAX_AGE_MS = 10 * 60 * 1000;
const MAX_CANDIDATES = 3;

export type KyrubiaPendingCrossChatChoice = {
  createdAt: string;
  candidateConversationIds: string[];
};

const storageKey = (uid: string, conversationId: string): string =>
  `${STORAGE_PREFIX}:${uid || 'guest'}:${conversationId}`;

const isPendingChoice = (
  value: unknown
): value is KyrubiaPendingCrossChatChoice => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.createdAt === 'string' &&
    Array.isArray(candidate.candidateConversationIds) &&
    candidate.candidateConversationIds.length > 0 &&
    candidate.candidateConversationIds.length <= MAX_CANDIDATES &&
    candidate.candidateConversationIds.every(
      item => typeof item === 'string' && item.length > 0
    )
  );
};

export const saveKyrubiaPendingCrossChatChoice = (
  storage: Storage,
  uid: string,
  conversationId: string,
  candidateConversationIds: string[]
): void => {
  if (!conversationId) return;
  const ids = [...new Set(candidateConversationIds.filter(Boolean))]
    .slice(0, MAX_CANDIDATES);
  if (ids.length === 0) return;
  const value: KyrubiaPendingCrossChatChoice = {
    createdAt: new Date().toISOString(),
    candidateConversationIds: ids,
  };
  storage.setItem(storageKey(uid, conversationId), JSON.stringify(value));
};

export const clearKyrubiaPendingCrossChatChoice = (
  storage: Storage,
  uid: string,
  conversationId: string
): void => {
  if (!conversationId) return;
  storage.removeItem(storageKey(uid, conversationId));
};

export const loadKyrubiaPendingCrossChatChoice = (
  storage: Storage,
  uid: string,
  conversationId: string
): KyrubiaPendingCrossChatChoice | undefined => {
  if (!conversationId) return undefined;
  const key = storageKey(uid, conversationId);
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? 'null');
    if (!isPendingChoice(parsed)) {
      storage.removeItem(key);
      return undefined;
    }
    const createdAt = Date.parse(parsed.createdAt);
    if (!Number.isFinite(createdAt) || Date.now() - createdAt > MAX_AGE_MS) {
      storage.removeItem(key);
      return undefined;
    }
    return parsed;
  } catch {
    storage.removeItem(key);
    return undefined;
  }
};

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const readChoicePosition = (message: string): number | null => {
  const intent = normalize(message);
  const patterns: Array<[RegExp, number]> = [
    [/^(?:quero |escolho |pode ser |fica com )?(?:a |o )?(?:primeira|primeiro|1)(?: opcao| conversa| chat)?$/, 1],
    [/^(?:quero |escolho |pode ser |fica com )?(?:a |o )?(?:segunda|segundo|2)(?: opcao| conversa| chat)?$/, 2],
    [/^(?:quero |escolho |pode ser |fica com )?(?:a |o )?(?:terceira|terceiro|3)(?: opcao| conversa| chat)?$/, 3],
  ];
  return patterns.find(([pattern]) => pattern.test(intent))?.[1] ?? null;
};

export const resolveKyrubiaPendingCrossChatChoice = (
  message: string,
  pending: KyrubiaPendingCrossChatChoice | undefined,
  conversations: KyrubAiLocalConversation[],
  currentConversationId: string
): KyrubiaCrossChatResolution | null => {
  if (!pending) return null;
  const position = readChoicePosition(message);
  if (!position) return null;

  const sourceId = pending.candidateConversationIds[position - 1];
  if (!sourceId) {
    return {
      kind: 'not_found',
      reply: `Essa lista tinha apenas ${pending.candidateConversationIds.length} opções. Escolha uma delas pelo número ou pelo assunto.`,
    };
  }

  const selected = conversations.find(
    conversation => conversation.id === sourceId && conversation.id !== currentConversationId
  );
  if (!selected) {
    return {
      kind: 'not_found',
      reply: 'A conversa escolhida não está mais disponível neste dispositivo. Peça para eu procurar novamente.',
    };
  }

  return resolveKyrubiaCrossChatContinuation(
    'Continue de onde paramos.',
    [selected],
    currentConversationId
  );
};
