import { STORE_ROLE_PERMISSIONS, type StorePermission, type StoreRole } from './storeSecurity';

/** Named access profiles belong to one canonical store and restrict a technical role. */
export interface StoreAccessProfile {
  id: string;
  storeId: string;
  name: string;
  baseRole: StoreRole;
  permissions: readonly StorePermission[];
  active: boolean;
}

export interface StoreAccessAssignment {
  profileId: string;
  revokedPermissions?: readonly StorePermission[];
}

/** Fail closed when a requested profile cannot be resolved or is inconsistent. */
export function resolveStoreAccessPermissions(
  role: StoreRole,
  storeId: string,
  assignment?: StoreAccessAssignment | null,
  profile?: StoreAccessProfile | null,
): readonly StorePermission[] {
  const baseline = STORE_ROLE_PERMISSIONS[role];
  if (role === 'owner' || !assignment) return baseline;
  if (!isValidStoreAccessProfile(profile) || !profile.active || profile.storeId !== storeId ||
      profile.id !== assignment.profileId || profile.baseRole !== role) return [];
  const selected = new Set(profile.permissions);
  for (const permission of assignment.revokedPermissions ?? []) selected.delete(permission);
  return baseline.filter(permission => selected.has(permission));
}

export function hasStoreAccessPermission(
  role: StoreRole,
  storeId: string,
  permission: StorePermission,
  assignment?: StoreAccessAssignment | null,
  profile?: StoreAccessProfile | null,
): boolean {
  return resolveStoreAccessPermissions(role, storeId, assignment, profile).includes(permission);
}

/** Canonical profile storage is store-scoped; never use a global role catalog. */
export const getStoreAccessProfilesCollectionPath = (storeId: string): string =>
  `stores/${storeId.trim()}/accessProfiles`;

export const getStoreAccessProfileDocumentPath = (storeId: string, profileId: string): string =>
  `${getStoreAccessProfilesCollectionPath(storeId)}/${profileId.trim()}`;

/** Reject untrusted profile payloads before using them for authorization. */
export function isValidStoreAccessProfile(value: unknown): value is StoreAccessProfile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Record<string, unknown>;
  if (typeof profile.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(profile.id) ||
      typeof profile.storeId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(profile.storeId) ||
      typeof profile.name !== 'string' || !profile.name.trim() || profile.name.length > 80 ||
      profile.active !== true && profile.active !== false ||
      typeof profile.baseRole !== 'string' || !(profile.baseRole in STORE_ROLE_PERMISSIONS) ||
      !Array.isArray(profile.permissions)) return false;
  const baseline = STORE_ROLE_PERMISSIONS[profile.baseRole as StoreRole];
  return profile.permissions.every(permission => typeof permission === 'string' && baseline.includes(permission as StorePermission)) &&
    new Set(profile.permissions).size === profile.permissions.length;
}
