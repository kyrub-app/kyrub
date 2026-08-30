import {
  buildDeliveryCustomerDestinationResolution,
  type DeliveryCustomerDestinationResolution,
} from '../../shared/deliveryCustomerDestinationResolution.js';
import {
  GOOGLE_MAPS_API_KEY_SLOT,
  GOOGLE_MAPS_ENVIRONMENT,
  GOOGLE_MAPS_GEOCODING_ENDPOINT,
  GOOGLE_MAPS_PROVIDER_ID,
} from '../../shared/googleMapsIntegration.js';
import { resolvePlatformCredentials } from '../integrations/platformCredentialStore.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export interface CustomerDestinationResolutionAttempt {
  resolution: DeliveryCustomerDestinationResolution | null;
  status:
    | 'resolved'
    | 'review_required'
    | 'provider_not_configured'
    | 'not_found'
    | 'provider_unavailable';
}

export const resolveCustomerDestinationFromAddress = async (
  addressValue: unknown
): Promise<CustomerDestinationResolutionAttempt> => {
  const address = clean(addressValue);
  if (!address) return { resolution: null, status: 'not_found' };

  let credentials: Awaited<ReturnType<typeof resolvePlatformCredentials>>;
  try {
    credentials = await resolvePlatformCredentials(
      GOOGLE_MAPS_PROVIDER_ID,
      GOOGLE_MAPS_ENVIRONMENT
    );
  } catch (error) {
    console.warn('[Customer Destination Geocoding] credential vault unavailable');
    return { resolution: null, status: 'provider_unavailable' };
  }
  const apiKey = clean(credentials?.[GOOGLE_MAPS_API_KEY_SLOT]);
  if (!apiKey) {
    return { resolution: null, status: 'provider_not_configured' };
  }

  try {
    const url = new URL(GOOGLE_MAPS_GEOCODING_ENDPOINT);
    url.searchParams.set('address', address);
    url.searchParams.set('key', apiKey);
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    const googleStatus = clean(payload.status);
    if (!response.ok || googleStatus !== 'OK') {
      return {
        resolution: null,
        status: googleStatus === 'ZERO_RESULTS' ? 'not_found' : 'provider_unavailable',
      };
    }
    const first = Array.isArray(payload.results) ? payload.results[0] : null;
    if (!first || typeof first !== 'object' || Array.isArray(first)) {
      return { resolution: null, status: 'not_found' };
    }
    const result = first as Record<string, unknown>;
    const geometry = result.geometry && typeof result.geometry === 'object' && !Array.isArray(result.geometry)
      ? result.geometry as Record<string, unknown>
      : {};
    const location = geometry.location && typeof geometry.location === 'object' && !Array.isArray(geometry.location)
      ? geometry.location as Record<string, unknown>
      : {};
    const latitude = finite(location.lat);
    const longitude = finite(location.lng);
    if (latitude === null || longitude === null) {
      return { resolution: null, status: 'provider_unavailable' };
    }
    const resolution = buildDeliveryCustomerDestinationResolution({
      inputAddress: address,
      formattedAddress: clean(result.formatted_address),
      placeId: clean(result.place_id),
      latitude,
      longitude,
      locationType: geometry.location_type,
      partialMatch: result.partial_match === true,
      resolvedAt: new Date().toISOString(),
    });
    return {
      resolution,
      status: resolution.status,
    };
  } catch (error) {
    console.warn('[Customer Destination Geocoding] provider request failed');
    return { resolution: null, status: 'provider_unavailable' };
  }
};
