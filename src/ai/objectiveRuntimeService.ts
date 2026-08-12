import {
  buildKyrubiaObjectiveContext,
  formatKyrubiaQuotedLabel,
  formatKyrubiaQuotedSentence,
  formatKyrubiaSentence,
  inferKyrubiaObjectiveScope,
  renderKyrubiaObjective,
  renderKyrubiaObjectiveList,
  resolveKyrubiaObjectiveCommand,
} from './objectiveMemory';
import {
  addKyrubiaObjectiveProgress,
  completeKyrubiaObjective,
  createKyrubiaObjective,
  inheritKyrubiaObjectiveLink,
  linkKyrubiaConversationToObjective,
  listActiveKyrubiaObjectives,
  loadKyrubiaLinkedObjective,
  setKyrubiaObjectiveNextStep,
  upsertKyrubiaObjective,
  type KyrubiaActiveObjective,
} from './objectiveStore';
import { resolveKyrubiaTrustedReadRuntime } from './trustedReadRuntime';

export type KyrubiaObjectiveRuntimeResult = {
  reply: string;
  objective?: KyrubiaActiveObjective;
};

const missingLinkedObjectiveReply = (): string =>
  'Este chat ainda não está vinculado a um objetivo ativo. Diga “meu objetivo é...” para registrar um objetivo aqui ou peça para listar seus objetivos ativos.';

const normalizeOperationalIntent = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\bq\b/g, 'que')
    .replace(/\s+/g, ' ')
    .trim();

export const shouldDeferTrustedReadToOperationalWorkflow = (
  message: string
): boolean => {
  const intent = normalizeOperationalIntent(message);
  const hasProductTarget =
    /\b(produto|produtos|item|itens|servico|servicos|catalogo)\b/.test(intent);
  const hasMutationVerb =
    /\b(cadastrar|cadastre|criar|crie|adicionar|adicione|incluir|inclua|alterar|altere|atualizar|atualize|mudar|mude|trocar|troque|renomear|renomeie|editar|edite|remover|remova|excluir|exclua)\b/.test(intent);
  const hasActionFraming =
    /\b(quero|preciso|gostaria|vamos|podemos|pode|poderia)\b/.test(intent) ||
    /^(cadastre|crie|adicione|inclua|altere|atualize|mude|troque|renomeie|edite|remova|exclua)\b/.test(intent);

  return hasProductTarget && hasMutationVerb && hasActionFraming;
};

export const resolveKyrubiaObjectiveRuntime = (
  storage: Storage,
  uid: string,
  conversationId: string,
  message: string
): KyrubiaObjectiveRuntimeResult | null => {
  // Trusted reads stay ahead of objectives and provider calls, except when the
  // user is explicitly asking to mutate the product catalog. In that case this
  // layer deliberately falls through so the downstream operational workflow can
  // perform its own preflight/review/confirmation. Falling through is not
  // authorization and never executes an action by itself.
  const trustedRead = shouldDeferTrustedReadToOperationalWorkflow(message)
    ? null
    : resolveKyrubiaTrustedReadRuntime(storage, uid, message);
  if (trustedRead) return { reply: trustedRead.reply };

  const command = resolveKyrubiaObjectiveCommand(message);
  if (!command) return null;

  const linkedObjective = loadKyrubiaLinkedObjective(
    storage,
    uid,
    conversationId
  );

  if (command.kind === 'create') {
    const objective = createKyrubiaObjective({
      statement: command.statement,
      conversationId,
      scope: inferKyrubiaObjectiveScope(command.statement),
    });
    upsertKyrubiaObjective(storage, uid, objective);
    linkKyrubiaConversationToObjective(storage, uid, conversationId, objective.id);
    return {
      objective,
      reply:
        `Objetivo ativo registrado: ${formatKyrubiaQuotedSentence(objective.statement)} ` +
        'Vou usar esse objetivo para manter continuidade entre conversas vinculadas. Ele organiza contexto; não autoriza ações nem substitui o estado atual do Kyrub.',
    };
  }

  if (command.kind === 'list_active') {
    return {
      reply: renderKyrubiaObjectiveList(listActiveKyrubiaObjectives(storage, uid)),
    };
  }

  if (command.kind === 'show_linked') {
    if (!linkedObjective) {
      const active = listActiveKyrubiaObjectives(storage, uid);
      if (active.length === 0) return { reply: missingLinkedObjectiveReply() };
      return {
        reply:
          `${missingLinkedObjectiveReply()}\n\n` +
          renderKyrubiaObjectiveList(active),
      };
    }
    return {
      objective: linkedObjective,
      reply: renderKyrubiaObjective(linkedObjective),
    };
  }

  if (!linkedObjective || linkedObjective.status !== 'active') {
    return { reply: missingLinkedObjectiveReply() };
  }

  if (command.kind === 'set_next_step') {
    const objective = setKyrubiaObjectiveNextStep(
      storage,
      uid,
      linkedObjective.id,
      command.nextStep
    );
    if (!objective) return { reply: missingLinkedObjectiveReply() };
    return {
      objective,
      reply:
        `Próximo passo registrado no objetivo ${formatKyrubiaQuotedLabel(objective.title)}: ${formatKyrubiaSentence(objective.nextStep ?? '')} ` +
        'Isso é planejamento de continuidade, não execução automática.',
    };
  }

  if (command.kind === 'add_progress') {
    const objective = addKyrubiaObjectiveProgress(
      storage,
      uid,
      linkedObjective.id,
      command.summary
    );
    if (!objective) return { reply: missingLinkedObjectiveReply() };
    const recordedProgress = objective.progress.at(-1)?.summary ?? command.summary;
    return {
      objective,
      reply:
        `Progresso registrado no objetivo ${formatKyrubiaQuotedLabel(objective.title)}: ${formatKyrubiaSentence(recordedProgress)} ` +
        'Esse registro é histórico; qualquer estado operacional necessário continua sendo revalidado no Kyrub.',
    };
  }

  const objective = completeKyrubiaObjective(
    storage,
    uid,
    linkedObjective.id
  );
  if (!objective) return { reply: missingLinkedObjectiveReply() };
  return {
    objective,
    reply:
      `Objetivo ${formatKyrubiaQuotedLabel(objective.title)} marcado como concluído na memória da Kyrubia. ` +
      'Isso encerra o objetivo de continuidade, mas não funciona como prova de que estados operacionais externos foram concluídos.',
  };
};

export const loadKyrubiaConversationObjective = (
  storage: Storage,
  uid: string,
  conversationId: string
): KyrubiaActiveObjective | undefined =>
  loadKyrubiaLinkedObjective(storage, uid, conversationId);

export const inheritKyrubiaConversationObjective = (
  storage: Storage,
  uid: string,
  sourceConversationId: string,
  targetConversationId: string
): KyrubiaActiveObjective | undefined =>
  inheritKyrubiaObjectiveLink(
    storage,
    uid,
    sourceConversationId,
    targetConversationId
  );

export const describeKyrubiaConversationObjective = (
  objective?: KyrubiaActiveObjective
): string | null => buildKyrubiaObjectiveContext(objective);
