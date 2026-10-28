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
  if (!profile || !profile.active || profile.storeId !== storeId ||
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
