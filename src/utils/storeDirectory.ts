import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Timestamp,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { Store } from '../types';
import { db } from './firebase';
import {
  canAssignStoreRole,
  getStoreDocumentPath,
  getStoreMemberDocumentPath,
  getStoreMembersCollectionPath,
  isStoreMemberStatus,
  isStoreRole,
  type StoreMemberStatus,
  type StoreRole,
} from './storeSecurity';

export type CanonicalStoreMigrationStatus =
  | 'registry_only'
  | 'dual_write'
  | 'canonical';

export interface CanonicalStoreRecord {
  id: string;
  ownerId: string;
  name: string;
  publicationStatus: 'paused' | 'published';
  plan: 'free' | 'business';
  legacyTenantId: string;
  migrationStatus: CanonicalStoreMigrationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StoreMemberDirectoryRecord {
  storeId: string;
  storeName: string;
  userId: string;
  displayName: string;
  email: string;
  photoUrl: string;
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

export interface StoreAccessRecord {
  store: CanonicalStoreRecord;
  role: StoreRole;
  status: 'active' | 'invited' | 'suspended';
  member: StoreMemberDirectoryRecord | null;
}

export interface KyrubDirectoryUser {
  uid: string;
  name: string;
  email: string;
  photoUrl: string;
}

export interface CreateCanonicalStoreInput {
  name: string;
  legacyTenantId?: string;
  plan?: 'free' | 'business';
  publicationStatus?: 'paused' | 'published';
}

export interface InviteStoreMemberInput {
  store: CanonicalStoreRecord;
  actorRole: StoreRole;
  targetUser: KyrubDirectoryUser;
  role: StoreRole;
}

const cleanString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const timestampToIso = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toDate' in value) {
    const timestamp = value as Timestamp;
    return timestamp.toDate().toISOString();
  }
  return '';
};

const normalizeStoreName = (value: string): string => value.trim();

const slugPart = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36) || 'loja';

export const createIndependentStoreId = (
  ownerId: string,
  name: string,
  now: number = Date.now(),
  nonce: string = Math.random().toString(36).slice(2, 8)
): string => {
  const id = `store-${slugPart(name)}-${now.toString(36)}-${slugPart(nonce)}`;
  if (id === ownerId.trim()) throw new Error('O ID da loja deve ser independente do usuário.');
  return id;
};

export const parseCanonicalStore = (value: unknown): CanonicalStoreRecord | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const id = cleanString(candidate.id);
  const ownerId = cleanString(candidate.ownerId);
  const name = cleanString(candidate.name);
  const publicationStatus = candidate.publicationStatus;
  const plan = candidate.plan;
  const migrationStatus = candidate.migrationStatus;

  if (
    !id ||
    !ownerId ||
    !name ||
    (publicationStatus !== 'paused' && publicationStatus !== 'published') ||
    (plan !== 'free' && plan !== 'business') ||
    (migrationStatus !== 'registry_only' &&
      migrationStatus !== 'dual_write' &&
      migrationStatus !== 'canonical')
  ) {
    return null;
  }

  return {
    id,
    ownerId,
    name,
    publicationStatus,
    plan,
    legacyTenantId: cleanString(candidate.legacyTenantId),
    migrationStatus,
    createdAt: timestampToIso(candidate.createdAt),
    updatedAt: timestampToIso(candidate.updatedAt),
  };
};

export const parseStoreMemberDirectoryRecord = (
  value: unknown
): StoreMemberDirectoryRecord | null => {
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
    storeName: cleanString(candidate.storeName),
    userId,
    displayName: cleanString(candidate.displayName),
    email: cleanString(candidate.email),
    photoUrl: cleanString(candidate.photoUrl),
    role: candidate.role,
    status: candidate.status,
    invitedBy: cleanString(candidate.invitedBy),
    invitedAt: timestampToIso(candidate.invitedAt),
    acceptedAt: timestampToIso(candidate.acceptedAt),
    suspendedAt: timestampToIso(candidate.suspendedAt),
    removedAt: timestampToIso(candidate.removedAt),
    createdAt: timestampToIso(candidate.createdAt),
    updatedAt: timestampToIso(candidate.updatedAt),
  };
};

const parseDirectoryUserSnapshot = (
  snapshot: QueryDocumentSnapshot<DocumentData>
): KyrubDirectoryUser | null => {
  const data = snapshot.data() as Record<string, unknown>;
  const uid = cleanString(data.uid) || snapshot.id;
  const email = cleanString(data.email);
  const name = cleanString(data.name);
  if (!uid || !email) return null;
  return {
    uid,
    name: name || email,
    email,
    photoUrl: cleanString(data.photoUrl),
  };
};

