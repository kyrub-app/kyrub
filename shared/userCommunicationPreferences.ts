import type {
  UserNotification,
  UserNotificationCategory,
} from './userNotifications.js';

export const USER_COMMUNICATION_PREFERENCES_SCHEMA_VERSION = 1 as const;

export interface UserCommunicationCategoryPreferences {
  store_chat: boolean;
  order: boolean;
  loyalty: boolean;
  system: boolean;
}

export interface UserCommunicationPreferences {
  schemaVersion: typeof USER_COMMUNICATION_PREFERENCES_SCHEMA_VERSION;
  userId: string;
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
    browser: {
      enabled: false,
      categories: {
        store_chat: true,
        order: true,
        loyalty: true,
        system: true,
      },
    },
    updatedAt: '',
  };
};

export const buildUserCommunicationPreferences = (input: {
  userId: string;
  browserEnabled: boolean;
  categories: UserCommunicationCategoryPreferences;
  updatedAt: string;
}): UserCommunicationPreferences => {
  const defaults = buildDefaultUserCommunicationPreferences(input.userId);
  const updatedAt = clean(input.updatedAt);
  if (!updatedAt || !Number.isFinite(Date.parse(updatedAt))) {
    throw new Error('USER_COMMUNICATION_PREFERENCES_TIME_INVALID');
  }
  return {
    ...defaults,
    browser: {
      enabled: input.browserEnabled === true,
      categories: {
        store_chat: input.categories.store_chat === true,
        order: input.categories.order === true,
        loyalty: input.categories.loyalty === true,
        system: input.categories.system === true,
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

export const shouldDeliverUserNotificationToBrowser = (
  preferences: UserCommunicationPreferences,
  notification: Pick<UserNotification, 'recipientUserId' | 'category'>
): boolean => {
  if (notification.recipientUserId !== preferences.userId) return false;
  if (!preferences.browser.enabled) return false;
  const category = notification.category as UserNotificationCategory;
  return preferences.browser.categories[category] === true;
};
