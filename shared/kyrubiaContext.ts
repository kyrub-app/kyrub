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

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();

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

export const resolveKyrubiaTurnSelection = (
  message: string,
  context?: KyrubiaTurnContext
): KyrubiaTurnSelection | null => {
  if (!context || context.entities.length === 0) return null;
  const intent = normalize(message);
  const refersToPreviousResult =
    /\b(dessa|deste|desses|destes|daquela|daquele|da lista|dessa lista|desses itens|desses produtos|mostrou|acabou de mostrar|acima)\b/.test(intent);
  if (!refersToPreviousResult) return null;

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

export const describeKyrubiaTurnSelection = (
  selection: KyrubiaTurnSelection
): string => {
  const entities = selection.entityIds
    .map((entityId, index) => `${selection.entityType}:${entityId} (${selection.labels[index] ?? ''})`)
    .join('; ');
  return `Referência operacional resolvida pelo Kyrub: ${entities}. Esta referência identifica entidades, mas não prova estado atual nem autoriza mutações; dados e permissões devem ser revalidados antes de qualquer ação.`;
};
