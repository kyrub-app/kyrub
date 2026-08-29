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
  logo: string;
  banner: string;
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
  logo?: string;
  banner?: string;
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
    | 'logo'
    | 'banner'
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
  if (hasRadius && (!hasLat || !hasLng)) throw new Error('Store geofence requires coordinates.');
  if (hasLat && hasLng) {
    validateStoreCoordinates(input.lat!, input.lng!);
    if (!hasRadius) throw new Error('Store coordinates require geofence radius.');
    validateStoreGeofenceRadius(input.geofenceRadiusMeters!);
  }
};

export const buildUserStoreCreateData = (
  input: BuildUserStoreCreateInput
): WithFieldValue<UserStoreDocument> => {
  const uid = getPrimaryUserStoreId(input.uid);
  const timestamp = serverTimestamp();
  validateLocationInput(input);

  const data: WithFieldValue<UserStoreDocument> = {
    id: uid,
    ownerId: uid,
    ownerEmail: input.ownerEmail,
    name: input.name,
    slug: input.slug,
    description: input.description,
    logo: input.logo,
    banner: input.banner,
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
      geofenceRadiusMeters: input.geofenceRadiusMeters,
    };
  }

  return data;
};

export const buildUserStoreUpdateData = (
  input: BuildUserStoreUpdateInput
): UserStoreUpdateData => {
  const data: UserStoreUpdateData = { updatedAt: serverTimestamp() };
  let hasEditableField = false;

  for (const key of [
    'ownerEmail',
    'name',
    'slug',
    'description',
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
    data.lat = location.lat;
    data.lng = location.lng;
    data.geofenceRadiusMeters = location.geofenceRadiusMeters;
    hasEditableField = true;
  }

  if (!hasEditableField) throw new Error('Store update requires an editable field.');
  return data;
};
