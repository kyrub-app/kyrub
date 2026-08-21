export const KYRUB_CORRELATION_SCHEMA_VERSION = 1 as const;

export type KyrubCorrelationStage =
  | 'observation'
  | 'preview'
  | 'authorization'
  | 'execution'
  | 'receipt'
  | 'domain_event';

export type KyrubCorrelationLink = {
  schemaVersion: typeof KYRUB_CORRELATION_SCHEMA_VERSION;
  correlationId: string;
  stage: KyrubCorrelationStage;
  referenceId: string;
  actorUid: string;
  actionType: string;
  occurredAt: string;
};

const clean = (value: unknown, maximum: number): string =>
  typeof value === 'string' ? value.trim().slice(0, maximum) : '';

export const createKyrubCorrelationLink = (input: {
  correlationId: string;
  stage: KyrubCorrelationStage;
  referenceId: string;
  actorUid: string;
  actionType?: string;
  occurredAt?: string;
}): KyrubCorrelationLink => {
  const correlationId = clean(input.correlationId, 160);
  const referenceId = clean(input.referenceId, 180);
  const actorUid = clean(input.actorUid, 180);
  const actionType = clean(input.actionType, 100);
  const occurredAt = clean(input.occurredAt, 80) || new Date().toISOString();
  if (!correlationId || !referenceId || !actorUid || Number.isNaN(Date.parse(occurredAt))) {
    throw new Error('Correlation link is missing required identity fields.');
  }
  return {
    schemaVersion: KYRUB_CORRELATION_SCHEMA_VERSION,
    correlationId,
    stage: input.stage,
    referenceId,
    actorUid,
    actionType,
    occurredAt: new Date(occurredAt).toISOString(),
  };
};

export const assertKyrubCorrelationChain = (
  links: readonly KyrubCorrelationLink[]
): void => {
  if (links.length === 0) throw new Error('CORRELATION_CHAIN_EMPTY');
  const [{ correlationId, actorUid }] = links;
  for (const link of links) {
    if (link.correlationId !== correlationId) {
      throw new Error('CORRELATION_ID_MISMATCH');
    }
    if (link.actorUid !== actorUid) {
      throw new Error('CORRELATION_ACTOR_MISMATCH');
    }
  }
};
