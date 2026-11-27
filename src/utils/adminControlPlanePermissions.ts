// Canonical role and presentation permission model, with no Firebase initialization.
export type AdminRole =
  | 'super_admin'
  | 'support'
  | 'operations'
  | 'finance'
  | 'compliance';

export type AdminStatus = 'active' | 'suspended' | 'revoked';

export type AdminPermission =
  | 'read_overview'
  | 'read_users'
  | 'read_stores'
  | 'read_system_health'
  | 'read_finance'
  | 'read_audit'
  | 'manage_admins'
  | 'manage_features'
  | 'manage_compliance';

export interface AdminProfile {
  uid: string;
  email: string;
  displayName: string;
  role: AdminRole;
  status: AdminStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  suspendedAt: string;
  revokedAt: string;
}

const ADMIN_ROLES: readonly AdminRole[] = [
  'super_admin',
  'support',
  'operations',
  'finance',
  'compliance',
];

const ADMIN_STATUSES: readonly AdminStatus[] = [
  'active',
  'suspended',
  'revoked',
];

const ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  super_admin: [
    'read_overview',
    'read_users',
    'read_stores',
    'read_system_health',
    'read_finance',
    'read_audit',
    'manage_admins',
    'manage_features',
    'manage_compliance',
  ],
  support: ['read_overview', 'read_users', 'read_stores'],
  operations: [
    'read_overview',
    'read_users',
    'read_stores',
    'read_system_health',
    'manage_features',
  ],
  finance: ['read_overview', 'read_finance'],
  compliance: [
    'read_overview',
    'read_users',
    'read_stores',
    'read_audit',
    'manage_compliance',
  ],
};

export const isAdminRole = (value: unknown): value is AdminRole =>
  typeof value === 'string' && ADMIN_ROLES.includes(value as AdminRole);

export const isAdminStatus = (value: unknown): value is AdminStatus =>
  typeof value === 'string' && ADMIN_STATUSES.includes(value as AdminStatus);

export const getAdminPermissions = (
  role: AdminRole
): readonly AdminPermission[] => ROLE_PERMISSIONS[role];

export const hasAdminPermission = (
  profile: Pick<AdminProfile, 'role' | 'status'>,
  permission: AdminPermission
): boolean =>
  profile.status === 'active' &&
  getAdminPermissions(profile.role).includes(permission);

