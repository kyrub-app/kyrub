import type { KyrubReadActionType } from './kyrubActions';

export type KyrubiaEntityType = 'product' | 'order' | 'store';

export type KyrubiaEntityReference = {
  entityType: KyrubiaEntityType;
  entityId: string;
  label: string;
  position: number;
};

export type KyrubiaOperationalScope = {
  kind: 'own_store';
  storeId: string | null;
};

export type KyrubiaTurnContext = {
  version: 1;
  id: string;
  source: 'kyrub_runtime';
  sourceAction: KyrubReadActionType;
  generatedAt: string;
  scope: KyrubiaOperationalScope;
  entities: KyrubiaEntityReference[];
};

export type KyrubiaTurnSelection = {
  sourceTurnId: string;
  entityType: KyrubiaEntityType;
  entityIds: string[];
  labels: string[];
  resolution: 'all' | 'first_n' | 'position';
};

export type KyrubiaContextualRecallResult = {
  reply: string;
  selection: KyrubiaTurnSelection;
  turnContext: KyrubiaTurnContext;
};

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

const createTurnId = (): string => {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `kyrub-turn-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

const numberWords: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
};

const ordinalWords: Record<string, number> = {
  primeiro: 1,
  primeira: 1,
  segundo: 2,
  segunda: 2,
  terceiro: 3,
  terceira: 3,
  quarto: 4,
  quarta: 4,
  quinto: 5,
  quinta: 5,
};

const readNumber = (value: string): number | null => {
  const numeric = Number.parseInt(value, 10);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  return numberWords[value] ?? null;
};

const selectionFrom = (
  context: KyrubiaTurnContext,
  entities: KyrubiaEntityReference[],
  resolution: KyrubiaTurnSelection['resolution']
): KyrubiaTurnSelection | null => {
  if (entities.length === 0) return null;
  const entityType = entities[0].entityType;
  if (entities.some(entity => entity.entityType !== entityType)) return null;
  return {
    sourceTurnId: context.id,
    entityType,
    entityIds: entities.map(entity => entity.entityId),
    labels: entities.map(entity => entity.label),
    resolution,
  };
};

const refersToPreviousResult = (message: string): boolean => {
  const intent = normalize(message);
  return /\b(dessa|deste|desses|destes|daquela|daquele|da lista|dessa lista|desses itens|desses produtos|mostrou|acabou de mostrar|acima)\b/.test(intent);
};

export const resolveKyrubiaTurnSelection = (
  message: string,
  context?: KyrubiaTurnContext
): KyrubiaTurnSelection | null => {
  if (!context || context.entities.length === 0) return null;
  const intent = normalize(message);
  if (!refersToPreviousResult(message)) return null;

  const ordered = context.entities
    .slice()
    .sort((left, right) => left.position - right.position);

  const firstNMatch = /\b(?:os |as )?(\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez) primeiros?\b/.exec(intent);
  if (firstNMatch) {
    const count = readNumber(firstNMatch[1]);
    if (count) return selectionFrom(context, ordered.slice(0, count), 'first_n');
  }

  for (const [word, position] of Object.entries(ordinalWords)) {
    if (new RegExp(`\\b${word}\\b`).test(intent)) {
      const entity = ordered.find(item => item.position === position);
      return entity ? selectionFrom(context, [entity], 'position') : null;
    }
  }

  if (/\b(todos|todas|essa lista|dessa lista|esses itens|esses produtos)\b/.test(intent)) {
    return selectionFrom(context, ordered, 'all');
  }

  return null;
};

const MUTATION_OR_COMMAND_PATTERN =
  /\b(aplique|aplicar|altere|alterar|atualize|atualizar|mude|mudar|desconto|descontar|preco|precos|estoque|exclua|excluir|delete|deletar|remova|remover|crie|criar|salve|salvar|adicione|adicionar|registre|registrar|compre|comprar|venda|vender|envie|enviar|publique|publicar)\b/;

const isReadbackRequest = (message: string): boolean => {
  const intent = normalize(message);
  if (MUTATION_OR_COMMAND_PATTERN.test(intent)) return false;
  return /\b(quais|qual|liste|listar|mostre|mostrar|diga|dizer|identifique|identificar)\b/.test(intent) ||
    /\b(?:qual|quais)\b.*\b(?:e|sao)\b/.test(intent);
};

export const resolveKyrubiaMissingContextReply = (
  message: string,
  context?: KyrubiaTurnContext
): string | null => {
  if (context?.entities.length) return null;
  if (!isReadbackRequest(message) || !refersToPreviousResult(message)) {
    return null;
  }

  return 'Não tenho uma lista anterior nesta conversa para usar como referência. Peça para eu listar os itens primeiro.';
};

const narrowedTurnContext = (
  source: KyrubiaTurnContext,
  selection: KyrubiaTurnSelection
): KyrubiaTurnContext => {
  const selectedIds = new Set(selection.entityIds);
  const selectedById = new Map(
    source.entities
      .filter(entity => selectedIds.has(entity.entityId))
      .map(entity => [entity.entityId, entity] as const)
  );
  const entities = selection.entityIds.flatMap((entityId, index) => {
    const entity = selectedById.get(entityId);
    return entity
      ? [{ ...entity, position: index + 1 }]
      : [];
  });

  return {
    ...source,
    id: createTurnId(),
    generatedAt: new Date().toISOString(),
    entities,
  };
};

export const resolveKyrubiaContextualRecall = (
  message: string,
  context?: KyrubiaTurnContext
): KyrubiaContextualRecallResult | null => {
  if (!isReadbackRequest(message)) return null;
  const selection = resolveKyrubiaTurnSelection(message, context);
  if (!selection || !context) return null;

  const lines = selection.labels.map(label => `- ${label}`).join('\n');
  const reply = selection.labels.length === 1
    ? `O item selecionado daquela lista é:\n${lines}`
    : `Os itens selecionados daquela lista são:\n${lines}`;

  return {
    reply,
    selection,
    turnContext: narrowedTurnContext(context, selection),
  };
};

export const describeKyrubiaTurnSelection = (
  selection: KyrubiaTurnSelection
): string => {
  const entities = selection.entityIds
    .map((entityId, index) => `${selection.entityType}:${entityId} (${selection.labels[index] ?? ''})`)
    .join('; ');
  return `Referência operacional resolvida pelo Kyrub: ${entities}. Esta referência identifica entidades, mas não prova estado atual nem autoriza mutações; dados e permissões devem ser revalidados antes de qualquer ação.`;
};