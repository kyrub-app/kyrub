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

export interface AdminProfileData {
  uid: string;
  email: string;
  displayName: string;
  role: AdminRole;
  status: AdminStatus;
}

export interface AdminPrincipal extends AdminProfileData {
  permissions: readonly AdminPermission[];
}

export interface AuthenticatedIdentity {
  uid: string;
  email: string;
  emailVerified: boolean;
}

export type AdminAuthorizationFailureCode =
  | 'unauthenticated'
  | 'email-unverified'
  | 'admin-record-missing'
  | 'admin-record-invalid'
  | 'admin-suspended'
  | 'admin-revoked'
  | 'permission-denied';

export class AdminAuthorizationError extends Error {
  readonly code: AdminAuthorizationFailureCode;

  constructor(code: AdminAuthorizationFailureCode, message: string) {
    super(message);
    this.name = 'AdminAuthorizationError';
    this.code = code;
  }
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

const cleanString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const isAdminRole = (value: unknown): value is AdminRole =>
  typeof value === 'string' && ADMIN_ROLES.includes(value as AdminRole);

export const isAdminStatus = (value: unknown): value is AdminStatus =>
  typeof value === 'string' && ADMIN_STATUSES.includes(value as AdminStatus);

export const getRolePermissions = (
  role: AdminRole
): readonly AdminPermission[] => ROLE_PERMISSIONS[role];

export const parseAdminProfileData = (
  value: unknown,
  expectedUid: string
): AdminProfileData | null => {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  const uid = cleanString(data.uid);
  if (!uid || uid !== expectedUid) return null;
  if (!isAdminRole(data.role) || !isAdminStatus(data.status)) return null;

  return {
    uid,
    email: cleanString(data.email).toLowerCase(),
    displayName: cleanString(data.displayName),
    role: data.role,
    status: data.status,
  };
};

export const authorizeAdminIdentity = (
  identity: AuthenticatedIdentity | null,
  profileValue: unknown,
  requiredPermission: AdminPermission
): AdminPrincipal => {
  if (!identity?.uid) {
    throw new AdminAuthorizationError(
      'unauthenticated',
      'Autenticação administrativa obrigatória.'
    );
  }
  if (!identity.emailVerified) {
    throw new AdminAuthorizationError(
      'email-unverified',
      'O e-mail da conta administrativa precisa estar verificado.'
    );
  }

  const profile = parseAdminProfileData(profileValue, identity.uid);
  if (!profile) {
    throw new AdminAuthorizationError(
      profileValue ? 'admin-record-invalid' : 'admin-record-missing',
      'Registro administrativo inexistente ou inválido.'
    );
  }
  if (profile.status === 'suspended') {
    throw new AdminAuthorizationError(
      'admin-suspended',
      'Acesso administrativo suspenso.'
    );
  }
  if (profile.status === 'revoked') {
    throw new AdminAuthorizationError(
      'admin-revoked',
      'Acesso administrativo revogado.'
    );
  }

  const permissions = getRolePermissions(profile.role);
  if (!permissions.includes(requiredPermission)) {
    throw new AdminAuthorizationError(
      'permission-denied',
      'O papel administrativo não possui a permissão necessária.'
    );
  }

  return { ...profile, permissions };
};
