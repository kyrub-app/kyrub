import {
  GeoPoint,
  deleteField,
  serverTimestamp,
} from 'firebase/firestore';
import type {
  FieldValue,
  WithFieldValue,
} from 'firebase/firestore';
import type {
  MarketplaceOfferListingDocument,
  MarketplacePublicationStatus,
  MarketplaceStoreListingDocument,
  UserStoreDocument,
} from '../types';
import {
  getMarketplaceOfferListingId,
  getMarketplaceStoreListingId,
} from './marketplacePaths';
import { validateKyrubFirestoreId } from './storePaths';

export interface BuildMarketplaceStoreCreateInput {
  store: Pick<
    UserStoreDocument,
    | 'id'
    | 'ownerId'
    | 'name'
    | 'slug'
    | 'description'
    | 'address'
    | 'logo'
    | 'banner'
    | 'primaryColor'
    | 'keywords'
    | 'status'
    | 'lat'
    | 'lng'
  >;
  publicationStatus: MarketplacePublicationStatus;
}

export interface BuildMarketplaceOfferCreateInput {
  id: string;
  storeId: string;
  ownerId: string;
  name: string;
  description: string;
  price: number;
  imageUrls: string[];
  stock: number;
  isService: boolean;
  category: string;
  publicationStatus: MarketplacePublicationStatus;
}

export type MarketplaceStoreUpdateData = Partial<
  Pick<
    MarketplaceStoreListingDocument,
    | 'name'
    | 'slug'
    | 'description'
    | 'address'
    | 'logo'
    | 'banner'
    | 'primaryColor'
    | 'keywords'
    | 'status'
    | 'publicationStatus'
  >
> & {
  geoPosition: GeoPoint | FieldValue;
  updatedAt: FieldValue;
  publishedAt?: FieldValue;
};

const validateCoordinates = (
  lat: number | undefined,
  lng: number | undefined,
): void => {
  const hasLat = lat !== undefined;
  const hasLng = lng !== undefined;

  if (hasLat !== hasLng) {
    throw new Error('Invalid marketplace store coordinates.');
  }

  if (!hasLat || !hasLng) return;

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    throw new Error('Invalid marketplace store coordinates.');
  }
};

const buildGeoPosition = (
  lat: number | undefined,
  lng: number | undefined,
): GeoPoint | undefined => {
  if (lat === undefined || lng === undefined) {
    return undefined;
  }

  return new GeoPoint(lat, lng);
};

const validateMarketplaceStore = (
  store: BuildMarketplaceStoreCreateInput['store'],
): {
  listingId: string;
  storeId: string;
  ownerId: string;
} => {
  const storeId = validateKyrubFirestoreId(store.id);
  const ownerId = validateKyrubFirestoreId(store.ownerId);

  if (storeId !== ownerId) {
    throw new Error(
      'Marketplace store must use the owner primary store id.',
    );
  }

  validateCoordinates(store.lat, store.lng);

  return {
    listingId: getMarketplaceStoreListingId(storeId),
    storeId,
    ownerId,
  };
};

export const buildMarketplaceStoreCreateData = (
  input: BuildMarketplaceStoreCreateInput,
): WithFieldValue<MarketplaceStoreListingDocument> => {
  const {
    listingId,
    storeId,
    ownerId,
  } = validateMarketplaceStore(input.store);

  const timestamp = serverTimestamp();
  const geoPosition = buildGeoPosition(
    input.store.lat,
    input.store.lng,
  );

  const data: WithFieldValue<MarketplaceStoreListingDocument> = {
    listingId,
    listingType: 'store',
    ownerId,
    storeId,
    name: input.store.name,
    slug: input.store.slug,
    description: input.store.description,
    address: input.store.address,
    logo: input.store.logo,
    banner: input.store.banner,
    primaryColor: input.store.primaryColor,
    keywords: [...input.store.keywords],
    status: input.store.status,
    publicationStatus: input.publicationStatus,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  if (geoPosition) {
    data.geoPosition = geoPosition;
  }

  if (input.publicationStatus === 'published') {
    data.publishedAt = timestamp;
  }

  return data;
};

export const buildMarketplaceStoreUpdateData = (
  input: BuildMarketplaceStoreCreateInput,
): MarketplaceStoreUpdateData => {
  validateMarketplaceStore(input.store);

  const timestamp = serverTimestamp();
  const geoPosition = buildGeoPosition(
    input.store.lat,
    input.store.lng,
  );

  const data: MarketplaceStoreUpdateData = {
    name: input.store.name,
    slug: input.store.slug,
    description: input.store.description,
    address: input.store.address,
    logo: input.store.logo,
    banner: input.store.banner,
    primaryColor: input.store.primaryColor,
    keywords: [...input.store.keywords],
    status: input.store.status,
    publicationStatus: input.publicationStatus,
    geoPosition: geoPosition ?? deleteField(),
    updatedAt: timestamp,
  };

  if (input.publicationStatus === 'published') {
    data.publishedAt = timestamp;
  }

  return data;
};

export const buildMarketplaceOfferCreateData = (
  input: BuildMarketplaceOfferCreateInput,
): WithFieldValue<MarketplaceOfferListingDocument> => {
  const offerId = validateKyrubFirestoreId(input.id);
  const storeId = validateKyrubFirestoreId(input.storeId);
  const ownerId = validateKyrubFirestoreId(input.ownerId);

  if (storeId !== ownerId) {
    throw new Error(
      'Marketplace offer must belong to the owner primary store.',
    );
  }

  if (!Number.isFinite(input.price) || input.price < 0) {
    throw new Error(
      'Marketplace offer price must be a non-negative number.',
    );
  }

  if (!Number.isInteger(input.stock) || input.stock < 0) {
    throw new Error(
      'Marketplace offer stock must be a non-negative integer.',
    );
  }

  const listingId = getMarketplaceOfferListingId(
    storeId,
    offerId,
  );
  const timestamp = serverTimestamp();

  const data: WithFieldValue<MarketplaceOfferListingDocument> = {
    listingId,
    listingType: 'offer',
    offerId,
    storeId,
    ownerId,
    name: input.name,
    description: input.description,
    price: input.price,
    imageUrls: [...input.imageUrls],
    stock: input.stock,
    isService: input.isService,
    category: input.category,
    publicationStatus: input.publicationStatus,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  if (input.publicationStatus === 'published') {
    data.publishedAt = timestamp;
  }

  return data;
};
