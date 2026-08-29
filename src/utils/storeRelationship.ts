import type { StoreRelationshipSummary } from '../../shared/storeRelationship';
import { auth } from './firebase';

const clean = (value: string): string => value.trim();

const responseError = async (response: Response): Promise<Error> => {
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === 'string' && body.error.trim()) {
      return new Error(body.error.trim());
    }
  } catch {
    // Fall through to the stable message below.
  }
  return new Error('Não foi possível carregar seu relacionamento com a loja.');
};

export const loadStoreRelationshipForCurrentUser = async (
  storeIdInput: string
): Promise<StoreRelationshipSummary> => {
  const storeId = clean(storeIdInput);
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente.');
  if (!storeId) throw new Error('Loja não identificada.');

  const idToken = await user.getIdToken();
  const response = await fetch(
    `/api/store-relationship?storeId=${encodeURIComponent(storeId)}`,
    {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${idToken}`,
      },
      cache: 'no-store',
    }
  );
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<StoreRelationshipSummary>;
};