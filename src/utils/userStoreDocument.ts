import { serverTimestamp } from 'firebase/firestore';
import type { FieldValue, WithFieldValue } from 'firebase/firestore';
import type { UserStoreDocument } from '../types';
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
  >
> & {
  updatedAt: FieldValue;
};

const hasOwn = (object: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(object, key);

const requireDefined = <Value>(value: Value | undefined): Value => {
  if (value === undefined) {
    throw new Error('Invalid store update.');
  }

  return value;
};

export const buildUserStoreCreateData = (
  input: BuildUserStoreCreateInput
): WithFieldValue<UserStoreDocument> => {
  const uid = getPrimaryUserStoreId(input.uid);
  const timestamp = serverTimestamp();
  const hasLat = input.lat !== undefined;
  const hasLng = input.lng !== undefined;

  if (hasLat !== hasLng) {
    throw new Error('Invalid store coordinates.');
  }

  if (
    hasLat &&
    hasLng &&
    (!Number.isFinite(input.lat) || !Number.isFinite(input.lng))
  ) {
    throw new Error('Invalid store coordinates.');
  }

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
    updatedAt: timestamp
  };

  if (hasLat && hasLng) {
    return {
      ...data,
      lat: input.lat,
      lng: input.lng
    };
  }

  return data;
};

export const buildUserStoreUpdateData = (
  input: BuildUserStoreUpdateInput
): UserStoreUpdateData => {
  const data: UserStoreUpdateData = {
    updatedAt: serverTimestamp()
  };
  let hasEditableField = false;

  if (hasOwn(input, 'ownerEmail')) {
    data.ownerEmail = requireDefined(input.ownerEmail);
    hasEditableField = true;
  }
  if (hasOwn(input, 'name')) {
    data.name = requireDefined(input.name);
    hasEditableField = true;
  }
  if (hasOwn(input, 'slug')) {
    data.slug = requireDefined(input.slug);
    hasEditableField = true;
  }
  if (hasOwn(input, 'description')) {
    data.description = requireDefined(input.description);
    hasEditableField = true;
  }
  if (hasOwn(input, 'logo')) {
    data.logo = requireDefined(input.logo);
    hasEditableField = true;
  }
  if (hasOwn(input, 'banner')) {
    data.banner = requireDefined(input.banner);
    hasEditableField = true;
  }
  if (hasOwn(input, 'primaryColor')) {
    data.primaryColor = requireDefined(input.primaryColor);
    hasEditableField = true;
  }
  if (hasOwn(input, 'keywords')) {
    data.keywords = [...requireDefined(input.keywords)];
    hasEditableField = true;
  }
  if (hasOwn(input, 'offerImages')) {
    data.offerImages = [...requireDefined(input.offerImages)];
    hasEditableField = true;
  }
  if (hasOwn(input, 'address')) {
    data.address = requireDefined(input.address);
    hasEditableField = true;
  }
  if (hasOwn(input, 'contact')) {
    data.contact = requireDefined(input.contact);
    hasEditableField = true;
  }
  if (hasOwn(input, 'status')) {
    data.status = requireDefined(input.status);
    hasEditableField = true;
  }

  const hasLat = hasOwn(input, 'lat');
  const hasLng = hasOwn(input, 'lng');

  if (hasLat !== hasLng) {
    throw new Error('Invalid store coordinates.');
  }

  if (hasLat && hasLng) {
    const lat = requireDefined(input.lat);
    const lng = requireDefined(input.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error('Invalid store coordinates.');
    }

    data.lat = lat;
    data.lng = lng;
    hasEditableField = true;
  }

  if (!hasEditableField) {
    throw new Error('Store update requires an editable field.');
  }

  return data;
};
