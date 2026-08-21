export const KYRUB_EVIDENCE_SCHEMA_VERSION = 1 as const;

export type KyrubEvidenceSourceKind =
  | 'authoritative_state'
  | 'verified_external_event'
  | 'user_intent'
  | 'quoted_content'
  | 'document_content'
  | 'tool_output'
  | 'sensor_inference'
  | 'ai_generated_content';

export type KyrubEvidenceAuthority =
  | 'authoritative'
  | 'evidence'
  | 'inference';

export type KyrubEvidenceFreshness =
  | 'live'
  | 'recent'
  | 'historical'
  | 'unknown';

export type KyrubEvidenceEnvelope = {
  schemaVersion: typeof KYRUB_EVIDENCE_SCHEMA_VERSION;
  sourceKind: KyrubEvidenceSourceKind;
  authority: KyrubEvidenceAuthority;
  sourceRef: string;
  observedAt: string;
  freshness: KyrubEvidenceFreshness;
  confidence?: number;
  correlationId?: string;
};

const SOURCE_AUTHORITY: Record<KyrubEvidenceSourceKind, KyrubEvidenceAuthority> = {
  authoritative_state: 'authoritative',
  verified_external_event: 'authoritative',
  user_intent: 'evidence',
  quoted_content: 'evidence',
  document_content: 'evidence',
  tool_output: 'evidence',
  sensor_inference: 'inference',
  ai_generated_content: 'inference',
};

const clean = (value: unknown, maximum = 300): string =>
  typeof value === 'string' ? value.trim().slice(0, maximum) : '';

const confidence = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1, value));
};

export const classifyKyrubEvidenceAuthority = (
  sourceKind: KyrubEvidenceSourceKind
): KyrubEvidenceAuthority => SOURCE_AUTHORITY[sourceKind];

export const createKyrubEvidenceEnvelope = (input: {
  sourceKind: KyrubEvidenceSourceKind;
  sourceRef?: string;
  observedAt?: string;
  freshness?: KyrubEvidenceFreshness;
  confidence?: number;
  correlationId?: string;
}): KyrubEvidenceEnvelope => {
  const observedAt = clean(input.observedAt) || new Date().toISOString();
  if (Number.isNaN(Date.parse(observedAt))) {
    throw new Error('Evidence observedAt must be a valid ISO date.');
  }

  const sourceRef = clean(input.sourceRef);
  const correlationId = clean(input.correlationId, 160);
  const normalizedConfidence = confidence(input.confidence);

  return {
    schemaVersion: KYRUB_EVIDENCE_SCHEMA_VERSION,
    sourceKind: input.sourceKind,
    authority: classifyKyrubEvidenceAuthority(input.sourceKind),
    sourceRef,
    observedAt: new Date(observedAt).toISOString(),
    freshness: input.freshness ?? 'unknown',
    ...(normalizedConfidence === undefined
      ? {}
      : { confidence: normalizedConfidence }),
    ...(correlationId ? { correlationId } : {}),
  };
};

export const isKyrubAuthoritativeEvidence = (
  evidence: Pick<KyrubEvidenceEnvelope, 'authority'>
): boolean => evidence.authority === 'authoritative';

export const canKyrubEvidenceAuthorizeStateMutation = (
  evidence: Pick<KyrubEvidenceEnvelope, 'authority'>
): boolean => evidence.authority === 'authoritative';

export const requiresKyrubAuthoritativeReconciliation = (
  evidence: Pick<KyrubEvidenceEnvelope, 'authority'>
): boolean => evidence.authority !== 'authoritative';

/**
 * Confidence expresses how strongly a source supports an observation.
 * It never promotes evidence or inference into authoritative state.
 */
export const withKyrubEvidenceConfidence = (
  evidence: KyrubEvidenceEnvelope,
  value: number
): KyrubEvidenceEnvelope => ({
  ...evidence,
  ...(confidence(value) === undefined ? {} : { confidence: confidence(value) }),
  authority: classifyKyrubEvidenceAuthority(evidence.sourceKind),
});
