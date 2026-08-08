export type KyrubiaObjectiveStatus = 'active' | 'completed';

export type KyrubiaObjectiveScope =
  | { kind: 'user' }
  | { kind: 'own_store'; storeId: string | null };

export type KyrubiaObjectiveProgressEntry = {
  id: string;
  summary: string;
  recordedAt: string;
  source: 'user';
};

export type KyrubiaActiveObjective = {
  version: 1;
  id: string;
  title: string;
  statement: string;
  status: KyrubiaObjectiveStatus;
  scope: KyrubiaObjectiveScope;
  createdAt: string;
  updatedAt: string;
  sourceConversationId: string;
  progress: KyrubiaObjectiveProgressEntry[];
  nextStep?: string;
  completedAt?: string;
};

type KyrubiaObjectiveLink = {
  objectiveId: string;
  linkedAt: string;
};

const OBJECTIVES_PREFIX = 'kyrub_ai_objectives_v1';
const OBJECTIVE_LINKS_PREFIX = 'kyrub_ai_objective_links_v1';
const MAX_OBJECTIVES = 30;
const MAX_LINKS = 60;
const MAX_PROGRESS_ENTRIES = 20;
const MAX_TITLE_CHARACTERS = 100;
const MAX_STATEMENT_CHARACTERS = 500;
const MAX_PROGRESS_CHARACTERS = 240;
const MAX_NEXT_STEP_CHARACTERS = 240;

