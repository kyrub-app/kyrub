export interface GoogleMapsDirectionsInput {
  destination: string;
  destinationPlaceId?: string;
  travelMode?: 'driving' | 'walking' | 'bicycling' | 'transit';
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
