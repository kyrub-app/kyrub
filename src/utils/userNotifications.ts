import type { UserNotification } from '../../shared/userNotifications';
import { auth } from './firebase';

export interface UserNotificationInbox {
  notifications: UserNotification[];
  unreadCount: number;
}

const currentUser = () => {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente para ver suas notificações.');
  return user;
};

const json = async <T>(response: Response): Promise<T> => {
  const payload = response.status === 204
    ? null
    : await response.json() as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      payload && typeof payload.error === 'string'
        ? payload.error
        : 'As notificações estão temporariamente indisponíveis.'
    );
  }
  return payload as T;
};

const authorizedFetch = async (
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> => {
  const user = currentUser();
  const token = await user.getIdToken();
  return fetch(input, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
      authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });
};

export const loadUserNotificationInbox = async (
  limit = 50
): Promise<UserNotificationInbox> =>
  json<UserNotificationInbox>(
    await authorizedFetch(`/api/notifications?limit=${Math.max(1, Math.min(100, limit))}`)
  );

export const markUserNotificationRead = async (
  notificationId: string
): Promise<void> => {
  await json<null>(
    await authorizedFetch('/api/notifications/read', {
      method: 'POST',
      body: JSON.stringify({ notificationId }),
    })
  );
};

export const markAllUserNotificationsRead = async (): Promise<number> => {
  const result = await json<{ marked: number }>(
    await authorizedFetch('/api/notifications/read-all', {
      method: 'POST',
      body: JSON.stringify({}),
    })
  );
  return Number.isSafeInteger(result.marked) ? result.marked : 0;
};

export const respondToCommunityGroupInvite = async (
  groupId: string,
  decision: 'accepted' | 'declined'
): Promise<{ status: 'accepted' | 'declined' }> =>
  json<{ status: 'accepted' | 'declined' }>(
    await authorizedFetch('/api/notifications/community-group-invitations/respond', {
      method: 'POST',
      body: JSON.stringify({ groupId, decision }),
    })
  );

export const issueCommunityGroupInvite = async (
  groupId: string,
  inviteeUserId: string
): Promise<{ status: 'pending' }> =>
  json<{ status: 'pending' }>(
    await authorizedFetch('/api/notifications/community-group-invitations/issue', {
      method: 'POST',
      body: JSON.stringify({ groupId, inviteeUserId }),
    })
  );
