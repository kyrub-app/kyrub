import type {
  KyrubEvidenceEnvelope,
  KyrubEvidenceFreshness,
} from './kyrubEvidence';

export const KYRUB_OBSERVATION_SCHEMA_VERSION = 1 as const;

export type KyrubObservationKnowledgeClass =
  | 'authoritative_fact'
  | 'calculation'
  | 'inference';

export type KyrubObservationScalar = string | number | boolean | null;

export type KyrubObservationClaim = {
  id: string;
  label: string;
  value: KyrubObservationScalar;
  knowledgeClass: KyrubObservationKnowledgeClass;
  evidence: KyrubEvidenceEnvelope[];
  freshness: KyrubEvidenceFreshness;
  explanation: string;
};

export type KyrubObserveExplainResult = {
  schemaVersion: typeof KYRUB_OBSERVATION_SCHEMA_VERSION;
  correlationId: string;
  generatedAt: string;
  claims: KyrubObservationClaim[];
  writeCapability: 'none';
};

const clean = (value: unknown, maximum: number): string =>
  typeof value === 'string' ? value.trim().slice(0, maximum) : '';

const scalar = (value: unknown): value is KyrubObservationScalar =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean';

const rankFreshness = (
  freshness: KyrubEvidenceFreshness
): number => ({ live: 4, recent: 3, historical: 2, unknown: 1 })[freshness];

export const weakestKyrubFreshness = (
  evidence: readonly Pick<KyrubEvidenceEnvelope, 'freshness'>[]
): KyrubEvidenceFreshness => {
  if (evidence.length === 0) return 'unknown';
  return evidence
    .map(item => item.freshness)
    .sort((left, right) => rankFreshness(left) - rankFreshness(right))[0];
};

export const classifyKyrubObservation = (input: {
  calculated?: boolean;
  evidence: readonly Pick<KyrubEvidenceEnvelope, 'authority'>[];
}): KyrubObservationKnowledgeClass => {
  if (input.calculated === true) return 'calculation';
  if (
    input.evidence.length > 0 &&
    input.evidence.every(item => item.authority === 'authoritative')
  ) {
    return 'authoritative_fact';
  }
  return 'inference';
};

export const createKyrubObservationClaim = (input: {
  id: string;
  label: string;
  value: KyrubObservationScalar;
  evidence?: KyrubEvidenceEnvelope[];
  calculated?: boolean;
  explanation?: string;
}): KyrubObservationClaim => {
  const id = clean(input.id, 120);
  const label = clean(input.label, 160);
  if (!id || !label || !scalar(input.value)) {
    throw new Error('Observation claim is missing valid identity or scalar value.');
  }
  const evidence = (input.evidence ?? []).slice(0, 16);
  const knowledgeClass = classifyKyrubObservation({
    calculated: input.calculated,
    evidence,
  });
  const defaultExplanation = knowledgeClass === 'authoritative_fact'
    ? 'Valor lido de uma fonte autoritativa do Kyrub.'
    : knowledgeClass === 'calculation'
      ? 'Valor calculado a partir das evidências informadas.'
      : 'Conclusão inferida; não representa estado autoritativo do negócio.';

  return {
    id,
    label,
    value: input.value,
    knowledgeClass,
    evidence,
    freshness: weakestKyrubFreshness(evidence),
    explanation: clean(input.explanation, 600) || defaultExplanation,
  };
};

export const buildKyrubObserveExplainResult = (input: {
  correlationId: string;
  claims: KyrubObservationClaim[];
  generatedAt?: string;
}): KyrubObserveExplainResult => {
  const correlationId = clean(input.correlationId, 160);
  if (!correlationId) throw new Error('Observe & Explain requires correlationId.');
  const generatedAt = clean(input.generatedAt, 80) || new Date().toISOString();
  if (Number.isNaN(Date.parse(generatedAt))) {
    throw new Error('Observe & Explain generatedAt must be a valid date.');
  }
  return {
    schemaVersion: KYRUB_OBSERVATION_SCHEMA_VERSION,
    correlationId,
    generatedAt: new Date(generatedAt).toISOString(),
    claims: input.claims.slice(0, 50),
    writeCapability: 'none',
  };
};
