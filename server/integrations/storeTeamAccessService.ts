import { createHash } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import { getPrimaryUserStoreDocumentPath } from '../../src/utils/storePaths.js';

export type StoreTeamRole =
  | 'owner'
  | 'manager'
  | 'cashier'
  | 'seller'
  | 'production';

export type StoreTeamMembershipStatus =
  | 'invited'
  | 'active'
  | 'suspended'
  | 'removed';

export interface StoreTeamMemberProjection {
  memberRef: string;
  displayName: string;
  maskedEmail: string;
  role: StoreTeamRole;
  status: StoreTeamMembershipStatus;
  isCanonicalOwner: boolean;
  createdAt: string;
  invitedAt: string;
  acceptedAt: string;
  suspendedAt: string;
  removedAt: string;
  updatedAt: string;
  authoritySource: 'canonical_store_membership';
}

export interface StoreTeamAccessSnapshot {
  tenantId: string;
  canonicalStoreId: string;
  readAuthority: 'store_owner';
  members: StoreTeamMemberProjection[];
  sourceWarnings: string[];
  generatedAt: string;
}

const VALID_ROLES = new Set<StoreTeamRole>([
  'owner',
  'manager',
  'cashier',
  'seller',
  'production',
]);

const VALID_STATUSES = new Set<StoreTeamMembershipStatus>([
  'invited',
  'active',
  'suspended',
  'removed',
]);

const clean = (value: unknown, maximum = 240): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const timestampIso = (value: unknown): string => {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
  }
  if (typeof value === 'object') {
    const candidate = value as {
      toDate?: () => Date;
      seconds?: number;
      _seconds?: number;
    };
    if (typeof candidate.toDate === 'function') {
      try {
        return candidate.toDate().toISOString();
      } catch {
        return '';
      }
    }
    const seconds = Number(candidate.seconds ?? candidate._seconds);
    if (Number.isFinite(seconds)) return new Date(seconds * 1000).toISOString();
  }
  return '';
};

