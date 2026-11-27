import type { UserNotification, UserNotificationCategory } from './userNotifications.js';

export type UserNotificationOrigin = 'all' | 'communities' | 'stores' | 'people' | 'erp' | 'platform';

export const USER_NOTIFICATION_ORIGIN_TABS: ReadonlyArray<{
  id: UserNotificationOrigin;
  label: string;
}> = [
  { id: 'all', label: 'Todas' },
  { id: 'communities', label: 'Comunidades' },
  { id: 'stores', label: 'Lojas' },
  { id: 'people', label: 'Pessoas' },
  { id: 'erp', label: 'ERP' },
  { id: 'platform', label: 'Plataforma' },
];

export const userNotificationOrigin = (category: UserNotificationCategory): Exclude<UserNotificationOrigin, 'all'> => {
  switch (category) {
    case 'community_group_invite':
      return 'communities';
    case 'store_chat':
    case 'order':
    case 'loyalty':
    case 'marketing':
      return 'stores';
    case 'social_chat':
    case 'note_invitation':
    case 'user_forward':
      return 'people';
    case 'system':
      return 'platform';
  }
};

// Existing Staff producers use category 'system'. Classify only their
// explicit operational events with a store reference; preserve IDs and schema.
const ERP_STAFF_EVENTS: ReadonlySet<string> = new Set([
  'staff_notice_published',
  'staff_task_assigned',
  'staff_shift_published',
  'staff_shift_cancelled',
]);

export const notificationOrigin = (
  notification: Pick<UserNotification, 'category' | 'eventType' | 'target'>,
): Exclude<UserNotificationOrigin, 'all'> => {
  if (notification.category === 'system' &&
      ERP_STAFF_EVENTS.has(notification.eventType) &&
      notification.target.kind === 'none' &&
      notification.target.storeId.trim().length > 0) return 'erp';
  return userNotificationOrigin(notification.category);
};

export const filterUserNotificationsByOrigin = (
  notifications: UserNotification[],
  origin: UserNotificationOrigin,
): UserNotification[] => origin === 'all'
  ? notifications
  : notifications.filter(item => notificationOrigin(item) === origin);
