import type {
  LocalServiceRequest,
  LocalServiceRequestKind,
} from '../../shared/localServiceRequest';
import { auth } from './firebase';

const authorizedFetch = async (
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente para solicitar atendimento.');
  const token = await user.getIdToken();
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

const readJson = async <T>(response: Response): Promise<T> => {
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : 'O atendimento está temporariamente indisponível.'
    );
  }
  return payload as T;
};

export const createLocalServiceRequest = async (input: {
  storeId: string;
  orderId: string;
  kind: LocalServiceRequestKind;
}): Promise<LocalServiceRequest> => {
  const payload = await readJson<{ request: LocalServiceRequest }>(
    await authorizedFetch('/api/local-attendance/service-requests', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  );
  return payload.request;
};

export const cancelLocalServiceRequest = async (input: {
  storeId: string;
  requestId: string;
}): Promise<LocalServiceRequest> => {
  const payload = await readJson<{ request: LocalServiceRequest }>(
    await authorizedFetch(
      `/api/local-attendance/service-requests/${encodeURIComponent(input.requestId)}/cancel`,
      {
        method: 'POST',
        body: JSON.stringify({ storeId: input.storeId }),
      }
    )
  );
  return payload.request;
};

export const loadActiveLocalServiceRequests = async (
  storeId: string
): Promise<LocalServiceRequest[]> => {
  const params = new URLSearchParams({ storeId });
  const payload = await readJson<{ requests: LocalServiceRequest[] }>(
    await authorizedFetch(
      `/api/local-attendance/service-requests?${params.toString()}`
    )
  );
  return Array.isArray(payload.requests) ? payload.requests : [];
};

const transitionLocalServiceRequest = async (input: {
  storeId: string;
  requestId: string;
  transition: 'acknowledge' | 'resolve';
}): Promise<LocalServiceRequest> => {
  const payload = await readJson<{ request: LocalServiceRequest }>(
    await authorizedFetch(
      `/api/local-attendance/service-requests/${encodeURIComponent(input.requestId)}/${input.transition}`,
      {
        method: 'POST',
        body: JSON.stringify({ storeId: input.storeId }),
      }
    )
  );
  return payload.request;
};

export const acknowledgeLocalServiceRequest = (input: {
  storeId: string;
  requestId: string;
}) => transitionLocalServiceRequest({ ...input, transition: 'acknowledge' });

export const resolveLocalServiceRequest = (input: {
  storeId: string;
  requestId: string;
}) => transitionLocalServiceRequest({ ...input, transition: 'resolve' });
