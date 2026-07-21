import { validateKyrubFirestoreId } from './storePaths';

export const getMarketplaceStoresCollectionPath = (): string =>
  'marketplace_stores';

export const getMarketplaceStoreDocumentPath = (storeId: string): string => {
  const validStoreId = validateKyrubFirestoreId(storeId);
  return `marketplace_stores/${validStoreId}`;
};

export const getMarketplaceOffersCollectionPath = (storeId: string): string => {
  const validStoreId = validateKyrubFirestoreId(storeId);
  return `marketplace_stores/${validStoreId}/offers`;
};

export const getMarketplaceOfferDocumentPath = (
  storeId: string,
  offerId: string,
): string => {
  const validStoreId = validateKyrubFirestoreId(storeId);
  const validOfferId = validateKyrubFirestoreId(offerId);
  return `marketplace_stores/${validStoreId}/offers/${validOfferId}`;
};
