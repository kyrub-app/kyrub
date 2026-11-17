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

/** Return-to-store navigation comes only from the courier-authorized protocol.
 * A missing, cached, or unreadable protocol must never guess a safe route.
 */
export type CourierReturnRouteStatus =
  | 'none'
  | 'checking'
  | 'unavailable'
  | 'return_authorized'
  | 'authorization_revoked'
  | 'courier_presented_to_store'
  | 'returned_to_store_pending_reconciliation';

export interface CourierRouteDecision {
  url: string;
  label: string;
  nextLeg: string;
  notice: string;
}

export const decideCourierRoute = (input: CourierNavigationInput & {
  returnStatus?: CourierReturnRouteStatus;
}): CourierRouteDecision => {
  const returnStatus = input.status === 'accepted' ? 'none' : (input.returnStatus ?? 'checking');

  if (returnStatus === 'checking' || returnStatus === 'unavailable') {
    return {
      url: '', label: '', nextLeg: 'orientação logística pendente',
      notice: 'Não foi possível confirmar as instruções atuais de devolução. Consulte o suporte antes de seguir viagem.',
    };
  }
  if (returnStatus === 'authorization_revoked') {
    return {
      url: '', label: '', nextLeg: 'retorno revogado',
      notice: 'A autorização de retorno foi revogada. Não vá à loja nem mude a entrega por conta própria; pare em segurança e consulte o suporte.',
    };
  }
  if (returnStatus === 'courier_presented_to_store'
    || returnStatus === 'returned_to_store_pending_reconciliation') {
    return {
      url: '', label: '', nextLeg: 'aguardando confirmação da loja',
      notice: 'Aguarde a conferência física da loja e as instruções da logística. A devolução não encerra automaticamente o pedido.',
    };
  }

  const returning = returnStatus === 'return_authorized';
  let url = '';
  try {
    url = buildCourierDeliveryNavigationUrl({
      ...input,
      status: returning ? 'accepted' : input.status,
    });
  } catch {
    // Missing or unverified destination/vehicle: navigation stays unavailable.
  }
  return {
    url,
    label: returning ? 'Navegar de volta à loja'
      : input.status === 'accepted' ? 'Navegar até a coleta' : 'Navegar até o cliente',
    nextLeg: returning ? 'retorno autorizado à loja original'
      : input.status === 'accepted' ? 'coleta' : 'cliente',
    notice: returning
      ? 'Devolução autorizada pela logística. A encomenda continua sob sua responsabilidade até a loja confirmar o recebimento.'
      : '',
  };
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
