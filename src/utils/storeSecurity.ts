export type StoreRole =
  | 'owner'
  | 'manager'
  | 'cashier'
  | 'seller'
  | 'production';

export type StoreMemberStatus =
  | 'invited'
  | 'active'
  | 'suspended'
  | 'removed';

export type StorePermission =
  | 'store.read'
  | 'store.update'
  | 'store.publish'
  | 'members.read'
  | 'members.invite'
  | 'members.suspend'
  | 'members.assign_manager'
  | 'products.read'
  | 'products.write'
  | 'orders.read'
  | 'orders.create'
  | 'orders.transfer'
  | 'orders.cancel'
  | 'orders.request_cancel'
  | 'production.read'
  | 'production.update'
  | 'payments.read'
  | 'payments.read_own'
  | 'payments.create'
  | 'payments.refund'
  | 'cash.read'
  | 'cash.manage'
  | 'reports.read'
  | 'reports.read_own'
  | 'audit.read'
  | 'ownership.transfer';

export type OrderActorRole = StoreRole | 'customer' | 'system';
export type OrderSource = 'customer' | 'staff' | 'transfer';
export type CancellationAuthority = 'direct' | 'request' | 'none';

export interface StoreMember {
  storeId: string;
  userId: string;
  role: StoreRole;
  status: StoreMemberStatus;
  invitedBy: string;
  invitedAt: string;
  acceptedAt: string;
  suspendedAt: string;
  removedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoreAuditEntry {
  id: string;
  storeId: string;
  actorUserId: string;
  actorRole: OrderActorRole;
  action: string;
  entityType: string;
  entityId: string;
  reason: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

const ALL_PERMISSIONS: readonly StorePermission[] = [
  'store.read',
  'store.update',
  'store.publish',
  'members.read',
  'members.invite',
  'members.suspend',
  'members.assign_manager',
  'products.read',
  'products.write',
  'orders.read',
  'orders.create',
  'orders.transfer',
  'orders.cancel',
  'orders.request_cancel',
  'production.read',
  'production.update',
  'payments.read',
  'payments.read_own',
  'payments.create',
  'payments.refund',
  'cash.read',
  'cash.manage',
  'reports.read',
  'reports.read_own',
  'audit.read',
  'ownership.transfer',
];

export const STORE_ROLE_LABELS: Record<StoreRole, string> = {
  owner: 'Proprietário',
  manager: 'Gerente',
  cashier: 'Caixa',
  seller: 'Vendedor',
  production: 'Produção',
};

export const STORE_ROLE_PERMISSIONS: Record<StoreRole, readonly StorePermission[]> = {
  owner: ALL_PERMISSIONS,
  manager: ALL_PERMISSIONS.filter(
    permission => permission !== 'ownership.transfer'
  ),
  cashier: [
    'store.read',
    'members.read',
    'products.read',
    'orders.read',
    'orders.create',
    'orders.transfer',
    'orders.cancel',
    'production.read',
    'payments.read',
    'payments.create',
    'payments.refund',
    'cash.read',
    'cash.manage',
    'reports.read',
  ],
  seller: [
    'store.read',
    'products.read',
    'orders.read',
    'orders.create',
    'orders.transfer',
    'orders.request_cancel',
    'production.read',
    'payments.read_own',
    'payments.create',
    'reports.read_own',
  ],
  production: [
    'store.read',
    'products.read',
    'orders.read',
    'orders.request_cancel',
    'production.read',
    'production.update',
  ],
};

export const STORE_ROLE_DISCOUNT_LIMITS: Record<StoreRole, number | null> = {
  owner: null,
  manager: 20,
  cashier: 10,
  seller: 5,
  production: 0,
};

const cleanString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const isStoreRole = (value: unknown): value is StoreRole =>
  value === 'owner' ||
  value === 'manager' ||
  value === 'cashier' ||
  value === 'seller' ||
  value === 'production';

export const isStoreMemberStatus = (
  value: unknown
): value is StoreMemberStatus =>
  value === 'invited' ||
  value === 'active' ||
  value === 'suspended' ||
  value === 'removed';

export const hasStorePermission = (
  role: StoreRole,
  permission: StorePermission
): boolean => STORE_ROLE_PERMISSIONS[role].includes(permission);

export const canManageStoreRole = (
  actorRole: StoreRole,
  targetRole: StoreRole
): boolean => {
  if (targetRole === 'owner') return false;
  if (actorRole === 'owner') return true;
  if (actorRole !== 'manager') return false;
  return targetRole === 'cashier' || targetRole === 'seller' || targetRole === 'production';
};

export const canAssignStoreRole = (
  actorRole: StoreRole,
  targetRole: StoreRole
): boolean => canManageStoreRole(actorRole, targetRole);

export const canApplyStoreDiscount = (
  role: StoreRole,
  discountPercent: number
): boolean => {
  if (!Number.isFinite(discountPercent) || discountPercent < 0) return false;
  const limit = STORE_ROLE_DISCOUNT_LIMITS[role];
  return limit === null || discountPercent <= limit;
};

export const getCancellationAuthority = (
  role: StoreRole,
  sentToProduction: boolean
): CancellationAuthority => {
  if (role === 'owner' || role === 'manager' || role === 'cashier') {
    return 'direct';
  }
  if (role === 'seller') return sentToProduction ? 'request' : 'direct';
  if (role === 'production') return 'request';
  return 'none';
};

export const parseStoreMember = (value: unknown): StoreMember | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const storeId = cleanString(candidate.storeId);
  const userId = cleanString(candidate.userId);

  if (
    !storeId ||
    !userId ||
    !isStoreRole(candidate.role) ||
    !isStoreMemberStatus(candidate.status)
  ) {
    return null;
  }

  return {
    storeId,
    userId,
    role: candidate.role,
    status: candidate.status,
    invitedBy: cleanString(candidate.invitedBy),
    invitedAt: cleanString(candidate.invitedAt),
    acceptedAt: cleanString(candidate.acceptedAt),
    suspendedAt: cleanString(candidate.suspendedAt),
    removedAt: cleanString(candidate.removedAt),
    createdAt: cleanString(candidate.createdAt),
    updatedAt: cleanString(candidate.updatedAt),
  };
};

export const getStoreDocumentPath = (storeId: string): string =>
  `stores/${storeId.trim()}`;

export const getStoreMembersCollectionPath = (storeId: string): string =>
  `${getStoreDocumentPath(storeId)}/members`;

export const getStoreMemberDocumentPath = (
  storeId: string,
  userId: string
): string => `${getStoreMembersCollectionPath(storeId)}/${userId.trim()}`;

export const getStoreOrdersCollectionPath = (storeId: string): string =>
  `${getStoreDocumentPath(storeId)}/orders`;

export const getStoreOrderDocumentPath = (
  storeId: string,
  orderId: string
): string => `${getStoreOrdersCollectionPath(storeId)}/${orderId.trim()}`;

export const getStorePaymentsCollectionPath = (storeId: string): string =>
  `${getStoreDocumentPath(storeId)}/payments`;

export const getStoreCashSessionsCollectionPath = (storeId: string): string =>
  `${getStoreDocumentPath(storeId)}/cashSessions`;

export const getStoreCashSessionDocumentPath = (
  storeId: string,
  sessionId: string
): string => `${getStoreCashSessionsCollectionPath(storeId)}/${sessionId.trim()}`;

export const getStoreCashMovementsCollectionPath = (
  storeId: string,
  sessionId: string
): string => `${getStoreCashSessionDocumentPath(storeId, sessionId)}/movements`;

export const getStoreAuditLogsCollectionPath = (storeId: string): string =>
  `${getStoreDocumentPath(storeId)}/auditLogs`;
