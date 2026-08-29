import type { DocumentData, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  userNotificationPath,
  type UserNotification,
  type UserNotificationCategory,
  type UserNotificationTargetKind,
} from '../../shared/userNotifications.js';

export interface UserNotificationInbox {
  notifications: UserNotification[];
  unreadCount: number;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finiteIso = (value: unknown): string => {
  const normalized = clean(value);
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : '';
};

const CATEGORIES = new Set<UserNotificationCategory>([
  'store_chat',
  'order',
  'loyalty',
  'system',
]);
const TARGET_KINDS = new Set<UserNotificationTargetKind>([
  'store_chat',
  'storefront',
  'order',
  'none',
]);

const parseNotification = (
  document: QueryDocumentSnapshot<DocumentData> | { id: string; data(): DocumentData },
  recipientUserId: string
): UserNotification => {
  const value = document.data() as Partial<UserNotification>;
  const target = value.target as Partial<UserNotification['target']> | undefined;
  if (
    value.schemaVersion !== 1 ||
    value.id !== document.id ||
    value.recipientUserId !== recipientUserId ||
    !CATEGORIES.has(value.category as UserNotificationCategory) ||
    !clean(value.eventType) ||
    !clean(value.sourceId) ||
    !clean(value.actorPrincipalId) ||
    !clean(value.title) ||
    typeof value.body !== 'string' ||
    !finiteIso(value.createdAt) ||
    (value.readAt !== '' && !finiteIso(value.readAt)) ||
    !target ||
    !TARGET_KINDS.has(target.kind as UserNotificationTargetKind) ||
    typeof target.storeId !== 'string' ||
    typeof target.customerId !== 'string' ||
    typeof target.orderId !== 'string'
  ) {
    throw new Error('USER_NOTIFICATION_INVALID');
  }
  return value as UserNotification;
};

const notificationsCollection = (recipientUserId: string) =>
  adminDb.collection(`users/${recipientUserId}/notifications`);

export const listUserNotifications = async (input: {
  recipientUserId: string;
  limit?: number;
}): Promise<UserNotificationInbox> => {
  const recipientUserId = clean(input.recipientUserId);
  if (!recipientUserId) throw new Error('USER_NOTIFICATION_USER_REQUIRED');
  const limit = Math.max(1, Math.min(100, input.limit ?? 50));

  const [recentSnapshot, unreadSnapshot] = await Promise.all([
    notificationsCollection(recipientUserId)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get(),
    notificationsCollection(recipientUserId)
      .where('readAt', '==', '')
      .get(),
  ]);

  return {
    notifications: recentSnapshot.docs.map(document =>
      parseNotification(document, recipientUserId)
    ),
    unreadCount: unreadSnapshot.size,
  };
};

export const markUserNotificationRead = async (input: {
  recipientUserId: string;
  notificationId: string;
  now?: Date;
}): Promise<void> => {
  const recipientUserId = clean(input.recipientUserId);
  const notificationId = clean(input.notificationId);
  if (!recipientUserId || !notificationId) {
    throw new Error('USER_NOTIFICATION_REQUIRED');
  }
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('USER_NOTIFICATION_TIME_INVALID');
  const reference = adminDb.doc(
    userNotificationPath(recipientUserId, notificationId)
  );

  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new Error('USER_NOTIFICATION_NOT_FOUND');
    const notification = parseNotification(
      { id: snapshot.id, data: () => snapshot.data()! },
      recipientUserId
    );
    if (notification.readAt) return;
    transaction.update(reference, { readAt: now.toISOString() });
  });
};

export const markAllUserNotificationsRead = async (input: {
  recipientUserId: string;
  now?: Date;
}): Promise<number> => {
  const recipientUserId = clean(input.recipientUserId);
  if (!recipientUserId) throw new Error('USER_NOTIFICATION_USER_REQUIRED');
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('USER_NOTIFICATION_TIME_INVALID');
  const snapshot = await notificationsCollection(recipientUserId)
    .where('readAt', '==', '')
    .limit(200)
    .get();
  if (snapshot.empty) return 0;

  const batch = adminDb.batch();
  const readAt = now.toISOString();
  for (const document of snapshot.docs) {
    parseNotification(document, recipientUserId);
    batch.update(document.ref, { readAt });
  }
  await batch.commit();
  return snapshot.size;
};
