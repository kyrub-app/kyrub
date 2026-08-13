import type { KyrubActivityEvent } from '../../shared/kyrubActivityEvents';
import { searchKyrubKnowledge } from '../../shared/kyrubKnowledgeSearch';
import { getOfficialKnowledgeRuntimeSnapshot } from '../knowledge/officialKnowledgeRuntimeCache';
import {
  readRecentKyrubActivityEvents,
  type KyrubActivityStorage,
} from '../observability/kyrubActivityLog';
import { readAuthoritativeActivityRuntimeEvents } from '../observability/kyrubAuthoritativeActivityRuntime';

export type KyrubiaTrustedReadKind =
  | 'recent_activity'
  | 'recent_result'
  | 'official_knowledge'
  | 'official_uncertain';

export type KyrubiaTrustedReadResult = {
  kind: KyrubiaTrustedReadKind;
  reply: string;
};

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\bq\b/g, 'que')
    .replace(/\s+/g, ' ')
    .trim();

const actionLabel = (actionId: string | undefined): string => {
  const labels: Record<string, string> = {
    'store.settings.save': 'salvar as configurações da Loja Kyrub',
    create_product: 'cadastrar um produto pela Kyrubia',
    update_product: 'alterar um produto pela Kyrubia',
    create_note: 'criar uma nota pela Kyrubia',
    create_task: 'criar uma tarefa pela Kyrubia',
    start_store_activation: 'autorizar a ativação da Loja Kyrub pela Kyrubia',
    update_store_profile: 'atualizar o perfil da Loja Kyrub pela Kyrubia',
  };
  return actionId
    ? labels[actionId] ?? `executar ${actionId}`
    : 'executar a ação';
};

const screenLabel = (screenId: string | undefined): string => {
  const labels: Record<string, string> = {
    'home:renda': 'Renda',
    'home:kyrub': 'Kyrub',
    'home:perfil': 'Perfil',
    'erp:panel': 'ERP',
    'store:settings': 'Configurações da Loja',
    'communities:directory': 'Comunidades',
  };
  return screenId ? labels[screenId] ?? screenId : 'uma área do Kyrub';
};

const asksAboutRecentActivity = (message: string): boolean => {
  const intent = normalize(message);
  return /\b(o que eu acabei de fazer|o que acabei de fazer|que eu acabei de fazer|o que acabamos de fazer|o que eu fiz agora|o que fiz agora|o que fizemos agora|o que nos fizemos agora|o que a gente fez agora|qual foi a ultima coisa que eu fiz|o que eu fiz por ultimo)\b/.test(intent);
};

const asksWhetherRecentActionSucceeded = (message: string): boolean => {
  const intent = normalize(message);
  return /\b(deu certo|funcionou|foi salvo|salvou mesmo|conseguiu salvar|a gravacao deu certo|a alteracao deu certo)\b/.test(intent);
};

export const isKyrubiaRecentActionContextQuestion = (
  message: string
): boolean =>
  asksWhetherRecentActionSucceeded(message) || asksAboutRecentActivity(message);

const latestAttempt = (events: KyrubActivityEvent[]): KyrubActivityEvent | null => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === 'interaction.action_attempted' && event.actionId) {
      return event;
    }
  }
  return null;
};

const confirmedOutcomeAfter = (
  authoritativeEvents: KyrubActivityEvent[],
  attempt: KyrubActivityEvent
): KyrubActivityEvent | null => {
  const attemptTime = Date.parse(attempt.occurredAt);
  for (let index = authoritativeEvents.length - 1; index >= 0; index -= 1) {
    const event = authoritativeEvents[index];
    if (
      event.actionId === attempt.actionId &&
      event.authority === 'confirmed_result' &&
      (event.type === 'result.action_succeeded' || event.type === 'result.action_failed') &&
      Date.parse(event.occurredAt) >= attemptTime
    ) {
      return event;
    }
  }
  return null;
};

const recentResultReply = (
  storage: KyrubActivityStorage,
  uid: string
): KyrubiaTrustedReadResult => {
  const observedEvents = readRecentKyrubActivityEvents(storage, uid, 12);
  const attempt = latestAttempt(observedEvents);

  if (!attempt) {
    return {
      kind: 'recent_result',
      reply:
        'Não tenho uma tentativa de ação recente registrada neste navegador para confirmar. Posso afirmar apenas o que o Kyrub observou ou confirmou nesta sessão.',
    };
  }

  const authoritativeEvents = readAuthoritativeActivityRuntimeEvents(uid, 12);
  const outcome = confirmedOutcomeAfter(authoritativeEvents, attempt);
  const label = actionLabel(attempt.actionId);
  if (!outcome) {
    return {
      kind: 'recent_result',
      reply:
        `Eu vi você tentar ${label}, mas não tenho uma confirmação autoritativa desta sessão para essa mesma ação. ` +
        'Então não vou dizer que deu certo apenas porque houve um clique ou porque existe um registro editável no navegador.',
    };
  }

  if (outcome.type === 'result.action_failed') {
    return {
      kind: 'recent_result',
      reply: `Não. O Kyrub registrou uma falha confirmada nesta sessão depois da tentativa de ${label}.`,
    };
  }

  return {
    kind: 'recent_result',
    reply:
      `Sim. Eu vi você tentar ${label} e o Kyrub recebeu uma confirmação autoritativa para essa mesma ação nesta sessão. ` +
      'Nesse caso, não estou inferindo sucesso a partir do clique.',
  };
};

