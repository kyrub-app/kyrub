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
import { auth, db } from './firebase';
import {adminDirectoryPilotEnabled,countAdminDirectoryUsersPilot} from './adminDirectoryPilot';

import {isAdminRole,isAdminStatus,hasAdminPermission,type AdminRole,type AdminProfile} from './adminControlPlanePermissions';
export * from './adminControlPlanePermissions';

export interface AdminDashboardMetric {
  key: 'users' | 'canonicalStores' | 'legacyTenants';
  label: string;
  value: number | null;
  state: 'available' | 'restricted' | 'unavailable';
}

const cleanString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const timestampToIso = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as Timestamp).toDate().toISOString();
  }
  return '';
};

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
  pathname: string,
  search = typeof globalThis.location !== 'undefined'
    ? globalThis.location.search
    : ''
): boolean => {
  const normalizedHost = hostname.trim().toLowerCase();
  const normalizedPath = pathname.trim().toLowerCase();
  const previewAdminRequested =
    normalizedHost.endsWith('.vercel.app') &&
    new URLSearchParams(search).get('kyrub_admin_preview') === '1';

  return (
    normalizedHost === 'admin.kyrub.com' ||
    normalizedHost === 'admin.localhost' ||
    ((normalizedHost === 'localhost' || normalizedHost === '127.0.0.1') &&
      (normalizedPath === '/admin' || normalizedPath.startsWith('/admin/'))) ||
    previewAdminRequested
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

const recordStrictAdminAudit = async (
  user: Pick<User, 'uid'>,
  profile: AdminProfile,
  action: 'admin.session.accessed' | 'admin.directory.user.searched',
  targetType: 'control_plane' | 'user',
  targetId: string
): Promise<void> => {
  if (
    profile.status !== 'active' ||
    profile.uid !== user.uid ||
    !isAdminRole(profile.role) ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(targetId)
  ) {
    throw new Error('Acesso administrativo inválido para auditoria.');
  }

  const auditId = createStrictAuditId();
  await setDoc(
    doc(db, 'kyrub_admin', 'control_plane', 'audit_logs', auditId),
    {
      id: auditId,
      action,
      actorId: user.uid,
      actorRole: profile.role,
      targetType,
      targetId,
      source: 'client',
      createdAt: serverTimestamp(),
    }
  );
};

export const recordAdminSessionAccess = async (
  user: Pick<User, 'uid'>,
  profile: AdminProfile
): Promise<void> =>
  recordStrictAdminAudit(
    user,
    profile,
    'admin.session.accessed',
    'control_plane',
    'admin_portal'
  );

export const recordAdminDirectorySearch = async (
  user: Pick<User, 'uid'>,
  profile: AdminProfile,
  targetUserId: string
): Promise<void> =>
  recordStrictAdminAudit(
    user,
    profile,
    'admin.directory.user.searched',
    'user',
    targetUserId.trim()
  );

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

  const pilot=adminDirectoryPilotEnabled();
  const session=auth.currentUser;
  const userCount=async():Promise<number|null>=>{
    if(!canReadUsers)return null;
    if(!pilot)return countCollection('users');
    if(!session||session.uid!==profile.uid)return null;
    try{return await countAdminDirectoryUsersPilot(session);}catch{return null;}
  };
  const [users, canonicalStores, legacyTenants] = await Promise.all([
    userCount(),
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
    metric('users', 'Usuários cadastrados', pilot&&auth.currentUser!==session?null:users, canReadUsers),
    metric('canonicalStores', 'Lojas canônicas', canonicalStores, canReadStores),
    metric('legacyTenants', 'Tenants legados', legacyTenants, canReadStores),
  ];
};
