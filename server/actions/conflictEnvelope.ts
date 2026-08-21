export type KyrubConflictReason =
  | 'STATE_CHANGED'
  | 'ENTITY_MISSING'
  | 'OWNERSHIP_CHANGED'
  | 'VERSION_MISMATCH';

export type KyrubConflictScalar = string | number | boolean | null;
export type KyrubConflictSnapshot = Record<string, KyrubConflictScalar>;

export type KyrubConflictTarget = {
  entityType: string;
  entityId: string;
};

export type KyrubConflictEnvelope = {
  version: 1;
  code: 'STALE_PROPOSAL';
  reason: KyrubConflictReason;
  target: KyrubConflictTarget;
  expected: KyrubConflictSnapshot;
  observed: KyrubConflictSnapshot;
  changedFields: string[];
  detectedAt: string;
  retryable: true;
  requiresFreshRead: true;
};

export class KyrubConflictEnvelopeError extends Error {
  readonly status = 409;
  readonly code = 'STALE_PROPOSAL' as const;

  constructor(readonly conflict: KyrubConflictEnvelope) {
    super('O estado mudou desde a leitura usada pela proposta. Atualize os dados antes de confirmar novamente.');
    this.name = 'KyrubConflictEnvelopeError';
  }
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const isScalar = (value: unknown): value is KyrubConflictScalar =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean';

const normalizeExpected = (
  value: Record<string, unknown>
): KyrubConflictSnapshot => Object.fromEntries(
  Object.entries(value)
    .filter(([, fieldValue]) => isScalar(fieldValue))
    .sort(([left], [right]) => left.localeCompare(right))
) as KyrubConflictSnapshot;

const projectObserved = (
  expected: KyrubConflictSnapshot,
  observed: Record<string, unknown> | null
): KyrubConflictSnapshot => Object.fromEntries(
  Object.keys(expected).map(key => [
    key,
    observed && isScalar(observed[key]) ? observed[key] : null,
  ])
) as KyrubConflictSnapshot;

export const buildKyrubConflictEnvelope = (input: {
  target: KyrubConflictTarget;
  reason?: KyrubConflictReason;
  expected: Record<string, unknown>;
  observed: Record<string, unknown> | null;
  detectedAt?: Date;
}): KyrubConflictEnvelope | null => {
  const entityType = clean(input.target.entityType);
  const entityId = clean(input.target.entityId);
  if (!entityType || !entityId) {
    throw new Error('Conflict target requires entityType and entityId.');
  }

  const expected = normalizeExpected(input.expected);
  if (Object.keys(expected).length === 0) {
    throw new Error('Conflict detection requires at least one expected scalar field.');
  }
  const observed = projectObserved(expected, input.observed);
  const changedFields = Object.keys(expected).filter(
    key => !Object.is(expected[key], observed[key])
  );
  if (changedFields.length === 0) return null;

  return {
    version: 1,
    code: 'STALE_PROPOSAL',
    reason: input.reason ?? (input.observed ? 'STATE_CHANGED' : 'ENTITY_MISSING'),
    target: { entityType, entityId },
    expected,
    observed,
    changedFields,
    detectedAt: (input.detectedAt ?? new Date()).toISOString(),
    retryable: true,
    requiresFreshRead: true,
  };
};

export const assertKyrubExpectedState = (input: {
  target: KyrubConflictTarget;
  reason?: KyrubConflictReason;
  expected: Record<string, unknown>;
  observed: Record<string, unknown> | null;
  detectedAt?: Date;
}): void => {
  const conflict = buildKyrubConflictEnvelope(input);
  if (conflict) throw new KyrubConflictEnvelopeError(conflict);
};
