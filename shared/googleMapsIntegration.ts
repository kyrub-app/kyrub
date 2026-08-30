export const GOOGLE_MAPS_PROVIDER_ID = 'google_maps' as const;
export const GOOGLE_MAPS_ENVIRONMENT = 'production' as const;
export const GOOGLE_MAPS_API_KEY_SLOT = 'api_key' as const;
export const GOOGLE_MAPS_GEOCODING_ENDPOINT = 'https://maps.googleapis.com/maps/api/geocode/json' as const;

export const normalizeGoogleMapsApiKey = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const assertGoogleMapsApiKey = (value: unknown): string => {
  const apiKey = normalizeGoogleMapsApiKey(value);
  if (!apiKey) throw new Error('GOOGLE_MAPS_API_KEY_REQUIRED');
  if (apiKey.length > 4096) throw new Error('GOOGLE_MAPS_CREDENTIAL_TOO_LARGE');
  return apiKey;
};
