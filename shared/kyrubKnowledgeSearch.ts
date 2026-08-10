import type { KyrubKnowledgeItem } from './kyrubKnowledge';

const STOP_WORDS = new Set([
  'a', 'ao', 'aos', 'as', 'com', 'como', 'da', 'das', 'de', 'do', 'dos', 'e', 'ela', 'ele',
  'em', 'essa', 'esse', 'esta', 'eu', 'foi', 'meu', 'meus', 'minha', 'minhas', 'na', 'nas',
  'no', 'nos', 'o', 'os', 'ou', 'para', 'por', 'posso', 'pra', 'pras', 'pro', 'que', 'qual',
  'quais', 'quero', 'se', 'sem', 'ser', 'sua', 'suas', 'seu', 'seus', 'tem', 'ter', 'um',
  'uma', 'voce', 'vc',
]);

const normalizeKnowledgeText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const searchableTokens = (value: string, limit = 64): string[] =>
  Array.from(
    new Set(
      normalizeKnowledgeText(value)
        .split(' ')
        .filter(Boolean)
        .filter(token => /^\d+$/.test(token) || token.length >= 3)
        .filter(token => !STOP_WORDS.has(token))
    )
  ).slice(0, limit);

const lexicalRoot = (token: string): string => {
  if (/^\d+$/.test(token) || token.length < 6) return token;
  return token.slice(0, 5);
};

const tokenMatchQuality = (queryToken: string, candidateToken: string): number => {
  if (queryToken === candidateToken) return 1;
  if (/^\d+$/.test(queryToken) || /^\d+$/.test(candidateToken)) return 0;
  if (queryToken.length < 6 || candidateToken.length < 6) return 0;
  return lexicalRoot(queryToken) === lexicalRoot(candidateToken) ? 0.65 : 0;
};

const bestTokenMatch = (queryToken: string, candidates: string[]): number =>
  candidates.reduce(
    (best, candidate) => Math.max(best, tokenMatchQuality(queryToken, candidate)),
    0
  );

export type KyrubKnowledgeSearchConfidence = 'high' | 'medium' | 'low';

export interface KyrubKnowledgeSearchResult {
  item: KyrubKnowledgeItem;
  score: number;
  confidence: KyrubKnowledgeSearchConfidence;
  coverage: number;
  matchedTokens: string[];
  titleMatchedTokens: string[];
}

interface IndexedKnowledgeItem {
  item: KyrubKnowledgeItem;
  titleTokens: string[];
  contentTokens: string[];
  tagTokens: string[];
}

const confidenceFor = (
  score: number,
  coverage: number,
  titleMatchedCount: number
): KyrubKnowledgeSearchConfidence => {
  if (coverage >= 0.75 && score >= 8) return 'high';
  if (coverage >= 0.5 && (score >= 4 || titleMatchedCount > 0)) return 'medium';
  return 'low';
};

export const searchKyrubKnowledge = (
  items: KyrubKnowledgeItem[],
  query: string,
  limit = 5
): KyrubKnowledgeSearchResult[] => {
  const queryTokens = searchableTokens(query, 16);
  if (queryTokens.length === 0 || items.length === 0) return [];

  const indexed: IndexedKnowledgeItem[] = items.map(item => ({
    item,
    titleTokens: searchableTokens(item.title),
    contentTokens: searchableTokens(item.content),
    tagTokens: searchableTokens(item.tags.join(' ')),
  }));

  const documentFrequency = new Map<string, number>();
  for (const queryToken of queryTokens) {
    const count = indexed.filter(index => {
      const allTokens = [
        ...index.titleTokens,
        ...index.contentTokens,
        ...index.tagTokens,
      ];
      return bestTokenMatch(queryToken, allTokens) > 0;
    }).length;
    documentFrequency.set(queryToken, count);
  }

  return indexed
    .map(index => {
      let score = 0;
      const matchedTokens: string[] = [];
      const titleMatchedTokens: string[] = [];

      for (const queryToken of queryTokens) {
        const titleQuality = bestTokenMatch(queryToken, index.titleTokens);
        const contentQuality = bestTokenMatch(queryToken, index.contentTokens);
        const tagQuality = bestTokenMatch(queryToken, index.tagTokens);
        const bestQuality = Math.max(titleQuality, contentQuality, tagQuality);
        if (bestQuality <= 0) continue;

        matchedTokens.push(queryToken);
        if (titleQuality > 0) titleMatchedTokens.push(queryToken);

        const frequency = documentFrequency.get(queryToken) ?? 0;
        const inverseFrequency = 1 + Math.log((items.length + 1) / (frequency + 1));
        score += inverseFrequency * (
          titleQuality * 8 +
          contentQuality * 2 +
          tagQuality * 5
        );
      }

      const coverage = matchedTokens.length / queryTokens.length;
      if (coverage === 1 && titleMatchedTokens.length === queryTokens.length) {
        score += 10;
      }

      const roundedScore = Math.round(score * 100) / 100;
      return {
        item: index.item,
        score: roundedScore,
        confidence: confidenceFor(roundedScore, coverage, titleMatchedTokens.length),
        coverage: Math.round(coverage * 100) / 100,
        matchedTokens,
        titleMatchedTokens,
      };
    })
    .filter(result => result.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.coverage !== left.coverage) return right.coverage - left.coverage;
      return Date.parse(right.item.updatedAt) - Date.parse(left.item.updatedAt);
    })
    .slice(0, Math.max(1, Math.min(10, Math.floor(limit))));
};
