import type { DeliveryCargo, CourierVehicleType } from '../../shared/deliveryVehicleCompatibility.js';
import type { ReturnTariffOffer } from '../../shared/deliveryReturnTariffOffer.js';

/** Safe public subset of an ERP delivery opportunity; buyer route details remain private. */
export interface PublicKyrubDeliveryOfferInput {
  id: string;
  storeName: string;
  status: string;
  orderStatus: string;
  distance: number;
  payment: number;
  returnTariffOffer: ReturnTariffOffer | null;
  cargo: DeliveryCargo | null;
  cargoReady: boolean;
  allowedVehicles: CourierVehicleType[];
}
export const PUBLIC_KYRUB_DESTINATION_LABEL = 'Destino exato liberado após o aceite';

export const buildPublicKyrubDeliveryOffer = (input: PublicKyrubDeliveryOfferInput) => {
  const storeName = input.storeName.trim() || 'Estabelecimento Kyrub';
  return {
    id: input.id,
    source: 'kyrub-order' as const,
    from: storeName,
    to: PUBLIC_KYRUB_DESTINATION_LABEL,
    requestedBy: storeName,
    status: input.status,
    orderStatus: input.orderStatus,
    distance: Number.isFinite(input.distance) && input.distance > 0 ? input.distance : 0,
    payment: Number.isFinite(input.payment) && input.payment > 0 ? input.payment : 0,
    returnTariffOffer: input.returnTariffOffer,
    cargo: input.cargo,
    cargoReady: input.cargoReady,
    allowedVehicles: input.allowedVehicles,
  };
};
