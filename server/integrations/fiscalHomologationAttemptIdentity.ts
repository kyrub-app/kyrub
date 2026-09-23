import { createHash } from 'node:crypto';

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map(key => [key, canonicalize(record[key])])
  );
};

export const buildFiscalHomologationAttemptIdentity = (
  frozenEvidence: unknown
): { evidenceFingerprint: string; attemptId: string } => {
  const canonical = JSON.stringify(canonicalize(frozenEvidence));
  const evidenceFingerprint = createHash('sha256')
    .update(canonical)
    .digest('hex');
  return {
    evidenceFingerprint,
    attemptId: `fiscal-attempt-${evidenceFingerprint.slice(0, 48)}`,
  };
};
