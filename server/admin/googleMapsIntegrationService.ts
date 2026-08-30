import {
  GOOGLE_MAPS_API_KEY_SLOT,
  GOOGLE_MAPS_ENVIRONMENT,
  GOOGLE_MAPS_GEOCODING_ENDPOINT,
  GOOGLE_MAPS_PROVIDER_ID,
  assertGoogleMapsApiKey,
} from '../../shared/googleMapsIntegration.js';
import {
  loadPlatformCredentialMetadata,
  markPlatformCredentialValidation,
  resolvePlatformCredentials,
  savePlatformCredentials,
} from '../integrations/platformCredentialStore.js';

export const saveGoogleMapsCredential = async (apiKeyValue: unknown) =>
  savePlatformCredentials({
    providerId: GOOGLE_MAPS_PROVIDER_ID,
    environment: GOOGLE_MAPS_ENVIRONMENT,
    credentials: { [GOOGLE_MAPS_API_KEY_SLOT]: assertGoogleMapsApiKey(apiKeyValue) },
  });

export const testGoogleMapsGeocodingConnection = async (): Promise<{
  ok: boolean;
  code: string;
}> => {
  const credentials = await resolvePlatformCredentials(
    GOOGLE_MAPS_PROVIDER_ID,
    GOOGLE_MAPS_ENVIRONMENT
  );
  const apiKey = assertGoogleMapsApiKey(credentials?.[GOOGLE_MAPS_API_KEY_SLOT]);
  const url = new URL(GOOGLE_MAPS_GEOCODING_ENDPOINT);
  url.searchParams.set('address', 'Brasil');
  url.searchParams.set('key', apiKey);
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const googleStatus = typeof payload.status === 'string' ? payload.status.trim() : '';
  const ok = response.ok && (googleStatus === 'OK' || googleStatus === 'ZERO_RESULTS');
  const code = ok ? 'CONNECTED' : (googleStatus || `HTTP_${response.status}`);
  await markPlatformCredentialValidation({
    providerId: GOOGLE_MAPS_PROVIDER_ID,
    environment: GOOGLE_MAPS_ENVIRONMENT,
    ok,
    code,
  });
  return { ok, code };
};

export const loadGoogleMapsCredentialMetadata = () =>
  loadPlatformCredentialMetadata(GOOGLE_MAPS_PROVIDER_ID, GOOGLE_MAPS_ENVIRONMENT);
