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

export interface AdminDirectoryAiUsageSummary {
  state: 'available' | 'not_measured' | 'restricted' | 'unavailable';
  partial: boolean;
  calls: number | null;
  totalTokens: number | null;
  promptTokens: number | null;
  outputTokens: number | null;
  thinkingTokens: number | null;
  estimatedCostMicrousd: number | null;
  pricedCalls: number | null;
  unpricedCalls: number | null;
  lastModel: string;
  lastProvider: string;
  lastOperation: string;
  lastRoute: string;
  lastUsedAt: string;
}

export interface AdminDirectoryResult {
  lookup: AdminDirectoryLookup;
  user: AdminDirectoryUserRecord | null;
  stores: AdminDirectoryStoreLink[];
  legacyTenants: AdminDirectoryLegacyTenant[];
  aiUsage: AdminDirectoryAiUsageSummary;
}

interface MembershipRecord {
  storeId: string;
  storeName: string;
  userId: string;
  role: string;
  status: string;
}

const AI_USAGE_SUMMARY_LIMIT = 500;

const cleanString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finiteNonNegativeInteger = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : 0;

const timestampToIso = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as Timestamp).toDate().toISOString();
  }
  return '';
};

const emptyAiUsageSummary = (
  state: AdminDirectoryAiUsageSummary['state']
): AdminDirectoryAiUsageSummary => ({
  state,
  partial: false,
  calls: null,
  totalTokens: null,
  promptTokens: null,
  outputTokens: null,
  thinkingTokens: null,
  estimatedCostMicrousd: null,
  pricedCalls: null,
  unpricedCalls: null,
  lastModel: '',
  lastProvider: '',
  lastOperation: '',
  lastRoute: '',
  lastUsedAt: '',
});

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

const loadAiUsageSummary = async (
  userId: string
): Promise<AdminDirectoryAiUsageSummary> => {
  try {
    const snapshots = await getDocs(
      query(
        collection(db, 'kyrub_usage_events'),
        where('uid', '==', userId),
        limit(AI_USAGE_SUMMARY_LIMIT + 1)
      )
    );

    if (snapshots.empty) return emptyAiUsageSummary('not_measured');

    const partial = snapshots.size > AI_USAGE_SUMMARY_LIMIT;
    const documents = snapshots.docs.slice(0, AI_USAGE_SUMMARY_LIMIT);
    let promptTokens = 0;
    let outputTokens = 0;
    let thinkingTokens = 0;
    let totalTokens = 0;
    let estimatedCostMicrousd = 0;
    let pricedCalls = 0;
    let unpricedCalls = 0;
    let lastModel = '';
    let lastProvider = '';
    let lastOperation = '';
    let lastRoute = '';
    let lastUsedAt = '';

    documents.forEach(snapshot => {
      const value = snapshot.data();
      promptTokens += finiteNonNegativeInteger(value.promptTokenCount);
      outputTokens += finiteNonNegativeInteger(value.candidatesTokenCount);
      thinkingTokens += finiteNonNegativeInteger(value.thoughtsTokenCount);
      totalTokens += finiteNonNegativeInteger(value.totalTokenCount);
      pricedCalls += finiteNonNegativeInteger(value.pricedCallCount);
      unpricedCalls += finiteNonNegativeInteger(value.unpricedCallCount);
      if (
        typeof value.estimatedCostMicrousd === 'number' &&
        Number.isFinite(value.estimatedCostMicrousd) &&
        value.estimatedCostMicrousd >= 0
      ) {
        estimatedCostMicrousd += Math.trunc(value.estimatedCostMicrousd);
      }

      const createdAt = timestampToIso(value.createdAt);
      if (createdAt && createdAt >= lastUsedAt) {
        lastUsedAt = createdAt;
        lastModel = cleanString(value.model);
        lastProvider = cleanString(value.provider);
        lastOperation = cleanString(value.operation);
        lastRoute = cleanString(value.route);
      }
    });

    return {
      state: 'available',
      partial,
      calls: documents.length,
      totalTokens,
      promptTokens,
      outputTokens,
      thinkingTokens,
      estimatedCostMicrousd,
      pricedCalls,
      unpricedCalls,
      lastModel,
      lastProvider,
      lastOperation,
      lastRoute,
      lastUsedAt,
    };
  } catch (error) {
    console.warn('Administrative AI usage summary unavailable.', error);
    return emptyAiUsageSummary('unavailable');
  }
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
    return {
      lookup,
      user: null,
      stores: [],
      legacyTenants: [],
      aiUsage: emptyAiUsageSummary(
        hasAdminPermission(profile, 'read_finance') ? 'not_measured' : 'restricted'
      ),
    };
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

  const aiUsage = hasAdminPermission(profile, 'read_finance')
    ? await loadAiUsageSummary(user.uid)
    : emptyAiUsageSummary('restricted');

  void recordAdminDirectorySearch(authenticatedUser, profile, user.uid).catch(
    error => console.warn('Administrative directory audit unavailable.', error)
  );

  return { lookup, user, stores, legacyTenants, aiUsage };
};
