export type KyrubKnowledgeAuthority = 'official_product_reference';

export type KyrubKnowledgeSourceKind = 'official_community';

export type KyrubKnowledgeSourceEntityType = 'community_debate';

export interface KyrubKnowledgeItem {
  schemaVersion: 1;
  id: string;
  authority: KyrubKnowledgeAuthority;
  sourceKind: KyrubKnowledgeSourceKind;
  sourceEntityType: KyrubKnowledgeSourceEntityType;
  sourceEntityId: string;
  communityId: string;
  title: string;
  content: string;
  status: 'active';
  version: string;
  updatedAt: string;
  tags: string[];
}

export interface KyrubKnowledgeSnapshot {
  source: 'official_communities';
  generatedAt: string;
  items: KyrubKnowledgeItem[];
  warnings: string[];
}

export const isKyrubKnowledgeItem = (
  value: unknown
): value is KyrubKnowledgeItem => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<KyrubKnowledgeItem>;
  return (
    candidate.schemaVersion === 1 &&
    candidate.authority === 'official_product_reference' &&
    candidate.sourceKind === 'official_community' &&
    candidate.sourceEntityType === 'community_debate' &&
    candidate.status === 'active' &&
    typeof candidate.id === 'string' &&
    Boolean(candidate.id.trim()) &&
    typeof candidate.communityId === 'string' &&
    Boolean(candidate.communityId.trim()) &&
    typeof candidate.sourceEntityId === 'string' &&
    Boolean(candidate.sourceEntityId.trim()) &&
    typeof candidate.title === 'string' &&
    Boolean(candidate.title.trim()) &&
    typeof candidate.content === 'string' &&
    Boolean(candidate.content.trim()) &&
    typeof candidate.version === 'string' &&
    Boolean(candidate.version.trim()) &&
    typeof candidate.updatedAt === 'string' &&
    Array.isArray(candidate.tags)
  );
};
