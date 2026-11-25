import type { KyrubActivityEvent } from '../../shared/kyrubActivityEvents';
import type { User } from 'firebase/auth';
import { auth } from '../utils/firebase';
import { createActivitySessionQueue } from './activitySessionQueue';
import { createMonthlyPresenceSession } from './monthlyPresenceSession';

const REMOTE_ACTIVITY_ENDPOINT = '/api/health?transport=activity-events';
const MAX_BATCH_SIZE = 20;
const MAX_QUEUE_SIZE = 80;
const FLUSH_DELAY_MS = 1200;
const RETRY_DELAY_MS = 5000;

const queue = createActivitySessionQueue<User, KyrubActivityEvent>(MAX_QUEUE_SIZE);
const monthlyPresence = createMonthlyPresenceSession<User>();
const MONTHLY_PRESENCE_EMULATOR = import.meta.env.VITE_KYRUB_FINOPS_MAU_EMULATOR === 'true';
let flushTimer = 0;

export const synchronizeActivityRemoteSession = (): void => {
  monthlyPresence.synchronize(auth.currentUser);
  if (queue.synchronize(auth.currentUser) && flushTimer) {
    window.clearTimeout(flushTimer);
    flushTimer = 0;
  }
};

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
  synchronizeActivityRemoteSession();
  if (!queue.enqueue(auth.currentUser, event)) return;
  scheduleFlush(queue.size() >= MAX_BATCH_SIZE ? 0 : FLUSH_DELAY_MS);
};

export const flushKyrubActivityEvents = async (): Promise<void> => {
  if (typeof window === 'undefined') return;
  synchronizeActivityRemoteSession();
  const user = auth.currentUser;
  const batch = queue.begin(user, MAX_BATCH_SIZE);
  if (!batch || !user) return;
  let acknowledged = false;
  try {
    const token = await user.getIdToken();
    if (!queue.isCurrent(auth.currentUser, batch)) return;
    const requestPresence = MONTHLY_PRESENCE_EMULATOR && monthlyPresence.shouldRequest(user, Date.now());
    if (requestPresence) monthlyPresence.attempted(user, Date.now());
    const response = await fetch(REMOTE_ACTIVITY_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ events: batch.events.map(remoteEvent), ...(requestPresence ? {monthlyPresenceRequested:true} : {}) }),
      cache: 'no-store',
      credentials: 'same-origin',
      signal: batch.controller.signal,
    });
    if (!response.ok) throw new Error(`activity transport HTTP ${response.status}`);
    acknowledged = true;
    if (requestPresence) {
      const result = await response.json().catch(() => null) as {monthlyPresence?:unknown} | null;
      if (queue.isCurrent(auth.currentUser, batch)) monthlyPresence.acknowledge(user, result?.monthlyPresence);
    }
  } catch (error) {
    if (queue.isCurrent(auth.currentUser, batch)) console.warn('[ActivityRemote] envio adiado.', error);
  } finally {
    synchronizeActivityRemoteSession();
    if (queue.finish(auth.currentUser, batch, acknowledged) && queue.size() > 0) {
      scheduleFlush(queue.size() >= MAX_BATCH_SIZE && acknowledged ? 0 : RETRY_DELAY_MS);
    }
  }
};
