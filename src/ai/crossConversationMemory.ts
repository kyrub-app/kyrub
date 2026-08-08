import type { KyrubAiLocalConversation } from './conversationStore';

export type KyrubiaCrossChatCandidate = {
  conversationId: string;
  title: string;
  topic: string;
  updatedAt: string;
  score: number;
};

export type KyrubiaCrossChatResolution =
  | { kind: 'not_requested' }
  | { kind: 'not_found'; reply: string }
  | {
      kind: 'ambiguous';
      reply: string;
      candidates: KyrubiaCrossChatCandidate[];
    }
  | {
      kind: 'resolved';
      candidate: KyrubiaCrossChatCandidate;
      memoryContext: string;
    };

const CONTINUATION_PATTERN =
  /\b(continuar|continue|continuidade|retomar|retome|voltar|volte|onde paramos|conversa anterior|chat anterior|outro chat|outra conversa|aquela conversa|aquele assunto|falamos|estavamos falando|estávamos falando)\b/i;

const STOP_WORDS = new Set([
  'aquela',
  'aquele',
  'assunto',
  'chat',
  'conversa',
  'continuar',
  'continue',
  'continuidade',
  'daquela',
  'daquele',
  'depois',
  'estavamos',
  'falamos',
  'onde',
  'outra',
  'outro',
  'paramos',
  'retomar',
  'retome',
  'sobre',
  'voltar',
  'volte',
  'vamos',
  'quero',
  'queria',
  'isso',
  'aquilo',
  'com',
  'para',
  'uma',
  'uns',
  'umas',
  'que',
  'dos',
  'das',
  'por',
]);

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const meaningfulTokens = (message: string): string[] =>
  [...new Set(
    normalize(message)
      .split(' ')
      .filter(token => token.length >= 3 && !STOP_WORDS.has(token))
  )].slice(0, 12);

const compact = (value: string, maximum: number): string =>
  value.replace(/\s+/g, ' ').trim().slice(0, maximum);

const scoreConversation = (
  conversation: KyrubAiLocalConversation,
  tokens: string[]
): number => {
  const title = normalize(conversation.title);
  const topic = normalize(conversation.topic);
  const userText = normalize(
    conversation.messages
      .filter(message => message.role === 'user')
      .slice(-8)
      .map(message => message.content)
      .join(' ')
  );
  const assistantText = normalize(
    conversation.messages
      .filter(message => message.role === 'assistant')
      .slice(-6)
      .map(message => message.content)
      .join(' ')
  );

  return tokens.reduce((score, token) => {
    if (title.includes(token)) score += 6;
    if (topic.includes(token)) score += 5;
    if (userText.includes(token)) score += 3;
    if (assistantText.includes(token)) score += 1;
    return score;
  }, 0);
};

const candidateFrom = (
  conversation: KyrubAiLocalConversation,
  score: number
): KyrubiaCrossChatCandidate => ({
  conversationId: conversation.id,
  title: conversation.title,
  topic: conversation.topic,
  updatedAt: conversation.updatedAt,
  score,
});

const buildHistoricalContext = (
  conversation: KyrubAiLocalConversation
): string => {
  const recent = conversation.messages
    .slice(-4)
    .map(message => `${message.role === 'user' ? 'Usuário' : 'Kyrubia'}: ${compact(message.content, 90)}`)
    .join(' | ');

  return compact(
    `Memória transversal da conversa "${conversation.title}". Contexto histórico apenas; não prova estado atual nem autoriza ações. ${recent}`,
    230
  );
};

const ambiguousReply = (candidates: KyrubiaCrossChatCandidate[]): string => {
  const options = candidates
    .slice(0, 3)
    .map((candidate, index) => `${index + 1}. ${candidate.title}`)
    .join('\n');
  return `Encontrei mais de uma conversa que pode ser essa:\n${options}\nDiga o assunto com mais detalhe ou abra a conversa que deseja continuar.`;
};

export const resolveKyrubiaCrossChatContinuation = (
  message: string,
  conversations: KyrubAiLocalConversation[],
  currentConversationId: string
): KyrubiaCrossChatResolution => {
  if (!CONTINUATION_PATTERN.test(message)) return { kind: 'not_requested' };

  const available = conversations
    .filter(conversation =>
      conversation.id !== currentConversationId &&
      conversation.messages.length > 0
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  if (available.length === 0) {
    return {
      kind: 'not_found',
      reply:
        'Não encontrei outra conversa salva neste dispositivo para continuar. Abra a conversa antiga ou me dê mais detalhes sobre o assunto.',
    };
  }

  const tokens = meaningfulTokens(message);
  if (tokens.length === 0) {
    if (available.length === 1) {
      const conversation = available[0];
      return {
        kind: 'resolved',
        candidate: candidateFrom(conversation, 1),
        memoryContext: buildHistoricalContext(conversation),
      };
    }

    const candidates = available.slice(0, 3).map(conversation =>
      candidateFrom(conversation, 0)
    );
    return {
      kind: 'ambiguous',
      candidates,
      reply: ambiguousReply(candidates),
    };
  }

  const ranked = available
    .map(conversation => ({
      conversation,
      score: scoreConversation(conversation, tokens),
    }))
    .filter(item => item.score > 0)
    .sort((left, right) =>
      right.score - left.score ||
      right.conversation.updatedAt.localeCompare(left.conversation.updatedAt)
    );

  if (ranked.length === 0) {
    return {
      kind: 'not_found',
      reply:
        'Não encontrei outra conversa salva neste dispositivo que corresponda a esse assunto. Dê mais detalhes ou abra a conversa antiga.',
    };
  }

  const [first, second] = ranked;
  if (second && second.score >= first.score - 2) {
    const candidates = ranked.slice(0, 3).map(item =>
      candidateFrom(item.conversation, item.score)
    );
    return {
      kind: 'ambiguous',
      candidates,
      reply: ambiguousReply(candidates),
    };
  }

  return {
    kind: 'resolved',
    candidate: candidateFrom(first.conversation, first.score),
    memoryContext: buildHistoricalContext(first.conversation),
  };
};
