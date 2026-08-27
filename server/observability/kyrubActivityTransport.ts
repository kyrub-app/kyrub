import type {
  KyrubActivityEventAuthority,
  KyrubActivityEventDomain,
  KyrubActivityEventSource,
  KyrubActivityEventType,
} from '../../shared/kyrubActivityEvents.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';

const ALLOWED_TYPES = new Set<KyrubActivityEventType>([
  'navigation.screen_viewed',
  'navigation.community_opened',
  'interaction.action_attempted',
  'result.action_succeeded',
  'result.action_failed',
]);
const ALLOWED_DOMAINS = new Set<KyrubActivityEventDomain>([
  'app',
  'community',
  'store',
  'catalog',
  'order',
  'reservation',
  'kyrubia',
]);
const ALLOWED_SOURCES = new Set<KyrubActivityEventSource>([
  'client_observation',
  'authoritative_write_ack',
  'server_confirmed',
]);
const ALLOWED_AUTHORITIES = new Set<KyrubActivityEventAuthority>([
  'context_only',
  'confirmed_result',
]);
const SAFE_IDENTIFIER = /^[a-zA-Z0-9:_-]{1,160}$/;
const MAX_EVENTS = 20;

const cleanIdentifier = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.trim();
  return SAFE_IDENTIFIER.test(cleaned) ? cleaned : undefined;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

export const receiveAuthorizedKyrubActivityEvents = async (
  authorization: string,
  body: unknown
): Promise<{ accepted: number }> => {
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!match?.[1]) throw new Error('AUTH_REQUIRED');
  const identity = await verifyFirebaseIdToken(match[1].trim());
  const payload = asRecord(body);
  const candidates = Array.isArray(payload?.events)
    ? payload.events.slice(0, MAX_EVENTS)
    : [];

  let accepted = 0;
  for (const candidate of candidates) {
    const event = asRecord(candidate);
    if (!event) continue;
    const type = event.type as KyrubActivityEventType;
    const domain = event.domain as KyrubActivityEventDomain;
    const source = event.source as KyrubActivityEventSource;
    const authority = event.authority as KyrubActivityEventAuthority;
    if (
      !ALLOWED_TYPES.has(type) ||
      !ALLOWED_DOMAINS.has(domain) ||
      !ALLOWED_SOURCES.has(source) ||
      !ALLOWED_AUTHORITIES.has(authority)
    ) continue;

    const id = cleanIdentifier(event.id);
    const occurredAt = typeof event.occurredAt === 'string' && Number.isFinite(Date.parse(event.occurredAt))
      ? new Date(event.occurredAt).toISOString()
      : new Date().toISOString();
    if (!id) continue;

    const safeEvent = {
      schemaVersion: 1,
      id,
      actorUid: identity.uid,
      type,
      domain,
      source,
      authority,
      occurredAt,
      screenId: cleanIdentifier(event.screenId),
      actionId: cleanIdentifier(event.actionId),
      entityType: cleanIdentifier(event.entityType),
      entityId: cleanIdentifier(event.entityId),
    };

    console.info('[activity]', JSON.stringify(safeEvent));
    accepted += 1;
  }

  return { accepted };
};
