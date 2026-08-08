import {
  buildKyrubiaObjectiveContext,
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

export type KyrubiaObjectiveRuntimeResult = {
  reply: string;
  objective?: KyrubiaActiveObjective;
};

const missingLinkedObjectiveReply = (): string =>
  'Este chat ainda não está vinculado a um objetivo ativo. Diga “meu objetivo é...” para registrar um objetivo aqui ou peça para listar seus objetivos ativos.';

export const resolveKyrubiaObjectiveRuntime = (
  storage: Storage,
  uid: string,
  conversationId: string,
  message: string
): KyrubiaObjectiveRuntimeResult | null => {
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
        `Objetivo ativo registrado: “${objective.statement}”. ` +
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
        `Próximo passo registrado no objetivo “${objective.title}”: ${objective.nextStep}. ` +
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
    return {
      objective,
      reply:
        `Progresso registrado no objetivo “${objective.title}”: ${command.summary}. ` +
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
      `Objetivo “${objective.title}” marcado como concluído na memória da Kyrubia. ` +
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
