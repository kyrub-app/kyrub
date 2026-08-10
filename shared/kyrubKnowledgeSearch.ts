import type { KyrubKnowledgeItem } from './kyrubKnowledge';

const normalizeKnowledgeText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const queryTokens = (value: string): string[] =>
  Array.from(
    new Set(
      normalizeKnowledgeText(value)
        .split(' ')
        .filter(token => token.length >= 3)
    )
  ).slice(0, 16);

export interface KyrubKnowledgeSearchResult {
  item: KyrubKnowledgeItem;
  score: number;
}

export const searchKyrubKnowledge = (
  items: KyrubKnowledgeItem[],
  query: string,
  limit = 5
): KyrubKnowledgeSearchResult[] => {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];

  return items
    .map(item => {
      const normalizedTitle = normalizeKnowledgeText(item.title);
      const normalizedContent = normalizeKnowledgeText(item.content);
      let score = 0;
      for (const token of tokens) {
        if (normalizedTitle.includes(token)) score += 4;
        if (normalizedContent.includes(token)) score += 1;
      }
      return { item, score };
    })
    .filter(result => result.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return Date.parse(right.item.updatedAt) - Date.parse(left.item.updatedAt);
    })
    .slice(0, Math.max(1, Math.min(10, Math.floor(limit))));
};
