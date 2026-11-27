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
): Promise<{ status: 'pending'; created: boolean }> =>
  json<{ status: 'pending'; created: boolean }>(
    await authorizedFetch('/api/notifications/community-group-invitations/issue', {
      method: 'POST',
      body: JSON.stringify({ groupId, inviteeUserId }),
    })
  );

/** Notify the connected recipient only after the actual DM has been
 * committed. The server derives both people and the source from Firestore,
 * never from a caller-supplied recipient id or post content. */
export const issueCommunityForwardReceivedNotification = async (
  connectionId: string,
  messageId: string,
  postId: string,
): Promise<void> => {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(connectionId) ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(messageId) ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(postId)) {
    throw new Error('Referência de encaminhamento inválida.');
  }
  await authorizedFetch('/api/notifications/community-post-forward/received', {
    method: 'POST',
    body: JSON.stringify({ connectionId, messageId, postId }),
  });
};

/** Notify only the verified owner of a stored invitation; no recipient supplied by the client. */
export const issueNoteInvitationReceivedNotification = async (invitationId: string, ownerId: string): Promise<void> => {
  const user = currentUser();
  if (user.uid !== ownerId || !/^[a-zA-Z0-9_-]{1,160}$/.test(invitationId)) {
    throw new Error('Referência do convite inválida.');
  }
  const token = await user.getIdToken();
  if (auth.currentUser?.uid !== ownerId) throw new Error('Sessão alterada.');
  const response = await fetch('/api/notifications/note-invitations/received', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${token}` },
    cache: 'no-store',
    body: JSON.stringify({ invitationId }),
  });
  const result = await json<{ created: boolean }>(response);
  if (typeof result?.created !== 'boolean') throw new Error('Aviso não confirmado.');
};
