import type { KyrubAiConversationMessage } from '../../shared/aiConsultant';
import type { KyrubAiLocalConversation } from './conversationStore';
import {
  resolveKyrubiaCrossChatContinuation,
  type KyrubiaCrossChatResolution,
} from './crossConversationMemory';

const STORAGE_PREFIX = 'kyrub_ai_cross_chat_choices_v1';
export const KYRUBIA_CROSS_CHAT_CHOICE_MAX_AGE_MS = 10 * 60 * 1000;
const MAX_CANDIDATES = 3;
const AMBIGUOUS_REPLY_MARKER =
  'Encontrei mais de uma conversa que pode ser essa:';

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

const isFresh = (createdAt: string): boolean => {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return false;
  const age = Date.now() - timestamp;
  return age >= 0 && age <= KYRUBIA_CROSS_CHAT_CHOICE_MAX_AGE_MS;
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
    if (!isPendingChoice(parsed) || !isFresh(parsed.createdAt)) {
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

export const hasImmediateKyrubiaCrossChatDisambiguation = (
  messages: KyrubAiConversationMessage[]
): boolean => {
  const latest = messages.at(-1);
  const previous = messages.at(-2);
  return Boolean(
    latest?.role === 'user' &&
    previous?.role === 'assistant' &&
    previous.content.includes(AMBIGUOUS_REPLY_MARKER) &&
    previous.createdAt &&
    isFresh(previous.createdAt)
  );
};

export const rebuildKyrubiaPendingCrossChatChoice = (
  messages: KyrubAiConversationMessage[],
  conversations: KyrubAiLocalConversation[],
  currentConversationId: string
): KyrubiaPendingCrossChatChoice | undefined => {
  if (!hasImmediateKyrubiaCrossChatDisambiguation(messages)) return undefined;

  const previousAssistant = messages.at(-2);
  const priorUser = [...messages.slice(0, -2)]
    .reverse()
    .find(message => message.role === 'user');
  if (!previousAssistant?.createdAt || !priorUser) return undefined;

  const resolution = resolveKyrubiaCrossChatContinuation(
    priorUser.content,
    conversations,
    currentConversationId
  );
  if (resolution.kind !== 'ambiguous') return undefined;

  return {
    createdAt: previousAssistant.createdAt,
    candidateConversationIds: resolution.candidates
      .slice(0, MAX_CANDIDATES)
      .map(candidate => candidate.conversationId),
  };
};

export const resolveKyrubiaPendingCrossChatChoice = (
  message: string,
  pending: KyrubiaPendingCrossChatChoice | undefined,
  conversations: KyrubAiLocalConversation[],
  currentConversationId: string
): KyrubiaCrossChatResolution | null => {
  if (!pending || !isFresh(pending.createdAt)) return null;
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
