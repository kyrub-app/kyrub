import { isCourierVehicleType, type CourierVehicleType } from '../../shared/deliveryVehicleCompatibility';

export type GoogleMapsTravelMode = 'driving' | 'walking' | 'bicycling' | 'two-wheeler' | 'transit';

/** Uses Google Maps URLs without an API key. Two-wheeler is supported in Brazil,
 * but the external app decides whether a particular local route is available.
 */
export const courierTravelMode = (vehicle: CourierVehicleType): GoogleMapsTravelMode =>
  vehicle === 'bicycle' ? 'bicycling' : vehicle === 'motorcycle' ? 'two-wheeler' : 'driving';

export interface CourierNavigationInput {
  status: 'accepted' | 'delivering';
  vehicleType: CourierVehicleType | null;
  pickup: string;
  dropoff: string;
}

export const buildCourierDeliveryNavigationUrl = (input: CourierNavigationInput): string => {
  if (!isCourierVehicleType(input.vehicleType)) {
    throw new Error('Modalidade do veículo não confirmada no pedido.');
  }
  const destination = input.status === 'accepted' ? input.pickup : input.dropoff;
  if (!destination.trim() || /^(Destino exato liberado|Endereço disponível no painel)/i.test(destination.trim())) {
    throw new Error('O endereço do próximo trecho não está disponível.');
  }
  return buildGoogleMapsDirectionsUrl({
    destination,
    travelMode: courierTravelMode(input.vehicleType),
    navigate: true,
  });
};

export interface GoogleMapsDirectionsInput {
  destination: string;
  destinationPlaceId?: string;
  travelMode?: GoogleMapsTravelMode;
  navigate?: boolean;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const buildGoogleMapsDirectionsUrl = (
  input: GoogleMapsDirectionsInput
): string => {
  const destination = clean(input.destination);
  if (!destination) throw new Error('O ponto de coleta não foi identificado.');

  const params = new URLSearchParams({
    api: '1',
    destination,
    travelmode: input.travelMode ?? 'driving',
  });
  if (input.navigate === true) {
    // Let the Maps app use the courier's current GPS position; do not invent an origin.
    params.set('dir_action', 'navigate');
  }
  const destinationPlaceId = clean(input.destinationPlaceId);
  if (destinationPlaceId) {
    params.set('destination_place_id', destinationPlaceId);
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
};

export const openGoogleMapsDirections = (
  input: GoogleMapsDirectionsInput
): void => {
  if (typeof window === 'undefined') return;
  const url = buildGoogleMapsDirectionsUrl(input);
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) {
    window.location.assign(url);
  }
};
