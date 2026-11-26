import type {
  UserNotification,
  UserNotificationCategory,
} from './userNotifications.js';

export const USER_COMMUNICATION_PREFERENCES_SCHEMA_VERSION = 1 as const;

export interface UserCommunicationCategoryPreferences {
  store_chat: boolean;
  social_chat?: boolean;
  note_invitation?: boolean;
  order: boolean;
  loyalty: boolean;
  marketing: boolean;
  system: boolean;
  community_group_invite?: boolean;
  user_forward?: boolean;
  freelance?: boolean;
}

export interface UserCommunicationPreferences {
  schemaVersion: typeof USER_COMMUNICATION_PREFERENCES_SCHEMA_VERSION;
  userId: string;
  marketing: {
    enabled: boolean;
  };
  browser: {
    enabled: boolean;
    categories: UserCommunicationCategoryPreferences;
  };
  updatedAt: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const validUserId = (value: string): boolean =>
  Boolean(value) && value.length <= 160 && !value.includes('/');

export const buildDefaultUserCommunicationPreferences = (
  userIdInput: string
): UserCommunicationPreferences => {
  const userId = clean(userIdInput);
  if (!validUserId(userId)) {
    throw new Error('USER_COMMUNICATION_PREFERENCES_USER_INVALID');
  }
  return {
    schemaVersion: USER_COMMUNICATION_PREFERENCES_SCHEMA_VERSION,
    userId,
    marketing: {
      enabled: false,
    },
    browser: {
      enabled: false,
      categories: {
        store_chat: true,
        social_chat: true,
        note_invitation: true,
        order: true,
        loyalty: true,
        marketing: false,
        system: true,
        community_group_invite: true,
        user_forward: true,
        freelance: false,
      },
    },
    updatedAt: '',
  };
};

export const buildUserCommunicationPreferences = (input: {
  userId: string;
  marketingEnabled: boolean;
  browserEnabled: boolean;
  categories: UserCommunicationCategoryPreferences;
  updatedAt: string;
}): UserCommunicationPreferences => {
  const defaults = buildDefaultUserCommunicationPreferences(input.userId);
  const updatedAt = clean(input.updatedAt);
  if (!updatedAt || !Number.isFinite(Date.parse(updatedAt))) {
    throw new Error('USER_COMMUNICATION_PREFERENCES_TIME_INVALID');
  }
  const marketingEnabled = input.marketingEnabled === true;
  return {
    ...defaults,
    marketing: {
      enabled: marketingEnabled,
    },
    browser: {
      enabled: input.browserEnabled === true,
      categories: {
        store_chat: input.categories.store_chat === true,
        social_chat: input.categories.social_chat !== false,
        note_invitation: input.categories.note_invitation !== false,
        order: input.categories.order === true,
        loyalty: input.categories.loyalty === true,
        marketing:
          marketingEnabled && input.categories.marketing === true,
        system: input.categories.system === true,
        community_group_invite: input.categories.community_group_invite !== false,
        user_forward: input.categories.user_forward !== false,
        freelance: input.categories.freelance === true,
      },
    },
    updatedAt,
  };
};

export const userCommunicationPreferencesPath = (
  userIdInput: string
): string => {
  const userId = clean(userIdInput);
  if (!validUserId(userId)) {
    throw new Error('USER_COMMUNICATION_PREFERENCES_USER_INVALID');
  }
  return `users/${userId}/communicationPreferences/current`;
};

export const shouldReceiveUserNotificationInApp = (
  preferences: UserCommunicationPreferences,
  category: UserNotificationCategory
): boolean => category !== 'marketing' || preferences.marketing.enabled;

export const shouldDeliverUserNotificationToBrowser = (
  preferences: UserCommunicationPreferences,
  notification: Pick<UserNotification, 'recipientUserId' | 'category'>
): boolean => {
  if (notification.recipientUserId !== preferences.userId) return false;
  if (!shouldReceiveUserNotificationInApp(preferences, notification.category)) {
    return false;
  }
  if (!preferences.browser.enabled) return false;
  return preferences.browser.categories[notification.category] === true;
};
