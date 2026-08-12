import type {
  KyrubKnowledgeItem,
  KyrubKnowledgeSnapshot,
} from '../../shared/kyrubKnowledge';

const MAX_ITEMS = 20;
const MAX_AGE_MS = 5 * 60_000;

let runtimeSnapshot: {
  cachedAt: number;
  items: KyrubKnowledgeItem[];
} | null = null;

const isTrustedItem = (value: unknown): value is KyrubKnowledgeItem => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<KyrubKnowledgeItem>;
  return Boolean(
    item.schemaVersion === 1 &&
      item.authority === 'official_product_reference' &&
      item.sourceKind === 'official_community' &&
      item.sourceEntityType === 'community_debate' &&
      item.status === 'active' &&
      typeof item.id === 'string' &&
      Boolean(item.id.trim()) &&
      typeof item.sourceEntityId === 'string' &&
      Boolean(item.sourceEntityId.trim()) &&
      typeof item.communityId === 'string' &&
      Boolean(item.communityId.trim()) &&
      typeof item.title === 'string' &&
      Boolean(item.title.trim()) &&
      typeof item.content === 'string' &&
      Boolean(item.content.trim()) &&
      typeof item.version === 'string' &&
      Boolean(item.version.trim()) &&
      typeof item.updatedAt === 'string' &&
      Array.isArray(item.tags)
  );
};

export const setOfficialKnowledgeRuntimeSnapshot = (
  snapshot: KyrubKnowledgeSnapshot,
  now = new Date()
): void => {
  runtimeSnapshot = {
    cachedAt: now.getTime(),
    items: snapshot.items.filter(isTrustedItem).slice(0, MAX_ITEMS),
  };
};

export const getOfficialKnowledgeRuntimeSnapshot = (
  now = new Date()
): KyrubKnowledgeItem[] => {
  if (!runtimeSnapshot) return [];
  if (now.getTime() - runtimeSnapshot.cachedAt > MAX_AGE_MS) {
    runtimeSnapshot = null;
    return [];
  }
  return runtimeSnapshot.items.map(item => ({
    ...item,
    tags: [...item.tags],
  }));
};

export const clearOfficialKnowledgeRuntimeSnapshot = (): void => {
  runtimeSnapshot = null;
};
