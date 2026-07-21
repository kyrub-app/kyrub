import { serverTimestamp } from 'firebase/firestore';
import type { WithFieldValue } from 'firebase/firestore';
import type {
  MarketplaceOfferDocument,
  MarketplaceOfferStatus,
  MarketplacePublicationStatus,
  MarketplaceStoreDocument,
  UserStoreDocument,
} from '../types';
import { validateKyrubFirestoreId } from './storePaths';

export interface BuildMarketplaceStoreCreateInput {
  store: Pick<
    UserStoreDocument,
    | 'id'
    | 'ownerId'
    | 'name'
    | 'slug'
    | 'description'
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
  status: MarketplaceOfferStatus;
}

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

export const buildMarketplaceStoreCreateData = (
  input: BuildMarketplaceStoreCreateInput,
): WithFieldValue<MarketplaceStoreDocument> => {
  const storeId = validateKyrubFirestoreId(input.store.id);
  const ownerId = validateKyrubFirestoreId(input.store.ownerId);

  if (storeId !== ownerId) {
    throw new Error('Marketplace store must use the owner primary store id.');
  }

  validateCoordinates(input.store.lat, input.store.lng);

  const timestamp = serverTimestamp();
  const data: WithFieldValue<MarketplaceStoreDocument> = {
    id: storeId,
    ownerId,
    name: input.store.name,
    slug: input.store.slug,
    description: input.store.description,
    logo: input.store.logo,
    banner: input.store.banner,
    primaryColor: input.store.primaryColor,
    keywords: [...input.store.keywords],
    status: input.store.status,
    publicationStatus: input.publicationStatus,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  if (input.store.lat !== undefined && input.store.lng !== undefined) {
    data.lat = input.store.lat;
    data.lng = input.store.lng;
  }

  if (input.publicationStatus === 'published') {
    data.publishedAt = timestamp;
  }

  return data;
};

export const buildMarketplaceOfferCreateData = (
  input: BuildMarketplaceOfferCreateInput,
): WithFieldValue<MarketplaceOfferDocument> => {
  const offerId = validateKyrubFirestoreId(input.id);
  const storeId = validateKyrubFirestoreId(input.storeId);
  const ownerId = validateKyrubFirestoreId(input.ownerId);

  if (!Number.isFinite(input.price) || input.price < 0) {
    throw new Error('Marketplace offer price must be a non-negative number.');
  }

  if (!Number.isInteger(input.stock) || input.stock < 0) {
    throw new Error('Marketplace offer stock must be a non-negative integer.');
  }

  const timestamp = serverTimestamp();
  const data: WithFieldValue<MarketplaceOfferDocument> = {
    id: offerId,
    storeId,
    ownerId,
    name: input.name,
    description: input.description,
    price: input.price,
    imageUrls: [...input.imageUrls],
    stock: input.stock,
    isService: input.isService,
    category: input.category,
    status: input.status,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  if (input.status === 'published') {
    data.publishedAt = timestamp;
  }

  return data;
};
