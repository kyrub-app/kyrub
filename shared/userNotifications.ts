export const USER_NOTIFICATION_SCHEMA_VERSION = 1 as const;
export const USER_NOTIFICATION_MAX_TITLE_LENGTH = 120;
export const USER_NOTIFICATION_MAX_BODY_LENGTH = 500;

export type UserNotificationCategory =
  | 'social_chat'
  | 'note_invitation'
  | 'store_chat'
  | 'order'
  | 'loyalty'
  | 'marketing'
  | 'community_group_invite'
  | 'user_forward'
  | 'system';

export type UserNotificationTargetKind =
  | 'social_chat'
  | 'note_invitation'
  | 'store_chat'
  | 'storefront'
  | 'order'
  | 'community_group_invite'
  | 'community_post'
  | 'none';

export interface UserNotificationTarget {
  kind: UserNotificationTargetKind;
  storeId: string;
  customerId: string;
  orderId: string;
  /** Verified public storefront slug for navigating from the bell. */
  storeSlug?: string;
  communityId?: string;
  groupId?: string;
  postId?: string;
  noteInvitationId?: string;
  connectionId?: string;
}

export interface UserNotification {
  schemaVersion: typeof USER_NOTIFICATION_SCHEMA_VERSION;
  id: string;
  recipientUserId: string;
  category: UserNotificationCategory;
  eventType: string;
  sourceId: string;
  actorPrincipalId: string;
  title: string;
  body: string;
  target: UserNotificationTarget;
  createdAt: string;
  readAt: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const validPathId = (value: string): boolean =>
  Boolean(value) &&
  value.length <= 160 &&
  !value.includes('/') &&
  value !== '.' &&
  value !== '..';

const finiteIso = (value: string): boolean =>
  Boolean(value) && Number.isFinite(Date.parse(value));

const truncate = (value: unknown, max: number): string =>
  clean(value).slice(0, max);

export const buildUserNotificationId = (input: {
  category: UserNotificationCategory;
  eventType: string;
  sourceId: string;
}): string => {
  const eventType = clean(input.eventType).replace(/[^a-zA-Z0-9_-]+/g, '_');
  const sourceId = clean(input.sourceId).replace(/[^a-zA-Z0-9_-]+/g, '_');
  const id = `${input.category}_${eventType}_${sourceId}`.slice(0, 160);
  if (!eventType || !sourceId || !validPathId(id)) {
    throw new Error('USER_NOTIFICATION_ID_INVALID');
  }
  return id;
};

export const userNotificationPath = (
  recipientUserIdInput: string,
  notificationIdInput: string
): string => {
  const recipientUserId = clean(recipientUserIdInput);
  const notificationId = clean(notificationIdInput);
  if (!validPathId(recipientUserId) || !validPathId(notificationId)) {
    throw new Error('USER_NOTIFICATION_PATH_INVALID');
  }
  return `users/${recipientUserId}/notifications/${notificationId}`;
};

export const buildUserNotification = (input: {
  id?: string;
  recipientUserId: string;
  category: UserNotificationCategory;
  eventType: string;
  sourceId: string;
  actorPrincipalId: string;
  title: string;
  body: string;
  target?: Partial<UserNotificationTarget>;
  createdAt: string;
}): UserNotification => {
  const recipientUserId = clean(input.recipientUserId);
  const eventType = clean(input.eventType);
  const sourceId = clean(input.sourceId);
  const actorPrincipalId = clean(input.actorPrincipalId);
  const createdAt = clean(input.createdAt);
  const id = clean(input.id) || buildUserNotificationId({
    category: input.category,
    eventType,
    sourceId,
  });
  const title = truncate(input.title, USER_NOTIFICATION_MAX_TITLE_LENGTH);
  const body = truncate(input.body, USER_NOTIFICATION_MAX_BODY_LENGTH);
  if (
    !validPathId(recipientUserId) ||
    !validPathId(id) ||
    !eventType ||
    !sourceId ||
    !actorPrincipalId ||
    !title ||
    !finiteIso(createdAt)
  ) {
    throw new Error('USER_NOTIFICATION_INVALID');
  }

  const targetKind = input.target?.kind ?? 'none';
  if (
    targetKind !== 'social_chat' &&
    targetKind !== 'note_invitation' &&
    targetKind !== 'store_chat' &&
    targetKind !== 'storefront' &&
    targetKind !== 'order' &&
    targetKind !== 'community_group_invite' &&
    targetKind !== 'community_post' &&
    targetKind !== 'none'
  ) {
    throw new Error('USER_NOTIFICATION_TARGET_INVALID');
  }

  if (targetKind === 'social_chat' && !validPathId(clean(input.target?.connectionId))) {
    throw new Error('USER_NOTIFICATION_TARGET_INVALID');
  }
  if (targetKind === 'note_invitation' && !validPathId(clean(input.target?.noteInvitationId))) {
    throw new Error('USER_NOTIFICATION_TARGET_INVALID');
  }
  if (targetKind === 'community_group_invite' &&
    (!validPathId(clean(input.target?.communityId)) || !validPathId(clean(input.target?.groupId)))) {
    throw new Error('USER_NOTIFICATION_TARGET_INVALID');
  }
  if (targetKind === 'community_post' &&
    (!validPathId(clean(input.target?.communityId)) || !validPathId(clean(input.target?.postId)))) {
    throw new Error('USER_NOTIFICATION_TARGET_INVALID');
  }

  return {
    schemaVersion: USER_NOTIFICATION_SCHEMA_VERSION,
    id,
    recipientUserId,
    category: input.category,
    eventType,
    sourceId,
    actorPrincipalId,
    title,
    body,
    target: {
      kind: targetKind,
      ...(targetKind === 'social_chat' ? { connectionId: clean(input.target?.connectionId) } : {}),
      ...(targetKind === 'note_invitation' ? { noteInvitationId: clean(input.target?.noteInvitationId) } : {}),
      storeId: clean(input.target?.storeId),
      customerId: clean(input.target?.customerId),
      orderId: clean(input.target?.orderId),
      ...(targetKind === 'storefront' && /^[a-zA-Z0-9-]{1,128}$/.test(clean(input.target?.storeSlug))
        ? { storeSlug: clean(input.target?.storeSlug) }
        : {}),
      ...(targetKind === 'community_group_invite'
        ? { communityId: clean(input.target?.communityId), groupId: clean(input.target?.groupId) }
        : {}),
      ...(targetKind === 'community_post'
        ? { communityId: clean(input.target?.communityId), postId: clean(input.target?.postId) }
        : {}),
    },
    createdAt,
    readAt: '',
  };
};

export const isUserNotificationUnread = (
  notification: Pick<UserNotification, 'readAt'>
): boolean => !clean(notification.readAt);
