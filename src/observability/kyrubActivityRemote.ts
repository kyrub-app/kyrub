import type { KyrubActivityEvent } from '../../shared/kyrubActivityEvents';
import { auth } from '../utils/firebase';

const REMOTE_ACTIVITY_ENDPOINT = '/api/health?transport=activity-events';
const MAX_BATCH_SIZE = 20;
const MAX_QUEUE_SIZE = 80;
const FLUSH_DELAY_MS = 1200;
const RETRY_DELAY_MS = 5000;

let queue: KyrubActivityEvent[] = [];
let flushTimer = 0;
let flushing = false;

const remoteEvent = (event: KyrubActivityEvent) => ({
  id: event.id,
  type: event.type,
  domain: event.domain,
  source: event.source,
  authority: event.authority,
  occurredAt: event.occurredAt,
  ...(event.screenId ? { screenId: event.screenId } : {}),
  ...(event.actionId ? { actionId: event.actionId } : {}),
  ...(event.entityType ? { entityType: event.entityType } : {}),
  ...(event.entityId ? { entityId: event.entityId } : {}),
});

const scheduleFlush = (delay = FLUSH_DELAY_MS): void => {
  if (typeof window === 'undefined' || flushTimer) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = 0;
    void flushKyrubActivityEvents();
  }, delay);
};

export const enqueueKyrubActivityEvent = (event: KyrubActivityEvent): void => {
  if (typeof window === 'undefined') return;
  if (queue.some(candidate => candidate.id === event.id)) return;
  queue = [...queue, event].slice(-MAX_QUEUE_SIZE);
  scheduleFlush(queue.length >= MAX_BATCH_SIZE ? 0 : FLUSH_DELAY_MS);
};

export const flushKyrubActivityEvents = async (): Promise<void> => {
  if (flushing || queue.length === 0) return;
  const user = auth.currentUser;
  if (!user) {
    scheduleFlush(RETRY_DELAY_MS);
    return;
  }

  flushing = true;
  const batch = queue.slice(0, MAX_BATCH_SIZE);
  try {
    const token = await user.getIdToken();
    const response = await fetch(REMOTE_ACTIVITY_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ events: batch.map(remoteEvent) }),
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(`activity transport HTTP ${response.status}`);
    const sentIds = new Set(batch.map(event => event.id));
    queue = queue.filter(event => !sentIds.has(event.id));
  } catch (error) {
    console.warn('[ActivityRemote] envio adiado.', error);
  } finally {
    flushing = false;
    if (queue.length > 0) scheduleFlush(queue.length >= MAX_BATCH_SIZE ? 0 : RETRY_DELAY_MS);
  }
};
