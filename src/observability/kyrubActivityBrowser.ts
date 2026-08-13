import type {
  KyrubActivityEvent,
  KyrubActivityEventInput,
} from '../../shared/kyrubActivityEvents';
import { auth } from '../utils/firebase';
import {
  clearKyrubActivityEvents,
  readRecentKyrubActivityEvents,
  recordKyrubActivityEvent,
} from './kyrubActivityLog';
import {
  clearAuthoritativeActivityRuntimeEvents,
  rememberAuthoritativeActivityRuntimeEvent,
} from './kyrubAuthoritativeActivityRuntime';

export const KYRUB_ACTIVITY_UPDATED_EVENT = 'kyrub-activity-updated';

export const recordUserActivityEvent = (
  actorUid: string,
  input: KyrubActivityEventInput
): KyrubActivityEvent | null => {
  if (typeof window === 'undefined') return null;
  const normalizedUid = actorUid.trim();
  if (!normalizedUid) return null;

  const event = recordKyrubActivityEvent(
    window.localStorage,
    normalizedUid,
    input
  );
  rememberAuthoritativeActivityRuntimeEvent(event);

  window.dispatchEvent(
    new CustomEvent(KYRUB_ACTIVITY_UPDATED_EVENT, {
      detail: {
        actorUid: normalizedUid,
        eventId: event.id,
      },
    })
  );

  return event;
};

export const recordCurrentUserActivityEvent = (
  input: KyrubActivityEventInput
): KyrubActivityEvent | null => {
  const actorUid = auth.currentUser?.uid?.trim() ?? '';
  return actorUid ? recordUserActivityEvent(actorUid, input) : null;
};

export const readCurrentUserActivityEvents = (
  limit = 80
): KyrubActivityEvent[] => {
  if (typeof window === 'undefined') return [];
  const actorUid = auth.currentUser?.uid?.trim() ?? '';
  return actorUid
    ? readRecentKyrubActivityEvents(window.localStorage, actorUid, limit)
    : [];
};

export const clearCurrentUserActivityEvents = (): void => {
  if (typeof window === 'undefined') return;
  const actorUid = auth.currentUser?.uid?.trim() ?? '';
  if (!actorUid) return;
  clearKyrubActivityEvents(window.localStorage, actorUid);
  clearAuthoritativeActivityRuntimeEvents(actorUid);
  window.dispatchEvent(
    new CustomEvent(KYRUB_ACTIVITY_UPDATED_EVENT, {
      detail: { actorUid, cleared: true },
    })
  );
};
