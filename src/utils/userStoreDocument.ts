import { serverTimestamp } from 'firebase/firestore';
import type { FieldValue, WithFieldValue } from 'firebase/firestore';
import type { UserStoreDocument } from '../types';
import {
  validateStoreCoordinates,
  validateStoreGeofenceRadius,
} from './storeLocation';
import { getPrimaryUserStoreId } from './storePaths';

export interface BuildUserStoreCreateInput {
  uid: string;
  ownerEmail: string;
  name: string;
  slug: string;
  description: string;
  policies?: string;
  logo: string;
  banner: string;
  bannerImages?: string[];
  galleryImages?: string[];
  primaryColor: string;
  keywords: string[];
  offerImages: string[];
  address: string;
  contact: string;
  status: 'open' | 'delayed' | 'closed';
  lat?: number;
  lng?: number;
  geofenceRadiusMeters?: number;
}

export interface BuildUserStoreUpdateInput {
  ownerEmail?: string;
  name?: string;
  slug?: string;
  description?: string;
  policies?: string;
  logo?: string;
  banner?: string;
  bannerImages?: string[];
  galleryImages?: string[];
  primaryColor?: string;
  keywords?: string[];
  offerImages?: string[];
  address?: string;
  contact?: string;
  status?: 'open' | 'delayed' | 'closed';
  lat?: number;
  lng?: number;
  geofenceRadiusMeters?: number;
}

export type UserStoreUpdateData = Partial<
  Pick<
    UserStoreDocument,
    | 'ownerEmail'
    | 'name'
    | 'slug'
    | 'description'
    | 'policies'
    | 'logo'
    | 'banner'
    | 'bannerImages'
    | 'galleryImages'
    | 'primaryColor'
    | 'keywords'
    | 'offerImages'
    | 'address'
    | 'contact'
    | 'status'
    | 'lat'
    | 'lng'
    | 'geofenceRadiusMeters'
  >
> & {
  updatedAt: FieldValue;
};

const hasOwn = (object: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(object, key);

const requireDefined = <Value>(value: Value | undefined): Value => {
  if (value === undefined) throw new Error('Invalid store update.');
  return value;
};

const validateLocationInput = (input: {
  lat?: number;
  lng?: number;
  geofenceRadiusMeters?: number;
}): void => {
  const hasLat = input.lat !== undefined;
  const hasLng = input.lng !== undefined;
  const hasRadius = input.geofenceRadiusMeters !== undefined;
  if (hasLat !== hasLng) throw new Error('Invalid store coordinates.');
  if (hasRadius && (!hasLat || !hasLng)) {
    throw new Error('Store geofence requires coordinates.');
  }
  if (hasLat && hasLng) validateStoreCoordinates(input.lat!, input.lng!);
  if (hasRadius) validateStoreGeofenceRadius(input.geofenceRadiusMeters!);
};

export const buildUserStoreCreateData = (
  input: BuildUserStoreCreateInput
): WithFieldValue<UserStoreDocument> => {
  const uid = getPrimaryUserStoreId(input.uid);
  const timestamp = serverTimestamp();
  validateLocationInput(input);
  if ((input.policies ?? '').length > 2000) throw new Error('Store policies exceed 2000 characters.');

  const data: WithFieldValue<UserStoreDocument> = {
    id: uid,
    ownerId: uid,
    ownerEmail: input.ownerEmail,
    name: input.name,
    slug: input.slug,
    description: input.description,
    policies: input.policies ?? '',
    logo: input.logo,
    banner: input.banner,
    bannerImages: [...(input.bannerImages ?? (input.banner ? [input.banner] : []))],
    galleryImages: [...(input.galleryImages ?? [])],
    primaryColor: input.primaryColor,
    plan: 'free',
    keywords: [...input.keywords],
    offerImages: [...input.offerImages],
    address: input.address,
    contact: input.contact,
    status: input.status,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  if (input.lat !== undefined && input.lng !== undefined) {
    return {
      ...data,
      lat: input.lat,
      lng: input.lng,
      ...(input.geofenceRadiusMeters !== undefined
        ? { geofenceRadiusMeters: input.geofenceRadiusMeters }
        : {}),
    };
  }

  return data;
};

export const buildUserStoreUpdateData = (
  input: BuildUserStoreUpdateInput
): UserStoreUpdateData => {
  if ((input.policies ?? '').length > 2000) throw new Error('Store policies exceed 2000 characters.');
  const data: UserStoreUpdateData = { updatedAt: serverTimestamp() };
  let hasEditableField = false;

  for (const key of [
    'ownerEmail',
    'name',
    'slug',
    'description',
    'policies',
    'logo',
    'banner',
    'primaryColor',
    'address',
    'contact',
    'status',
  ] as const) {
    if (hasOwn(input, key)) {
      (data as Record<string, unknown>)[key] = requireDefined(input[key]);
      hasEditableField = true;
    }
  }

  if (hasOwn(input, 'keywords')) {
    data.keywords = [...requireDefined(input.keywords)];
    hasEditableField = true;
  }
  for (const key of ['bannerImages', 'galleryImages'] as const) {
    if (hasOwn(input, key)) {
      data[key] = [...requireDefined(input[key])];
      hasEditableField = true;
    }
  }
  if (hasOwn(input, 'offerImages')) {
    data.offerImages = [...requireDefined(input.offerImages)];
    hasEditableField = true;
  }

  const hasLat = hasOwn(input, 'lat');
  const hasLng = hasOwn(input, 'lng');
  const hasRadius = hasOwn(input, 'geofenceRadiusMeters');
  if (hasLat || hasLng || hasRadius) {
    const location = {
      lat: hasLat ? requireDefined(input.lat) : undefined,
      lng: hasLng ? requireDefined(input.lng) : undefined,
      geofenceRadiusMeters: hasRadius
        ? requireDefined(input.geofenceRadiusMeters)
        : undefined,
    };
    validateLocationInput(location);
    if (location.lat !== undefined && location.lng !== undefined) {
      data.lat = location.lat;
      data.lng = location.lng;
    }
    if (location.geofenceRadiusMeters !== undefined) {
      data.geofenceRadiusMeters = location.geofenceRadiusMeters;
    }
    hasEditableField = true;
  }

  if (!hasEditableField) throw new Error('Store update requires an editable field.');
  return data;
};
