import type { User } from 'firebase/auth';
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  hasAdminPermission,
  recordAdminDirectorySearch,
  type AdminProfile,
} from './adminControlPlane';

export type AdminDirectoryLookupKind = 'email' | 'uid';

export interface AdminDirectoryLookup {
  kind: AdminDirectoryLookupKind;
  value: string;
}

export interface AdminDirectoryUserRecord {
  uid: string;
  name: string;
  email: string;
  photoUrl: string;
  isProfileVisible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminDirectoryStoreLink {
  storeId: string;
  storeName: string;
  relationship: 'owner' | 'member';
  role: string;
  membershipStatus: string;
  plan: string;
  publicationStatus: string;
  migrationStatus: string;
  legacyTenantId: string;
}

export interface AdminDirectoryLegacyTenant {
  tenantId: string;
  name: string;
  ownerId: string;
  plan: string;
  status: string;
}

export interface AdminDirectoryResult {
  lookup: AdminDirectoryLookup;
  user: AdminDirectoryUserRecord | null;
  stores: AdminDirectoryStoreLink[];
  legacyTenants: AdminDirectoryLegacyTenant[];
}

interface MembershipRecord {
  storeId: string;
  storeName: string;
  userId: string;
  role: string;
  status: string;
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

export const parseAdminDirectoryLookup = (
  rawValue: string
): AdminDirectoryLookup | null => {
  const value = rawValue.trim();
  if (!value) return null;

  if (value.includes('@')) {
    const email = value.toLowerCase();
    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return null;
    }
    return { kind: 'email', value: email };
  }

  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) return null;
  return { kind: 'uid', value };
};

export const parseAdminDirectoryUser = (
  value: DocumentData | undefined,
  expectedUid = ''
): AdminDirectoryUserRecord | null => {
  if (!value) return null;
  const uid = cleanString(value.uid);
  if (!uid || (expectedUid && uid !== expectedUid)) return null;

  return {
    uid,
    name: cleanString(value.name),
    email: cleanString(value.email).toLowerCase(),
    photoUrl: cleanString(value.photoUrl),
    isProfileVisible: value.isProfileVisible === true,
    createdAt: timestampToIso(value.createdAt),
    updatedAt: timestampToIso(value.updatedAt),
  };
};

const parseMembership = (
  snapshot: QueryDocumentSnapshot<DocumentData>
): MembershipRecord | null => {
  const value = snapshot.data();
  const storeId = cleanString(value.storeId) || snapshot.ref.parent.parent?.id || '';
  const userId = cleanString(value.userId);
  if (!storeId || !userId) return null;

  return {
    storeId,
    storeName: cleanString(value.storeName),
    userId,
    role: cleanString(value.role),
    status: cleanString(value.status),
  };
};

export const parseAdminDirectoryStore = (
  value: DocumentData | undefined,
  expectedStoreId: string,
  relationship: AdminDirectoryStoreLink['relationship'],
  role = '',
  membershipStatus = ''
): AdminDirectoryStoreLink | null => {
  if (!value) return null;
  const storeId = cleanString(value.id) || expectedStoreId.trim();
  if (!storeId || storeId !== expectedStoreId.trim()) return null;

  return {
    storeId,
    storeName: cleanString(value.name),
    relationship,
    role: relationship === 'owner' ? 'owner' : role,
    membershipStatus: relationship === 'owner' ? 'active' : membershipStatus,
    plan: cleanString(value.plan),
    publicationStatus: cleanString(value.publicationStatus),
    migrationStatus: cleanString(value.migrationStatus),
    legacyTenantId: cleanString(value.legacyTenantId),
  };
};

export const parseAdminDirectoryLegacyTenant = (
  value: DocumentData | undefined,
  tenantId: string
): AdminDirectoryLegacyTenant | null => {
  if (!value || !tenantId.trim()) return null;

  return {
    tenantId: tenantId.trim(),
    name: cleanString(value.name) || cleanString(value.businessName),
    ownerId: cleanString(value.ownerId),
    plan: cleanString(value.plan),
    status: cleanString(value.status),
  };
};

const findUser = async (
  lookup: AdminDirectoryLookup
): Promise<AdminDirectoryUserRecord | null> => {
  if (lookup.kind === 'uid') {
    const snapshot = await getDoc(doc(db, 'users', lookup.value));
    return parseAdminDirectoryUser(snapshot.data(), lookup.value);
  }

  const snapshots = await getDocs(
    query(
      collection(db, 'users'),
      where('email', '==', lookup.value),
      limit(2)
    )
  );

  if (snapshots.empty) return null;
  if (snapshots.size > 1) {
    throw new Error('Mais de uma conta foi encontrada para este e-mail.');
  }

  const snapshot = snapshots.docs[0];
  return parseAdminDirectoryUser(snapshot.data(), snapshot.id);
};

