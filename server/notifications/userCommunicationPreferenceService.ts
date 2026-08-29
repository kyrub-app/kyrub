import { adminDb } from '../firebaseAdmin.js';
import {
  buildDefaultUserCommunicationPreferences,
  buildUserCommunicationPreferences,
  userCommunicationPreferencesPath,
  type UserCommunicationCategoryPreferences,
  type UserCommunicationPreferences,
} from '../../shared/userCommunicationPreferences.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const parsePreferences = (
  value: unknown,
  userId: string
): UserCommunicationPreferences => {
  const data = value as Partial<UserCommunicationPreferences>;
  const browser = data.browser as Partial<UserCommunicationPreferences['browser']> | undefined;
  const categories = browser?.categories as
    | Partial<UserCommunicationCategoryPreferences>
    | undefined;
  if (
    data.schemaVersion !== 1 ||
    data.userId !== userId ||
    (browser?.enabled !== true && browser?.enabled !== false) ||
    (categories?.store_chat !== true && categories?.store_chat !== false) ||
    (categories?.order !== true && categories?.order !== false) ||
    (categories?.loyalty !== true && categories?.loyalty !== false) ||
    (categories?.marketing !== true && categories?.marketing !== false) ||
    (categories?.system !== true && categories?.system !== false) ||
    typeof data.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(data.updatedAt))
  ) {
    throw new Error('USER_COMMUNICATION_PREFERENCES_INVALID');
  }
  return data as UserCommunicationPreferences;
};

export const loadUserCommunicationPreferences = async (
  userIdInput: string
): Promise<UserCommunicationPreferences> => {
  const userId = clean(userIdInput);
  if (!userId) throw new Error('USER_COMMUNICATION_PREFERENCES_USER_REQUIRED');
  const snapshot = await adminDb.doc(userCommunicationPreferencesPath(userId)).get();
  if (!snapshot.exists) return buildDefaultUserCommunicationPreferences(userId);
  return parsePreferences(snapshot.data(), userId);
};

export const saveUserCommunicationPreferences = async (input: {
  userId: string;
  browserEnabled: boolean;
  categories: UserCommunicationCategoryPreferences;
  now?: Date;
}): Promise<UserCommunicationPreferences> => {
  const userId = clean(input.userId);
  if (!userId) throw new Error('USER_COMMUNICATION_PREFERENCES_USER_REQUIRED');
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error('USER_COMMUNICATION_PREFERENCES_TIME_INVALID');
  }
  const preferences = buildUserCommunicationPreferences({
    userId,
    browserEnabled: input.browserEnabled,
    categories: input.categories,
    updatedAt: now.toISOString(),
  });
  await adminDb.doc(userCommunicationPreferencesPath(userId)).set(preferences);
  return preferences;
};
