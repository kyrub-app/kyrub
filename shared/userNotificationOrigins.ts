import type { UserNotification, UserNotificationCategory } from './userNotifications.js';

export type UserNotificationOrigin = 'all' | 'communities' | 'stores' | 'people' | 'platform';

export const USER_NOTIFICATION_ORIGIN_TABS: ReadonlyArray<{
  id: UserNotificationOrigin;
  label: string;
}> = [
  { id: 'all', label: 'Todas' },
  { id: 'communities', label: 'Comunidades' },
  { id: 'stores', label: 'Lojas' },
  { id: 'people', label: 'Pessoas' },
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

export const filterUserNotificationsByOrigin = (
  notifications: UserNotification[],
  origin: UserNotificationOrigin,
): UserNotification[] => origin === 'all'
  ? notifications
  : notifications.filter(item => userNotificationOrigin(item.category) === origin);