const loadOwnedCanonicalStores = async (
  userId: string
): Promise<AdminDirectoryStoreLink[]> => {
  const snapshots = await getDocs(
    query(
      collection(db, 'stores'),
      where('ownerId', '==', userId),
      limit(50)
    )
  );

  return snapshots.docs
    .map(snapshot =>
      parseAdminDirectoryStore(snapshot.data(), snapshot.id, 'owner')
    )
    .filter((store): store is AdminDirectoryStoreLink => Boolean(store));
};

const loadMembershipStoreLinks = async (
  userId: string
): Promise<AdminDirectoryStoreLink[]> => {
  const membershipSnapshots = await getDocs(
    query(
      collectionGroup(db, 'members'),
      where('userId', '==', userId),
      limit(100)
    )
  );

  const memberships = membershipSnapshots.docs
    .map(parseMembership)
    .filter((membership): membership is MembershipRecord =>
      Boolean(membership && membership.userId === userId)
    );

  return Promise.all(
    memberships.map(async membership => {
      try {
        const storeSnapshot = await getDoc(doc(db, 'stores', membership.storeId));
        const parsed = parseAdminDirectoryStore(
          storeSnapshot.data(),
          membership.storeId,
          'member',
          membership.role,
          membership.status
        );
        if (parsed) return parsed;
      } catch {
        // The membership itself remains useful if the store document is unavailable.
      }

      return {
        storeId: membership.storeId,
        storeName: membership.storeName,
        relationship: 'member' as const,
        role: membership.role,
        membershipStatus: membership.status,
        plan: '',
        publicationStatus: '',
        migrationStatus: '',
        legacyTenantId: '',
      };
    })
  );
};

const loadLegacyTenants = async (
  userId: string
): Promise<AdminDirectoryLegacyTenant[]> => {
  const snapshots = await getDocs(
    query(
      collection(db, 'tenants'),
      where('ownerId', '==', userId),
      limit(50)
    )
  );

  return snapshots.docs
    .map(snapshot =>
      parseAdminDirectoryLegacyTenant(snapshot.data(), snapshot.id)
    )
    .filter((tenant): tenant is AdminDirectoryLegacyTenant => Boolean(tenant));
};

export const mergeAdminDirectoryStoreLinks = (
  owned: AdminDirectoryStoreLink[],
  memberships: AdminDirectoryStoreLink[]
): AdminDirectoryStoreLink[] => {
  const links = new Map<string, AdminDirectoryStoreLink>();
  owned.forEach(store => links.set(store.storeId, store));
  memberships.forEach(store => {
    if (!links.has(store.storeId)) links.set(store.storeId, store);
  });
  return [...links.values()].sort((left, right) =>
    (left.storeName || left.storeId).localeCompare(
      right.storeName || right.storeId,
      'pt-BR'
    )
  );
};

export const lookupAdminDirectory = async (
  authenticatedUser: Pick<User, 'uid'>,
  profile: AdminProfile,
  rawLookup: string
): Promise<AdminDirectoryResult> => {
  if (!hasAdminPermission(profile, 'read_users')) {
    throw new Error('Este papel não possui acesso ao diretório de usuários.');
  }
  if (profile.uid !== authenticatedUser.uid) {
    throw new Error('A identidade administrativa não corresponde à sessão atual.');
  }

  const lookup = parseAdminDirectoryLookup(rawLookup);
  if (!lookup) {
    throw new Error('Informe o e-mail completo ou um UID válido.');
  }

  const user = await findUser(lookup);
  if (!user) {
    return { lookup, user: null, stores: [], legacyTenants: [] };
  }

  let stores: AdminDirectoryStoreLink[] = [];
  let legacyTenants: AdminDirectoryLegacyTenant[] = [];

  if (hasAdminPermission(profile, 'read_stores')) {
    const [owned, memberships, tenants] = await Promise.all([
      loadOwnedCanonicalStores(user.uid),
      loadMembershipStoreLinks(user.uid),
      loadLegacyTenants(user.uid),
    ]);
    stores = mergeAdminDirectoryStoreLinks(owned, memberships);
    legacyTenants = tenants;
  }

  void recordAdminDirectorySearch(authenticatedUser, profile, user.uid).catch(
    error => console.warn('Administrative directory audit unavailable.', error)
  );

  return { lookup, user, stores, legacyTenants };
};
