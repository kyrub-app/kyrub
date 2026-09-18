import type {
  InPersonCustomerCandidate,
  InPersonCustomerContext,
  InPersonCustomerLookupKind,
} from '../../shared/inPersonCustomerIdentity';
import { auth } from './firebase';

const currentUser = () => {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente para identificar o cliente.');
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
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : 'A identificação do cliente está temporariamente indisponível.'
    );
  }
  return payload as T;
};

export const searchInPersonCustomers = async (input: {
  storeId: string;
  orderId: string;
  kind: InPersonCustomerLookupKind;
  query: string;
}): Promise<InPersonCustomerCandidate[]> => {
  const payload = await json<{ candidates: InPersonCustomerCandidate[] }>(
    await authorizedFetch('/api/local-attendance/customers/search', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  );
  return Array.isArray(payload.candidates) ? payload.candidates : [];
};

export const loadInPersonCustomerContext = async (input: {
  storeId: string;
  orderId: string;
}): Promise<InPersonCustomerContext> => {
  const params = new URLSearchParams(input);
  const payload = await json<{ context: InPersonCustomerContext }>(
    await authorizedFetch(
      `/api/local-attendance/customers/context?${params.toString()}`
    )
  );
  return payload.context;
};

export const linkInPersonCustomer = async (input: {
  storeId: string;
  orderId: string;
  customerRef: string;
}): Promise<InPersonCustomerContext> => {
  const payload = await json<{ context: InPersonCustomerContext }>(
    await authorizedFetch('/api/local-attendance/customers/link', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  );
  window.dispatchEvent(
    new CustomEvent('kyrub-in-person-customer-linked', {
      detail: { orderId: input.orderId },
    })
  );
  return payload.context;
};
