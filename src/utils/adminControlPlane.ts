import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  getCountFromServer,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type DocumentData,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';

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

export interface AdminDashboardMetric {
  key: 'users' | 'canonicalStores' | 'legacyTenants';
  label: string;
  value: number | null;
  state: 'available' | 'restricted' | 'unavailable';
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

const timestampToIso = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as Timestamp).toDate().toISOString();
  }
  return '';
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

export const parseAdminProfile = (
  value: DocumentData | undefined,
  expectedUid = ''
): AdminProfile | null => {
  if (!value) return null;
  const uid = cleanString(value.uid);
  if (!uid || (expectedUid && uid !== expectedUid)) return null;
  if (!isAdminRole(value.role) || !isAdminStatus(value.status)) return null;

  return {
    uid,
    email: cleanString(value.email),
    displayName: cleanString(value.displayName),
    role: value.role,
    status: value.status,
    createdBy: cleanString(value.createdBy),
    createdAt: timestampToIso(value.createdAt),
    updatedAt: timestampToIso(value.updatedAt),
    suspendedAt: timestampToIso(value.suspendedAt),
    revokedAt: timestampToIso(value.revokedAt),
  };
};

export const getAdminProfileDocumentPath = (uid: string): string =>
  `kyrub_admin/control_plane/admins/${uid.trim()}`;

export const getAdminAuditDocumentPath = (auditId: string): string =>
  `kyrub_admin/control_plane/audit_logs/${auditId.trim()}`;

export const isAdminControlPlaneLocation = (
  hostname: string,
  pathname: string
): boolean => {
  const normalizedHost = hostname.trim().toLowerCase();
  const normalizedPath = pathname.trim().toLowerCase();
  return (
    normalizedHost === 'admin.kyrub.com' ||
    normalizedHost === 'admin.localhost' ||
    ((normalizedHost === 'localhost' || normalizedHost === '127.0.0.1') &&
      (normalizedPath === '/admin' || normalizedPath.startsWith('/admin/')))
  );
};

export const subscribeToAdminProfile = (
  user: Pick<User, 'uid'>,
  onProfile: (profile: AdminProfile | null) => void,
  onError?: (error: Error) => void
): Unsubscribe =>
  onSnapshot(
    doc(db, 'kyrub_admin', 'control_plane', 'admins', user.uid),
    snapshot => onProfile(parseAdminProfile(snapshot.data(), user.uid)),
    error => {
      onProfile(null);
      onError?.(error);
    }
  );

const createStrictAuditId = (): string => {
  const random = globalThis.crypto?.randomUUID?.().replaceAll('-', '_');
  return random && /^[a-zA-Z0-9_-]{1,128}$/.test(random)
    ? random
    : `audit_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
};

export const recordAdminSessionAccess = async (
  user: Pick<User, 'uid'>,
  profile: AdminProfile
): Promise<void> => {
  if (
    profile.status !== 'active' ||
    profile.uid !== user.uid ||
    !isAdminRole(profile.role)
  ) {
    throw new Error('Acesso administrativo inválido para auditoria.');
  }

  const auditId = createStrictAuditId();
  await setDoc(
    doc(db, 'kyrub_admin', 'control_plane', 'audit_logs', auditId),
    {
      id: auditId,
      action: 'admin.session.accessed',
      actorId: user.uid,
      actorRole: profile.role,
      targetType: 'control_plane',
      targetId: 'admin_portal',
      source: 'client',
      createdAt: serverTimestamp(),
    }
  );
};

const countCollection = async (path: string): Promise<number | null> => {
  try {
    const result = await getCountFromServer(collection(db, path));
    return result.data().count;
  } catch {
    return null;
  }
};

export const loadAdminDashboardMetrics = async (
  profile: AdminProfile
): Promise<AdminDashboardMetric[]> => {
  const canReadUsers = hasAdminPermission(profile, 'read_users');
  const canReadStores = hasAdminPermission(profile, 'read_stores');

  const [users, canonicalStores, legacyTenants] = await Promise.all([
    canReadUsers ? countCollection('users') : Promise.resolve(null),
    canReadStores ? countCollection('stores') : Promise.resolve(null),
    canReadStores ? countCollection('tenants') : Promise.resolve(null),
  ]);

  const metric = (
    key: AdminDashboardMetric['key'],
    label: string,
    value: number | null,
    allowed: boolean
  ): AdminDashboardMetric => ({
    key,
    label,
    value,
    state: !allowed ? 'restricted' : value === null ? 'unavailable' : 'available',
  });

  return [
    metric('users', 'Usuários cadastrados', users, canReadUsers),
    metric('canonicalStores', 'Lojas canônicas', canonicalStores, canReadStores),
    metric('legacyTenants', 'Tenants legados', legacyTenants, canReadStores),
  ];
};
