import { adminDb } from '../firebaseAdmin.js';
import {
  SERVICE_LOCATION_MAX_LIST,
  buildServiceLocation,
  buildUpdatedServiceLocation,
  parseServiceLocation,
  serviceLocationPath,
  type ServiceLocation,
  type ServiceLocationKind,
} from '../../shared/serviceLocation.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const collectionPath = (storeId: string): string =>
  `stores/${storeId}/serviceLocations`;

export const listServiceLocations = async (input: {
  storeId: string;
  activeOnly?: boolean;
}): Promise<ServiceLocation[]> => {
  const storeId = clean(input.storeId);
  if (!storeId) throw new Error('SERVICE_LOCATION_STORE_REQUIRED');
  const snapshot = await adminDb
    .collection(collectionPath(storeId))
    .limit(SERVICE_LOCATION_MAX_LIST)
    .get();
  return snapshot.docs
    .map(document => parseServiceLocation(document.data(), storeId, document.id))
    .filter(location => !input.activeOnly || location.active)
    .sort((left, right) =>
      left.label.localeCompare(right.label, 'pt-BR', { sensitivity: 'base' })
    );
};

export const getServiceLocation = async (input: {
  storeId: string;
  locationId: string;
  requireActive?: boolean;
}): Promise<ServiceLocation> => {
  const storeId = clean(input.storeId);
  const locationId = clean(input.locationId);
  if (!storeId) throw new Error('SERVICE_LOCATION_STORE_REQUIRED');
  if (!locationId) throw new Error('SERVICE_LOCATION_ID_REQUIRED');
  const snapshot = await adminDb.doc(serviceLocationPath(storeId, locationId)).get();
  if (!snapshot.exists) throw new Error('SERVICE_LOCATION_NOT_FOUND');
  const location = parseServiceLocation(snapshot.data(), storeId, locationId);
  if (input.requireActive && !location.active) {
    throw new Error('SERVICE_LOCATION_INACTIVE');
  }
  return location;
};

export const createServiceLocation = async (input: {
  storeId: string;
  kind: ServiceLocationKind;
  label: unknown;
  now?: Date;
}): Promise<ServiceLocation> => {
  const storeId = clean(input.storeId);
  if (!storeId) throw new Error('SERVICE_LOCATION_STORE_REQUIRED');
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('SERVICE_LOCATION_TIME_INVALID');
  const reference = adminDb.collection(collectionPath(storeId)).doc();
  const location = buildServiceLocation({
    id: reference.id,
    storeId,
    kind: input.kind,
    label: input.label,
    now: now.toISOString(),
  });
  await reference.set(location);
  return location;
};

export const updateServiceLocation = async (input: {
  storeId: string;
  locationId: string;
  kind?: ServiceLocationKind;
  label?: unknown;
  active?: boolean;
  now?: Date;
}): Promise<ServiceLocation> => {
  const storeId = clean(input.storeId);
  const locationId = clean(input.locationId);
  if (!storeId) throw new Error('SERVICE_LOCATION_STORE_REQUIRED');
  if (!locationId) throw new Error('SERVICE_LOCATION_ID_REQUIRED');
  if (
    input.kind === undefined &&
    input.label === undefined &&
    input.active === undefined
  ) {
    throw new Error('SERVICE_LOCATION_UPDATE_REQUIRED');
  }
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('SERVICE_LOCATION_TIME_INVALID');
  const reference = adminDb.doc(serviceLocationPath(storeId, locationId));
  return adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new Error('SERVICE_LOCATION_NOT_FOUND');
    const current = parseServiceLocation(snapshot.data(), storeId, locationId);
    const next = buildUpdatedServiceLocation(current, {
      kind: input.kind,
      label: input.label,
      active: input.active,
      now: now.toISOString(),
    });
    transaction.set(reference, next);
    return next;
  });
};