const maskEmail = (value: unknown): string => {
  const email = clean(value, 254).toLowerCase();
  const at = email.indexOf('@');
  if (at <= 0) return '';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!domain) return '';
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${local.length > visible.length ? '***' : ''}@${domain}`;
};

const opaqueMemberRef = (canonicalStoreId: string, userId: string): string =>
  `member_${createHash('sha256')
    .update(`${canonicalStoreId}:${userId}`)
    .digest('hex')
    .slice(0, 32)}`;

const resolveCanonicalStore = async (tenantId: string): Promise<{
  canonicalStoreId: string;
  canonicalOwnerUserId: string;
}> => {
  const [tenantSnapshot, privateStoreSnapshot] = await Promise.all([
    adminDb.doc(`tenants/${tenantId}`).get(),
    adminDb.doc(getPrimaryUserStoreDocumentPath(tenantId)).get(),
  ]);
  const tenant = tenantSnapshot.data() as Record<string, unknown> | undefined;
  const privateStore = privateStoreSnapshot.data() as Record<string, unknown> | undefined;

  if (tenantSnapshot.exists && clean(tenant?.ownerId, 160) && clean(tenant?.ownerId, 160) !== tenantId) {
    throw new Error('STORE_TEAM_ACCESS_FORBIDDEN');
  }
  if (
    privateStoreSnapshot.exists &&
    clean(privateStore?.ownerId, 160) &&
    clean(privateStore?.ownerId, 160) !== tenantId
  ) {
    throw new Error('STORE_TEAM_ACCESS_FORBIDDEN');
  }

  const tenantCanonical = clean(tenant?.canonicalStoreId, 160);
  const privateCanonical = clean(privateStore?.canonicalStoreId, 160);
  if (tenantCanonical && privateCanonical && tenantCanonical !== privateCanonical) {
    throw new Error('STORE_TEAM_ACCESS_CANONICAL_STORE_UNRESOLVED');
  }
  const canonicalStoreId = tenantCanonical || privateCanonical;
  if (!canonicalStoreId || canonicalStoreId === tenantId) {
    throw new Error('STORE_TEAM_ACCESS_CANONICAL_STORE_UNRESOLVED');
  }

  const storeSnapshot = await adminDb.doc(`stores/${canonicalStoreId}`).get();
  const store = storeSnapshot.data() as Record<string, unknown> | undefined;
  if (!storeSnapshot.exists) throw new Error('STORE_TEAM_ACCESS_CANONICAL_STORE_UNRESOLVED');
  const canonicalOwnerUserId = clean(store?.ownerId, 160);
  const legacyTenantId = clean(store?.legacyTenantId, 160);
  if (
    !canonicalOwnerUserId ||
    canonicalOwnerUserId !== tenantId ||
    (legacyTenantId && legacyTenantId !== tenantId)
  ) {
    throw new Error('STORE_TEAM_ACCESS_FORBIDDEN');
  }

  return { canonicalStoreId, canonicalOwnerUserId };
};

export const loadStoreTeamAccess = async (input: {
  tenantId: string;
  requestedByUserId: string;
}): Promise<StoreTeamAccessSnapshot> => {
  const tenantId = clean(input.tenantId, 160);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  if (!tenantId || !requestedByUserId) throw new Error('STORE_TEAM_ACCESS_AUTH_REQUIRED');
  if (tenantId !== requestedByUserId) throw new Error('STORE_TEAM_ACCESS_FORBIDDEN');

  const { canonicalStoreId, canonicalOwnerUserId } = await resolveCanonicalStore(tenantId);
  const membershipSnapshot = await adminDb
    .collection(`stores/${canonicalStoreId}/members`)
    .get();

  const sourceWarnings: string[] = [];
  const validMemberships = membershipSnapshot.docs.flatMap(document => {
    const data = document.data() as Record<string, unknown>;
    const userId = clean(data.userId, 160);
    const storeId = clean(data.storeId, 160);
    const role = clean(data.role, 80) as StoreTeamRole;
    const status = clean(data.status, 80) as StoreTeamMembershipStatus;
    if (
      !userId ||
      userId !== document.id ||
      storeId !== canonicalStoreId ||
      !VALID_ROLES.has(role) ||
      !VALID_STATUSES.has(status)
    ) {
      sourceWarnings.push(`membership_invalid:${document.id}`);
      return [];
    }
    return [{ document, data, userId, role, status }];
  });

  const members = await Promise.all(validMemberships.map(async membership => {
    let displayName = '';
    let maskedEmail = '';
    try {
      const userSnapshot = await adminDb.doc(`users/${membership.userId}`).get();
      const user = userSnapshot.data() as Record<string, unknown> | undefined;
      displayName = clean(user?.name ?? user?.displayName, 160);
      maskedEmail = maskEmail(user?.email);
    } catch {
      sourceWarnings.push(`user_profile_unavailable:${opaqueMemberRef(canonicalStoreId, membership.userId)}`);
    }

    return {
      memberRef: opaqueMemberRef(canonicalStoreId, membership.userId),
      displayName,
      maskedEmail,
      role: membership.role,
      status: membership.status,
      isCanonicalOwner: membership.userId === canonicalOwnerUserId,
      createdAt: timestampIso(membership.data.createdAt),
      invitedAt: timestampIso(membership.data.invitedAt),
      acceptedAt: timestampIso(membership.data.acceptedAt),
      suspendedAt: timestampIso(membership.data.suspendedAt),
      removedAt: timestampIso(membership.data.removedAt),
      updatedAt: timestampIso(membership.data.updatedAt),
      authoritySource: 'canonical_store_membership' as const,
    };
  }));

  const canonicalOwnerMembership = validMemberships.filter(membership =>
    membership.userId === canonicalOwnerUserId &&
    membership.role === 'owner' &&
    membership.status === 'active'
  );
  if (canonicalOwnerMembership.length === 0) sourceWarnings.push('canonical_owner_membership_missing');
  if (canonicalOwnerMembership.length > 1) sourceWarnings.push('canonical_owner_membership_ambiguous');

  members.sort((left, right) => {
    if (left.isCanonicalOwner !== right.isCanonicalOwner) return left.isCanonicalOwner ? -1 : 1;
    if (left.status !== right.status) return left.status.localeCompare(right.status);
    return (left.displayName || left.memberRef).localeCompare(
      right.displayName || right.memberRef,
      'pt-BR'
    );
  });

  return {
    tenantId,
    canonicalStoreId,
    readAuthority: 'store_owner',
    members,
    sourceWarnings: [...new Set(sourceWarnings)],
    generatedAt: new Date().toISOString(),
  };
};
