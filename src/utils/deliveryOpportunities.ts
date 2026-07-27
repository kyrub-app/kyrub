import {
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from './firebase';
import type { DeliveryJob } from '../types';

export const KYRUB_DELIVERIES_COLLECTION_PATH = 'hub/renda/deliveries';

export type KyrubDeliveryOperationalStatus = Extract<
  DeliveryJob['status'],
  'accepted' | 'delivering' | 'done'
>;

export const getKyrubDeliveryDocumentPath = (deliveryId: string): string =>
  `${KYRUB_DELIVERIES_COLLECTION_PATH}/${deliveryId.trim()}`;

export const updateKyrubDeliveryOpportunityStatus = async (
  deliveryId: string,
  status: KyrubDeliveryOperationalStatus,
  user: Pick<User, 'uid' | 'displayName' | 'email'>
): Promise<void> => {
  const normalizedId = deliveryId.trim();
  if (!normalizedId) throw new Error('A entrega não foi identificada.');

  const actorName =
    user.displayName?.trim() || user.email?.trim() || 'Entregador Kyrub';
  const patch: Record<string, unknown> = {
    status,
    updatedAt: serverTimestamp(),
  };

  if (status === 'accepted') {
    patch.acceptedBy = user.uid;
    patch.acceptedByName = actorName;
    patch.acceptedAt = serverTimestamp();
    patch.fallbackStatus = 'accepted_by_kyrub';
  }

  if (status === 'delivering') {
    patch.collectedAt = serverTimestamp();
  }

  if (status === 'done') {
    patch.deliveredAt = serverTimestamp();
  }

  await updateDoc(doc(db, getKyrubDeliveryDocumentPath(normalizedId)), patch);
};
