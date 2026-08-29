import { auth } from './firebase';

export interface MarketplaceOfferSegments {
  promotionStoreIds: string[];
  forYouStoreIds: string[];
}

const cleanStoreIds = (values: readonly string[]): string[] =>
  Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));

const responseError = async (response: Response): Promise<Error> => {
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === 'string' && body.error.trim()) {
      return new Error(body.error.trim());
    }
  } catch {
    // Fall through to generic message.
  }
  return new Error('Não foi possível personalizar o marketplace agora.');
};

export const loadMarketplaceOfferSegments = async (
  storeIdsInput: readonly string[]
): Promise<MarketplaceOfferSegments> => {
  const storeIds = cleanStoreIds(storeIdsInput);
  if (storeIds.length === 0) {
    return { promotionStoreIds: [], forYouStoreIds: [] };
  }
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente.');
  const idToken = await user.getIdToken();
  const response = await fetch('/api/marketplace/offer-segments', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ storeIds }),
  });
  if (!response.ok) throw await responseError(response);
  const body = await response.json() as Partial<MarketplaceOfferSegments>;
  return {
    promotionStoreIds: Array.isArray(body.promotionStoreIds)
      ? cleanStoreIds(body.promotionStoreIds)
      : [],
    forYouStoreIds: Array.isArray(body.forYouStoreIds)
      ? cleanStoreIds(body.forYouStoreIds)
      : [],
  };
};