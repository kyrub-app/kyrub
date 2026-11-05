import type { User } from 'firebase/auth';
import type { OfficialPlanRewards } from '../../shared/officialPlanRewards';

export type OfficialStoreIdentity = {
  schemaVersion: 1;
  kind: 'official_cairobi_store';
  canonicalStoreId: string;
  legacyStoreId: string;
  ownerUserId: string;
  storeName: string;
  designatedAt: string;
  designatedBy: string;
};

export type OfficialStoreSnapshot = {
  identity: OfficialStoreIdentity | null;
};

export type OfficialStoreDesignationResult = {
  identity: OfficialStoreIdentity;
  changed: boolean;
};

const endpoint = (operation: string): string =>
  `/api/plan-control?op=${encodeURIComponent(operation)}`;

const responseError = async (response: Response, fallback: string): Promise<Error> => {
  const body = await response.json().catch(() => null) as
    | { error?: unknown; code?: unknown }
    | null;
  const error = new Error(
    typeof body?.error === 'string' ? body.error : fallback
  ) as Error & { code?: string };
  if (typeof body?.code === 'string') error.code = body.code;
  return error;
};

const authorizedFetch = async (
  user: Pick<User, 'getIdToken'>,
  operation: string,
  init: RequestInit = {}
): Promise<Response> => {
  const token = await user.getIdToken(true);
  return fetch(endpoint(operation), {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
};

export const loadOfficialStoreIdentity = async (
  user: Pick<User, 'getIdToken'>
): Promise<OfficialStoreSnapshot> => {
  const response = await authorizedFetch(user, 'admin.official-store.snapshot');
  if (!response.ok) {
    throw await responseError(
      response,
      'Não foi possível carregar a identidade da Loja Oficial Cairobi.'
    );
  }
  return response.json() as Promise<OfficialStoreSnapshot>;
};

export const designateOfficialStore = async (
  user: Pick<User, 'getIdToken'>,
  storeId: string,
  replaceExisting: boolean
): Promise<OfficialStoreDesignationResult> => {
  const response = await authorizedFetch(user, 'admin.official-store.designate', {
    method: 'POST',
    body: JSON.stringify({ storeId, replaceExisting }),
  });
  if (!response.ok) {
    throw await responseError(
      response,
      'Não foi possível designar a Loja Oficial Cairobi.'
    );
  }
  return response.json() as Promise<OfficialStoreDesignationResult>;
};

export type OfficialPlanProductRow = { id: string; name: string; price: number; publicationStatus: string;
  planId: 'pro' | 'business' | 'free' | null; rewards: OfficialPlanRewards };
export const loadOfficialPlanProducts = async (user: Pick<User, 'getIdToken'>): Promise<{ storeId: string; products: OfficialPlanProductRow[] }> => {
  const response = await authorizedFetch(user, 'admin.official-plan-product.list', { cache: 'no-store' });
  if (!response.ok) throw await responseError(response, 'Não foi possível carregar os produtos oficiais.');
  return response.json();
};
export const configureOfficialPlanProduct = async (user: Pick<User, 'getIdToken'>, productId: string,
  planId: 'pro' | 'business', rewards: OfficialPlanRewards): Promise<void> => {
  const response = await authorizedFetch(user, 'admin.official-plan-product.assign', { method: 'POST', body: JSON.stringify({ productId, planId, rewards }) });
  if (!response.ok) throw await responseError(response, 'Não foi possível configurar o plano oficial.');
};