const recentActivityReply = (
  storage: KyrubActivityStorage,
  uid: string
): KyrubiaTrustedReadResult => {
  const events = readRecentKyrubActivityEvents(storage, uid, 6);
  if (events.length === 0) {
    return {
      kind: 'recent_activity',
      reply:
        'Ainda não tenho atividade recente registrada neste navegador para dizer o que você acabou de fazer.',
    };
  }

  const trustedIds = new Set(
    readAuthoritativeActivityRuntimeEvents(uid, 12).map(event => event.id)
  );
  const lines = events.flatMap(event => {
    if (event.type === 'navigation.screen_viewed') {
      return [`- Você esteve em ${screenLabel(event.screenId)}.`];
    }
    if (event.type === 'interaction.action_attempted') {
      return [`- Você tentou ${actionLabel(event.actionId)}.`];
    }
    if (
      event.type === 'result.action_succeeded' &&
      trustedIds.has(event.id)
    ) {
      return [`- O Kyrub confirmou nesta sessão ${actionLabel(event.actionId)}.`];
    }
    if (
      event.type === 'result.action_failed' &&
      trustedIds.has(event.id)
    ) {
      return [`- O Kyrub confirmou nesta sessão uma falha ao ${actionLabel(event.actionId)}.`];
    }
    return [];
  });

  return {
    kind: 'recent_activity',
    reply:
      `Pelo histórico recente que o próprio Kyrub registrou:\n${lines.join('\n')}\n\n` +
      'Navegação e tentativa são contexto. Resultado só aparece aqui como confirmado quando a confirmação autoritativa ocorreu nesta sessão.',
  };
};

const isOfficialProductQuestion = (message: string): boolean => {
  const intent = normalize(message);
  const questionLike = /\?$/.test(message.trim()) ||
    /^(o que|o q|como|qual|quais|quanto|quantos|pra que|por que)\b/.test(intent);
  if (!questionLike) return false;

  return /\b(kyrub|kyrubia)\b/.test(intent) ||
    /\bplano\s+(pro|free|business)\b/.test(intent) ||
    /\b(publicar|publicacao|publicada|ativar|ativacao)\b/.test(intent) ||
    /\bminha loja\b/.test(intent) ||
    /\bloja kyrub\b/.test(intent);
};

const officialKnowledgeReply = (message: string): KyrubiaTrustedReadResult | null => {
  if (!isOfficialProductQuestion(message)) return null;

  const items = getOfficialKnowledgeRuntimeSnapshot();
  if (items.length === 0) {
    return {
      kind: 'official_uncertain',
      reply:
        'A fonte oficial do Manual KYRUB ainda não está disponível nesta sessão. Como a pergunta é sobre uma regra ou funcionamento do próprio Kyrub, não vou completar a resposta por suposição.',
    };
  }

  const results = searchKyrubKnowledge(items, message, 3);
  const top = results[0];
  if (!top) {
    return {
      kind: 'official_uncertain',
      reply:
        'Não encontrei uma correspondência no Manual KYRUB para essa pergunta. Não vou inventar uma regra do produto para preencher essa lacuna.',
    };
  }

  if (top.confidence === 'low') {
    return {
      kind: 'official_uncertain',
      reply:
        `Encontrei uma referência possível no Manual KYRUB (“${top.item.title}”), mas a correspondência lexical é baixa. ` +
        'Como a interpretação semântica ainda não foi validada para uso normal da Kyrubia, não vou transformar esse candidato em resposta oficial.',
    };
  }

  return {
    kind: 'official_knowledge',
    reply: `Segundo o Manual KYRUB — “${top.item.title}”:\n\n${top.item.content}`,
  };
};

export const resolveKyrubiaTrustedReadRuntime = (
  storage: KyrubActivityStorage,
  uid: string,
  message: string
): KyrubiaTrustedReadResult | null => {
  if (asksWhetherRecentActionSucceeded(message)) {
    return recentResultReply(storage, uid);
  }
  if (asksAboutRecentActivity(message)) {
    return recentActivityReply(storage, uid);
  }
  return officialKnowledgeReply(message);
};