const createId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `kyrub-objective-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const objectivesKey = (uid: string): string =>
  `${OBJECTIVES_PREFIX}:${uid || 'guest'}`;

const linksKey = (uid: string): string =>
  `${OBJECTIVE_LINKS_PREFIX}:${uid || 'guest'}`;

const clean = (value: string, maximum: number): string =>
  value.replace(/\s+/g, ' ').trim().slice(0, maximum);

const isScope = (value: unknown): value is KyrubiaObjectiveScope => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === 'user') return true;
  return (
    candidate.kind === 'own_store' &&
    (candidate.storeId === null || typeof candidate.storeId === 'string')
  );
};

const isProgressEntry = (
  value: unknown
): value is KyrubiaObjectiveProgressEntry => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.summary === 'string' &&
    typeof candidate.recordedAt === 'string' &&
    candidate.source === 'user'
  );
};

const isObjective = (value: unknown): value is KyrubiaActiveObjective => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === 1 &&
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.statement === 'string' &&
    (candidate.status === 'active' || candidate.status === 'completed') &&
    isScope(candidate.scope) &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string' &&
    typeof candidate.sourceConversationId === 'string' &&
    Array.isArray(candidate.progress) &&
    candidate.progress.every(isProgressEntry) &&
    (candidate.nextStep === undefined || typeof candidate.nextStep === 'string') &&
    (candidate.completedAt === undefined || typeof candidate.completedAt === 'string')
  );
};

const isObjectiveLink = (value: unknown): value is KyrubiaObjectiveLink => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.objectiveId === 'string' &&
    candidate.objectiveId.length > 0 &&
    typeof candidate.linkedAt === 'string'
  );
};

const sanitizeObjective = (
  objective: KyrubiaActiveObjective
): KyrubiaActiveObjective => ({
  ...objective,
  title: clean(objective.title, MAX_TITLE_CHARACTERS) || 'Objetivo sem título',
  statement:
    clean(objective.statement, MAX_STATEMENT_CHARACTERS) || 'Objetivo sem descrição',
  progress: objective.progress
    .filter(isProgressEntry)
    .slice(-MAX_PROGRESS_ENTRIES)
    .map(entry => ({
      ...entry,
      summary: clean(entry.summary, MAX_PROGRESS_CHARACTERS),
    }))
    .filter(entry => Boolean(entry.summary)),
  nextStep: objective.nextStep
    ? clean(objective.nextStep, MAX_NEXT_STEP_CHARACTERS) || undefined
    : undefined,
  completedAt: objective.status === 'completed'
    ? objective.completedAt ?? objective.updatedAt
    : undefined,
});

export const loadKyrubiaObjectives = (
  storage: Storage,
  uid: string
): KyrubiaActiveObjective[] => {
  try {
    const parsed = JSON.parse(storage.getItem(objectivesKey(uid)) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isObjective)
      .map(sanitizeObjective)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, MAX_OBJECTIVES);
  } catch {
    return [];
  }
};

export const saveKyrubiaObjectives = (
  storage: Storage,
  uid: string,
  objectives: KyrubiaActiveObjective[]
): void => {
  const sanitized = objectives
    .filter(isObjective)
    .map(sanitizeObjective)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_OBJECTIVES);
  storage.setItem(objectivesKey(uid), JSON.stringify(sanitized));
};

const readLinks = (
  storage: Storage,
  uid: string
): Record<string, KyrubiaObjectiveLink> => {
  try {
    const parsed = JSON.parse(storage.getItem(linksKey(uid)) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter((entry): entry is [string, KyrubiaObjectiveLink] =>
          Boolean(entry[0]) && isObjectiveLink(entry[1])
        )
        .sort((left, right) => right[1].linkedAt.localeCompare(left[1].linkedAt))
        .slice(0, MAX_LINKS)
    );
  } catch {
    return {};
  }
};

const writeLinks = (
  storage: Storage,
  uid: string,
  links: Record<string, KyrubiaObjectiveLink>
): void => {
  const trimmed = Object.fromEntries(
    Object.entries(links)
      .filter((entry): entry is [string, KyrubiaObjectiveLink] =>
        Boolean(entry[0]) && isObjectiveLink(entry[1])
      )
      .sort((left, right) => right[1].linkedAt.localeCompare(left[1].linkedAt))
      .slice(0, MAX_LINKS)
  );
  storage.setItem(linksKey(uid), JSON.stringify(trimmed));
};

export const createKyrubiaObjective = (input: {
  statement: string;
  conversationId: string;
  scope?: KyrubiaObjectiveScope;
}): KyrubiaActiveObjective => {
  const now = new Date().toISOString();
  const statement = clean(input.statement, MAX_STATEMENT_CHARACTERS);
  return {
    version: 1,
    id: createId(),
    title: clean(statement, MAX_TITLE_CHARACTERS) || 'Objetivo sem título',
    statement: statement || 'Objetivo sem descrição',
    status: 'active',
    scope: input.scope ?? { kind: 'user' },
    createdAt: now,
    updatedAt: now,
    sourceConversationId: input.conversationId,
    progress: [],
  };
};

export const upsertKyrubiaObjective = (
  storage: Storage,
  uid: string,
  objective: KyrubiaActiveObjective
): KyrubiaActiveObjective => {
  const sanitized = sanitizeObjective(objective);
  const current = loadKyrubiaObjectives(storage, uid);
  saveKyrubiaObjectives(
    storage,
    uid,
    [sanitized, ...current.filter(item => item.id !== sanitized.id)]
  );
  return sanitized;
};

export const linkKyrubiaConversationToObjective = (
  storage: Storage,
  uid: string,
  conversationId: string,
  objectiveId: string
): void => {
  if (!conversationId || !objectiveId) return;
  const links = readLinks(storage, uid);
  links[conversationId] = {
    objectiveId,
    linkedAt: new Date().toISOString(),
  };
  writeLinks(storage, uid, links);
};

export const loadKyrubiaLinkedObjective = (
  storage: Storage,
  uid: string,
  conversationId: string
): KyrubiaActiveObjective | undefined => {
  if (!conversationId) return undefined;
  const links = readLinks(storage, uid);
  const link = links[conversationId];
  if (!link) return undefined;

  const objective = loadKyrubiaObjectives(storage, uid)
    .find(item => item.id === link.objectiveId);
  if (objective) return objective;

  delete links[conversationId];
  writeLinks(storage, uid, links);
  return undefined;
};

export const inheritKyrubiaObjectiveLink = (
  storage: Storage,
  uid: string,
  sourceConversationId: string,
  targetConversationId: string
): KyrubiaActiveObjective | undefined => {
  const objective = loadKyrubiaLinkedObjective(
    storage,
    uid,
    sourceConversationId
  );
  if (!objective || objective.status !== 'active') return undefined;
  linkKyrubiaConversationToObjective(
    storage,
    uid,
    targetConversationId,
    objective.id
  );
  return objective;
};

export const listActiveKyrubiaObjectives = (
  storage: Storage,
  uid: string
): KyrubiaActiveObjective[] =>
  loadKyrubiaObjectives(storage, uid).filter(item => item.status === 'active');

export const addKyrubiaObjectiveProgress = (
  storage: Storage,
  uid: string,
  objectiveId: string,
  summary: string
): KyrubiaActiveObjective | undefined => {
  const current = loadKyrubiaObjectives(storage, uid)
    .find(item => item.id === objectiveId);
  if (!current || current.status !== 'active') return undefined;
  const now = new Date().toISOString();
  return upsertKyrubiaObjective(storage, uid, {
    ...current,
    updatedAt: now,
    progress: [
      ...current.progress,
      {
        id: createId(),
        summary: clean(summary, MAX_PROGRESS_CHARACTERS),
        recordedAt: now,
        source: 'user' as const,
      },
    ].filter(entry => Boolean(entry.summary)),
  });
};

export const setKyrubiaObjectiveNextStep = (
  storage: Storage,
  uid: string,
  objectiveId: string,
  nextStep: string
): KyrubiaActiveObjective | undefined => {
  const current = loadKyrubiaObjectives(storage, uid)
    .find(item => item.id === objectiveId);
  if (!current || current.status !== 'active') return undefined;
  return upsertKyrubiaObjective(storage, uid, {
    ...current,
    updatedAt: new Date().toISOString(),
    nextStep: clean(nextStep, MAX_NEXT_STEP_CHARACTERS),
  });
};

export const completeKyrubiaObjective = (
  storage: Storage,
  uid: string,
  objectiveId: string
): KyrubiaActiveObjective | undefined => {
  const current = loadKyrubiaObjectives(storage, uid)
    .find(item => item.id === objectiveId);
  if (!current || current.status !== 'active') return undefined;
  const now = new Date().toISOString();
  return upsertKyrubiaObjective(storage, uid, {
    ...current,
    status: 'completed',
    updatedAt: now,
    completedAt: now,
  });
};