export const createCanonicalStore = async (
  user: Pick<User, 'uid'>,
  input: CreateCanonicalStoreInput,
  now: number = Date.now()
): Promise<CanonicalStoreRecord> => {
  const name = normalizeStoreName(input.name);
  if (!name) throw new Error('Informe o nome da loja.');

  const storeId = createIndependentStoreId(user.uid, name, now);
  const record: CanonicalStoreRecord = {
    id: storeId,
    ownerId: user.uid,
    name,
    publicationStatus: input.publicationStatus ?? 'paused',
    plan: input.plan ?? 'free',
    legacyTenantId: cleanString(input.legacyTenantId),
    migrationStatus: 'registry_only',
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  };

  await setDoc(doc(db, getStoreDocumentPath(storeId)), {
    ...record,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return record;
};

export const createCanonicalStoreFromLegacy = async (
  user: Pick<User, 'uid'>,
  legacyStore: Store,
  legacyTenantId: string
): Promise<CanonicalStoreRecord> =>
  createCanonicalStore(user, {
    name: legacyStore.name.trim() || 'Minha loja',
    legacyTenantId,
    plan: legacyStore.plan,
    publicationStatus: 'paused',
  });

export const searchExistingKyrubUsers = async (
  term: string
): Promise<KyrubDirectoryUser[]> => {
  const normalized = term.trim();
  if (!normalized) return [];

  const usersReference = collection(db, 'users');
  const searches = normalized.includes('@')
    ? [query(usersReference, where('email', '==', normalized.toLowerCase()), limit(10))]
    : [query(usersReference, where('name', '==', normalized), limit(10))];

  const snapshots = await Promise.all(searches.map(searchQuery => getDocs(searchQuery)));
  const users = snapshots.flatMap(snapshot =>
    snapshot.docs.flatMap(userSnapshot => {
      const parsed = parseDirectoryUserSnapshot(userSnapshot);
      return parsed ? [parsed] : [];
    })
  );

  return Array.from(new Map(users.map(user => [user.uid, user])).values());
};

export const inviteExistingKyrubUser = async (
  actor: Pick<User, 'uid'>,
  input: InviteStoreMemberInput
): Promise<void> => {
  if (actor.uid === input.targetUser.uid) {
    throw new Error('O proprietário não precisa convidar a própria conta.');
  }
  if (!canAssignStoreRole(input.actorRole, input.role)) {
    throw new Error('Seu papel não pode atribuir esta função.');
  }

  const userSnapshot = await getDoc(doc(db, 'users', input.targetUser.uid));
  if (!userSnapshot.exists()) {
    throw new Error('Este usuário ainda não possui uma conta Kyrub.');
  }

  await setDoc(
    doc(db, getStoreMemberDocumentPath(input.store.id, input.targetUser.uid)),
    {
      storeId: input.store.id,
      storeName: input.store.name,
      userId: input.targetUser.uid,
      displayName: input.targetUser.name,
      email: input.targetUser.email,
      photoUrl: input.targetUser.photoUrl,
      role: input.role,
      status: 'invited',
      invitedBy: actor.uid,
      invitedAt: serverTimestamp(),
      acceptedAt: '',
      suspendedAt: '',
      removedAt: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }
  );
};

export const updateOwnStoreInvitation = async (
  user: Pick<User, 'uid'>,
  storeId: string,
  decision: 'accept' | 'decline'
): Promise<void> => {
  await updateDoc(doc(db, getStoreMemberDocumentPath(storeId, user.uid)), {
    status: decision === 'accept' ? 'active' : 'removed',
    ...(decision === 'accept'
      ? { acceptedAt: serverTimestamp() }
      : { removedAt: serverTimestamp() }),
    updatedAt: serverTimestamp(),
  });
};

export const updateStoreMemberStatus = async (
  storeId: string,
  userId: string,
  status: 'active' | 'suspended' | 'removed'
): Promise<void> => {
  await updateDoc(doc(db, getStoreMemberDocumentPath(storeId, userId)), {
    status,
    ...(status === 'active' ? { acceptedAt: serverTimestamp() } : {}),
    ...(status === 'suspended' ? { suspendedAt: serverTimestamp() } : {}),
    ...(status === 'removed' ? { removedAt: serverTimestamp() } : {}),
    updatedAt: serverTimestamp(),
  });
};

export const updateStoreMemberRole = async (
  storeId: string,
  userId: string,
  role: StoreRole
): Promise<void> => {
  await updateDoc(doc(db, getStoreMemberDocumentPath(storeId, userId)), {
    role,
    updatedAt: serverTimestamp(),
  });
};

export const subscribeToStoreMembers = (
  storeId: string,
  onMembers: (members: StoreMemberDirectoryRecord[]) => void,
  onError?: (error: Error) => void
): (() => void) => {
  if (!storeId) {
    onMembers([]);
    return () => undefined;
  }

  return onSnapshot(
    collection(db, getStoreMembersCollectionPath(storeId)),
    snapshot => {
      const members = snapshot.docs
        .flatMap(memberSnapshot => {
          const parsed = parseStoreMemberDirectoryRecord(memberSnapshot.data());
          return parsed ? [parsed] : [];
        })
        .sort((left, right) => left.displayName.localeCompare(right.displayName, 'pt-BR'));
      onMembers(members);
    },
    error => {
      onMembers([]);
      onError?.(error);
    }
  );
};

export const subscribeToUserStoreAccess = (
  userId: string,
  onAccess: (access: StoreAccessRecord[]) => void,
  onError?: (error: Error) => void
): (() => void) => {
  if (!userId) {
    onAccess([]);
    return () => undefined;
  }

  let ownedStores = new Map<string, CanonicalStoreRecord>();
  let memberships = new Map<string, StoreMemberDirectoryRecord>();
  let cancelled = false;

  const publish = async (): Promise<void> => {
    const memberEntries = Array.from(memberships.values()).filter(
      member => member.status !== 'removed'
    );
    const missingStoreIds = memberEntries
      .map(member => member.storeId)
      .filter(storeId => !ownedStores.has(storeId));

    const loadedStores = await Promise.all(
      missingStoreIds.map(async storeId => {
        try {
          const snapshot = await getDoc(doc(db, getStoreDocumentPath(storeId)));
          return parseCanonicalStore(snapshot.data());
        } catch {
          const member = memberships.get(storeId);
          return member
            ? {
                id: member.storeId,
                ownerId: '',
                name: member.storeName || 'Loja Kyrub',
                publicationStatus: 'paused' as const,
                plan: 'free' as const,
                legacyTenantId: '',
                migrationStatus: 'registry_only' as const,
                createdAt: member.createdAt,
                updatedAt: member.updatedAt,
              }
            : null;
        }
      })
    );

    if (cancelled) return;
    const storeMap = new Map(ownedStores);
    loadedStores.forEach(store => {
      if (store) storeMap.set(store.id, store);
    });

    const accesses: StoreAccessRecord[] = [];
    ownedStores.forEach(store => {
      accesses.push({ store, role: 'owner', status: 'active', member: null });
    });
    memberEntries.forEach(member => {
      const store = storeMap.get(member.storeId);
      if (!store || ownedStores.has(member.storeId)) return;
      accesses.push({
        store,
        role: member.role,
        status:
          member.status === 'invited'
            ? 'invited'
            : member.status === 'suspended'
              ? 'suspended'
              : 'active',
        member,
      });
    });

    accesses.sort((left, right) => {
      const statusRank = { invited: 0, active: 1, suspended: 2 } as const;
      const statusDifference = statusRank[left.status] - statusRank[right.status];
      return statusDifference || left.store.name.localeCompare(right.store.name, 'pt-BR');
    });
    onAccess(accesses);
  };

  const ownedQuery = query(collection(db, 'stores'), where('ownerId', '==', userId));
  const membershipQuery = query(
    collectionGroup(db, 'members'),
    where('userId', '==', userId)
  );

  const unsubscribeOwned = onSnapshot(
    ownedQuery,
    snapshot => {
      ownedStores = new Map(
        snapshot.docs.flatMap(storeSnapshot => {
          const parsed = parseCanonicalStore(storeSnapshot.data());
          return parsed ? [[parsed.id, parsed] as const] : [];
        })
      );
      void publish();
    },
    error => onError?.(error)
  );

  const unsubscribeMemberships = onSnapshot(
    membershipQuery,
    snapshot => {
      memberships = new Map(
        snapshot.docs.flatMap(memberSnapshot => {
          const parsed = parseStoreMemberDirectoryRecord(memberSnapshot.data());
          return parsed ? [[parsed.storeId, parsed] as const] : [];
        })
      );
      void publish();
    },
    error => onError?.(error)
  );

  return () => {
    cancelled = true;
    unsubscribeOwned();
    unsubscribeMemberships();
  };
};
