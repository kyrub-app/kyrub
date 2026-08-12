export type KyrubSemanticConfidence = 'high' | 'medium' | 'low';

export interface KyrubSemanticCandidate {
  id: string;
  title: string;
}

export interface KyrubSemanticSelection {
  candidateIds: string[];
  confidence: KyrubSemanticConfidence;
}

const cleanText = (value: unknown, maximum: number): string =>
  typeof value === 'string' ? value.trim().slice(0, maximum) : '';

export const normalizeSemanticQuestion = (value: unknown): string =>
  cleanText(value, 500);

export const normalizeSemanticCandidateCatalog = (
  value: unknown
): KyrubSemanticCandidate[] => {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const candidates: KyrubSemanticCandidate[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const source = item as Record<string, unknown>;
    const id = cleanText(source.id, 180);
    const title = cleanText(source.title, 220);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    candidates.push({ id, title });
    if (candidates.length >= 12) break;
  }

  return candidates;
};

export const normalizeSemanticSelection = (
  value: unknown,
  allowedCandidates: KyrubSemanticCandidate[]
): KyrubSemanticSelection => {
  const source = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const allowedIds = new Set(allowedCandidates.map(candidate => candidate.id));
  const candidateIds = Array.isArray(source.candidateIds)
    ? Array.from(
        new Set(
          source.candidateIds
            .map(item => cleanText(item, 180))
            .filter(id => id && allowedIds.has(id))
        )
      ).slice(0, 3)
    : [];
  const requestedConfidence = source.confidence;
  const confidence: KyrubSemanticConfidence =
    requestedConfidence === 'high' ||
    requestedConfidence === 'medium' ||
    requestedConfidence === 'low'
      ? requestedConfidence
      : 'low';

  return {
    candidateIds,
    confidence: candidateIds.length > 0 ? confidence : 'low',
  };
};
