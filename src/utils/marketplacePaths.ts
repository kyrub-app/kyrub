import { validateKyrubFirestoreId } from './storePaths';

const buildMarketplaceListingId = (
  prefix: 's' | 'o',
  parts: string[],
): string => {
  const encodedParts = parts.map(part => {
    const validPart = validateKyrubFirestoreId(part);

    return `${validPart.length}_${validPart}`;
  });

  return validateKyrubFirestoreId(
    `${prefix}_${encodedParts.join('_')}`,
  );
};

export const getMarketplaceListingsCollectionPath = (): string =>
  'marketplace_listings';

export const getMarketplaceStoreListingId = (
  storeId: string,
): string =>
  buildMarketplaceListingId('s', [storeId]);

export const getMarketplaceOfferListingId = (
  storeId: string,
  offerId: string,
): string =>
  buildMarketplaceListingId('o', [storeId, offerId]);

export const getMarketplaceListingDocumentPath = (
  listingId: string,
): string => {
  const validListingId = validateKyrubFirestoreId(listingId);

  return `marketplace_listings/${validListingId}`;
};

export const getMarketplaceStoreListingDocumentPath = (
  storeId: string,
): string =>
  getMarketplaceListingDocumentPath(
    getMarketplaceStoreListingId(storeId),
  );

export const getMarketplaceOfferListingDocumentPath = (
  storeId: string,
  offerId: string,
): string =>
  getMarketplaceListingDocumentPath(
    getMarketplaceOfferListingId(storeId, offerId),
  );
