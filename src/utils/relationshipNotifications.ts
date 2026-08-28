import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';

export type RelationshipNotificationKind = 'relationship';

export interface RelationshipNotification {
  id: string;
  kind: RelationshipNotificationKind;
  recipientId: string;
  senderStoreId: string;
  title: string;
  body: string;
  campaignId: string;
  benefitId: string;
  createdAt: string;
  readAt: string;
}

const cleanString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const getUserRelationshipNotificationsCollectionPath = (userId: string): string =>
  `relationshipNotifications/${userId.trim()}/items`;

const parseNotification = (value: unknown): RelationshipNotification | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = cleanString(record.id);
  const recipientId = cleanString(record.recipientId);
  const senderStoreId = cleanString(record.senderStoreId);
  const title = cleanString(record.title);
  const body = cleanString(record.body);
  if (!id || !recipientId || !senderStoreId || !title || !body) return null;
  return {
    id,
    kind: 'relationship',
    recipientId,
    senderStoreId,
    title,
    body,
    campaignId: cleanString(record.campaignId),
    benefitId: cleanString(record.benefitId),
    createdAt: cleanString(record.createdAt),
    readAt: cleanString(record.readAt),
  };
};

export const subscribeToUserRelationshipNotifications = (
  userId: string,
  onNotifications: (notifications: RelationshipNotification[]) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  const normalized = userId.trim();
  if (!normalized) {
    onNotifications([]);
    return () => undefined;
  }
  return onSnapshot(
    collection(db, getUserRelationshipNotificationsCollectionPath(normalized)),
    snapshot => {
      onNotifications(
        snapshot.docs
          .flatMap(item => {
            const parsed = parseNotification(item.data());
            return parsed ? [parsed] : [];
          })
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      );
    },
    error => {
      onNotifications([]);
      onError?.(error);
    }
  );
};

export const markRelationshipNotificationRead = async (
  userId: string,
  notificationId: string
): Promise<void> => {
  const normalizedUserId = userId.trim();
  const normalizedNotificationId = notificationId.trim();
  if (!normalizedUserId || !normalizedNotificationId) return;
  await setDoc(
    doc(db, getUserRelationshipNotificationsCollectionPath(normalizedUserId), normalizedNotificationId),
    {
      readAt: new Date().toISOString(),
      readRecordedAt: serverTimestamp(),
    },
    { merge: true }
  );
};

export interface OpenCustomerRelationshipDetail {
  storeId: string;
  benefitId?: string;
  campaignId?: string;
}

export const openCustomerRelationship = (detail: OpenCustomerRelationshipDetail): void => {
  window.dispatchEvent(new CustomEvent('kyrub:open-customer-relationship', { detail }));
};
