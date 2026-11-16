import type { DeliveryJob } from '../types';
import { assessDeliveryCargo, isCourierVehicleType } from '../../shared/deliveryVehicleCompatibility';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const finite = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0;

type LegacyDelivery = DeliveryJob & {
  source?: string;
  acceptedByName?: string;
  orderStatus?: string;
};

/**
 * LegacyApp uses a shared localStorage key. Whitelist fields on both hydration
 * and persistence to prevent old precise addresses or geofences leaking between
 * accounts. Only server-authoritative jobs have a durable cache.
 */
export const sanitizeDeliveryCache = (value: unknown): DeliveryJob[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const data = entry as Record<string, unknown>;
    if (clean(data.source) !== 'kyrub-order') return [];
    const id = clean(data.id);
    const status = clean(data.status);
    if (!id || !['available', 'accepted', 'delivering', 'done'].includes(status)) return [];
    const cargoAssessment = assessDeliveryCargo(data.cargo);
    return [{
      id,
      from: clean(data.from),
      to: status === 'available'
        ? 'Destino exato liberado após o aceite'
        : 'Endereço disponível no painel privado de rastreio',
      distance: finite(data.distance),
      payment: finite(data.payment),
      status: status as DeliveryJob['status'],
      requestedBy: clean(data.requestedBy),
      acceptedBy: clean(data.acceptedBy) || undefined,
      source: 'kyrub-order',
      acceptedByName: clean(data.acceptedByName) || undefined,
      orderStatus: clean(data.orderStatus),
      cargo: cargoAssessment.cargo,
      cargoReady: data.cargoReady === true && cargoAssessment.ready,
      allowedVehicles: cargoAssessment.allowedVehicles,
      vehicleType: isCourierVehicleType(data.vehicleType) ? data.vehicleType : undefined,
    } as LegacyDelivery];
  });
};
