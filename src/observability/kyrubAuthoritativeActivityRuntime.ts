import type { KyrubActivityEvent } from '../../shared/kyrubActivityEvents';

const MAX_RUNTIME_EVENTS = 24;
let authoritativeRuntimeEvents: KyrubActivityEvent[] = [];

export const rememberAuthoritativeActivityRuntimeEvent = (
  event: KyrubActivityEvent
): void => {
  if (event.authority !== 'confirmed_result') return;
  if (
    event.source !== 'authoritative_write_ack' &&
    event.source !== 'server_confirmed'
  ) {
    return;
  }
  authoritativeRuntimeEvents = [
    ...authoritativeRuntimeEvents,
    event,
  ].slice(-MAX_RUNTIME_EVENTS);
};

export const readAuthoritativeActivityRuntimeEvents = (
  actorUid: string,
  limit = 12
): KyrubActivityEvent[] => {
  const normalizedUid = actorUid.trim();
  if (!normalizedUid) return [];
  const safeLimit = Math.max(1, Math.min(MAX_RUNTIME_EVENTS, Math.floor(limit)));
  return authoritativeRuntimeEvents
    .filter(event => event.actorUid === normalizedUid)
    .slice(-safeLimit);
};

export const clearAuthoritativeActivityRuntimeEvents = (
  actorUid?: string
): void => {
  const normalizedUid = actorUid?.trim() ?? '';
  authoritativeRuntimeEvents = normalizedUid
    ? authoritativeRuntimeEvents.filter(event => event.actorUid !== normalizedUid)
    : [];
};
