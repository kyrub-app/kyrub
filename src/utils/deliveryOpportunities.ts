import type { User } from 'firebase/auth';
import type { DeliveryJob } from '../types';
import type { CourierVehicleType, DeliveryCargo } from '../../shared/deliveryVehicleCompatibility';

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
  user: Pick<User, 'getIdToken'>,
  vehicleType?: CourierVehicleType,
  returnTariffConsent?: {fingerprint:string;confirmed:true}
): Promise<void> => {
  const normalizedId = deliveryId.trim();
  if (!normalizedId) throw new Error('A entrega não foi identificada.');

  const token = await user.getIdToken();
  const response = await fetch(
    `/api/delivery-opportunities/${encodeURIComponent(normalizedId)}/status`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status, ...(status === 'accepted' ? { vehicleType } : {}),
        ...(returnTariffConsent ? {returnTariffAccepted:true,
          returnTariffFingerprint:returnTariffConsent.fingerprint} : {}) }),
    }
  );

  if (response.ok) return;
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  throw new Error(
    typeof payload.error === 'string'
      ? payload.error
      : 'Não foi possível atualizar esta entrega.'
  );
};


/** Store-owned ERP order classification, committed by the server. */
export const classifyKyrubDeliveryOrderCargo = async (
  orderId: string,
  cargo: DeliveryCargo,
  user: Pick<User, 'getIdToken'>
): Promise<{ ready: boolean; allowedVehicles: CourierVehicleType[] }> => {
  const token = await user.getIdToken();
  const response = await fetch(
    `/api/delivery-opportunities/orders/${encodeURIComponent(orderId)}/cargo`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ cargo }),
    }
  );
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(
    typeof payload.error === 'string' ? payload.error : 'Não foi possível classificar a carga.'
  );
  return {
    ready: payload.ready === true,
    allowedVehicles: Array.isArray(payload.allowedVehicles)
      ? payload.allowedVehicles.filter((item): item is CourierVehicleType =>
          item === 'bicycle' || item === 'motorcycle' || item === 'car')
      : [],
  };
};
