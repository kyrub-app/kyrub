import {
  doc,
  runTransaction,
  serverTimestamp,
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

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const updateKyrubDeliveryOpportunityStatus = async (
  deliveryId: string,
  status: KyrubDeliveryOperationalStatus,
  user: Pick<User, 'uid' | 'displayName' | 'email'>
): Promise<void> => {
  const normalizedId = deliveryId.trim();
  if (!normalizedId) throw new Error('A entrega não foi identificada.');

  const actorName =
    user.displayName?.trim() || user.email?.trim() || 'Entregador Kyrub';
  const reference = doc(db, getKyrubDeliveryDocumentPath(normalizedId));

  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) throw new Error('Esta entrega não está mais disponível.');

    const current = snapshot.data() as Record<string, unknown>;
    const currentStatus = clean(current.status);
    const acceptedBy = clean(current.acceptedBy);

    if (status === 'accepted') {
      if (currentStatus === 'accepted' && acceptedBy === user.uid) return;
      if (currentStatus !== 'available') {
        throw new Error('Outro entregador já aceitou esta oportunidade.');
      }
      transaction.update(reference, {
        status: 'accepted',
        acceptedBy: user.uid,
        acceptedByName: actorName,
        acceptedAt: serverTimestamp(),
        fallbackStatus: 'accepted_by_kyrub',
        updatedAt: serverTimestamp(),
      });
      return;
    }

    if (acceptedBy !== user.uid) {
      throw new Error('Somente o entregador responsável pode atualizar a entrega.');
    }

    if (status === 'delivering') {
      if (currentStatus === 'delivering') return;
      if (currentStatus !== 'accepted') {
        throw new Error('A entrega precisa estar aceita antes da coleta.');
      }
      transaction.update(reference, {
        status: 'delivering',
        collectedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return;
    }

    if (currentStatus === 'done') return;
    if (currentStatus !== 'delivering') {
      throw new Error('Confirme a coleta antes de concluir a entrega.');
    }
    transaction.update(reference, {
      status: 'done',
      deliveredAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
};
