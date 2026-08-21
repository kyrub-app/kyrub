export const KYRUB_DOMAIN_EVENT_SCHEMA_VERSION = 1 as const;

export type KyrubDomainEventActorType =
  | 'user'
  | 'kyrubia'
  | 'system'
  | 'integration';

export type KyrubDomainEventOrigin =
  | 'manual'
  | 'kyrubia'
  | 'automation'
  | 'provider_webhook'
  | 'system';

export type KyrubDomainEventScalar = string | number | boolean | null;

export type KyrubDomainEvent = {
  schemaVersion: typeof KYRUB_DOMAIN_EVENT_SCHEMA_VERSION;
  eventId: string;
  correlationId: string;
  causationId: string;
  eventType: string;
  domain: string;
  aggregateType: string;
  aggregateId: string;
  actorType: KyrubDomainEventActorType;
  actorId: string;
  origin: KyrubDomainEventOrigin;
  occurredAt: string;
  attributes: Record<string, KyrubDomainEventScalar>;
};

const clean = (value: unknown, maximum: number): string =>
  typeof value === 'string' ? value.trim().slice(0, maximum) : '';

const scalar = (value: unknown): value is KyrubDomainEventScalar =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean';

export const normalizeKyrubDomainEventAttributes = (
  value: Record<string, unknown> = {}
): Record<string, KyrubDomainEventScalar> => Object.fromEntries(
  Object.entries(value)
    .filter((entry): entry is [string, KyrubDomainEventScalar] =>
      Boolean(clean(entry[0], 80)) && scalar(entry[1])
    )
    .slice(0, 32)
    .map(([key, fieldValue]): [string, KyrubDomainEventScalar] => [
      clean(key, 80),
      fieldValue,
    ])
    .sort(([left], [right]) => left.localeCompare(right))
) as Record<string, KyrubDomainEventScalar>;

export const normalizeKyrubDomainEvent = (
  value: KyrubDomainEvent
): KyrubDomainEvent => {
  const eventId = clean(value.eventId, 160);
  const correlationId = clean(value.correlationId, 160);
  const eventType = clean(value.eventType, 160);
  const domain = clean(value.domain, 80);
  const aggregateType = clean(value.aggregateType, 80);
  const aggregateId = clean(value.aggregateId, 180);
  const actorId = clean(value.actorId, 180);
  if (
    !eventId ||
    !correlationId ||
    !eventType ||
    !domain ||
    !aggregateType ||
    !aggregateId ||
    !actorId
  ) {
    throw new Error('Domain event is missing required identity fields.');
  }
  const occurredAt = clean(value.occurredAt, 80);
  if (!occurredAt || Number.isNaN(Date.parse(occurredAt))) {
    throw new Error('Domain event occurredAt must be a valid date.');
  }

  return {
    schemaVersion: KYRUB_DOMAIN_EVENT_SCHEMA_VERSION,
    eventId,
    correlationId,
    causationId: clean(value.causationId, 160),
    eventType,
    domain,
    aggregateType,
    aggregateId,
    actorType: value.actorType,
    actorId,
    origin: value.origin,
    occurredAt: new Date(occurredAt).toISOString(),
    attributes: normalizeKyrubDomainEventAttributes(value.attributes),
  };
};