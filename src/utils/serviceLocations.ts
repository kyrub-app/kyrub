import type {
  ServiceLocation,
  ServiceLocationKind,
} from '../../shared/serviceLocation';
import { auth } from './firebase';

const currentUser = () => {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente para configurar os locais da loja.');
  return user;
};

const authorizedFetch = async (
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> => {
  const token = await currentUser().getIdToken();
  return fetch(input, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
      authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });
};

const json = async <T>(response: Response): Promise<T> => {
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : 'Os locais de atendimento estão temporariamente indisponíveis.'
    );
  }
  return payload as T;
};

export const loadServiceLocations = async (
  storeId: string,
  options: { activeOnly?: boolean } = {}
): Promise<ServiceLocation[]> => {
  const params = new URLSearchParams({ storeId });
  if (options.activeOnly) params.set('activeOnly', 'true');
  const payload = await json<{ locations: ServiceLocation[] }>(
    await authorizedFetch(`/api/local-attendance/locations?${params.toString()}`)
  );
  return Array.isArray(payload.locations) ? payload.locations : [];
};

export const createManagedServiceLocation = async (input: {
  storeId: string;
  kind: ServiceLocationKind;
  label: string;
}): Promise<ServiceLocation> => {
  const payload = await json<{ location: ServiceLocation }>(
    await authorizedFetch('/api/local-attendance/locations', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  );
  window.dispatchEvent(new CustomEvent('kyrub-service-locations-changed'));
  return payload.location;
};

export const updateManagedServiceLocation = async (input: {
  storeId: string;
  locationId: string;
  kind?: ServiceLocationKind;
  label?: string;
  active?: boolean;
}): Promise<ServiceLocation> => {
  const { locationId, ...body } = input;
  const payload = await json<{ location: ServiceLocation }>(
    await authorizedFetch(
      `/api/local-attendance/locations/${encodeURIComponent(locationId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(body),
      }
    )
  );
  window.dispatchEvent(new CustomEvent('kyrub-service-locations-changed'));
  return payload.location;
};
