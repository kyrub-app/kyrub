import type { User } from 'firebase/auth';
import { doc as liteDoc, getDoc as getLiteDoc, collection as liteCollection, query as liteQuery, where as liteWhere, getDocs as getLiteDocs, documentId as liteDocumentId, orderBy as liteOrderBy, limit as liteLimit, startAfter as liteStartAfter } from 'firebase/firestore/lite';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QuerySnapshot,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  deleteObject,
  getDownloadURL,
  getMetadata,
  ref,
  uploadBytes,
} from 'firebase/storage';
import { auth, db, liteDb, storage } from './firebase';
import { optimizeCommunityWallImage } from './communityWallImageOptimization';
import type { WallUploadAttempt } from './communityWallUploadRetry';

export type CommunityVisibility = 'public' | 'moderated' | 'private';
export type CommunityMembershipStatus = 'active' | 'pending';
export type CommunityMemberRole = 'owner' | 'moderator' | 'member';

export interface CloudCommunity {
  id: string;
  ownerId: string;
  ownerName: string;
  ownerAvatar: string;
  name: string;
  description: string;
  category: string;
  location: string;
  visibility: CommunityVisibility;
  rules: string;
  coverImage: string;
  coverPath: string;
  memberCount: number;
  lastMembershipChangeId: string;
  createdAt: string;
  updatedAt: string;
  activityAt: string;
}

export interface CloudCommunityMembership {
  id: string;
  communityId: string;
  userId: string;
  userName: string;
  userAvatar: string;
  role: CommunityMemberRole;
  status: CommunityMembershipStatus;
  joinedAt: string;
  updatedAt: string;
}

export interface CloudCommunityPost {
  id: string;
  communityId: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  content: string;
  mediaUrls: string[];
  /** Missing in older posts means comments are allowed. */
  allowComments?: boolean;
  pinnedCommentId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommunityCreateInput {
  name: string;
  description: string;
  category: string;
  location: string;
  visibility: CommunityVisibility;
  rules: string;
}

export interface CommunityUpdateInput {
  communityId: string;
  name?: string;
  description?: string;
  category?: string;
  location?: string;
  rules: string;
  coverImage?: string;
  coverPath?: string;
}

export const OPEN_COMMUNITY_CLOUD_CREATE_EVENT =
  'kyrub-open-community-cloud-create';

const LOCAL_COMMUNITIES_KEY = 'kyrub_preview_communities_v1';
const LOCAL_POSTS_KEY = 'kyrub_preview_community_posts_v1';

const readString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const readStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean)
    : [];

const readNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const timestampToIso = (value: unknown, fallback = ''): string => {
  if (value && typeof value === 'object' && 'toDate' in value) {
    try {
      return (value as Timestamp).toDate().toISOString();
    } catch {
      return fallback;
    }
  }
  return fallback;
};

const currentIdentity = (user = auth.currentUser) => {
  if (!user) throw new Error('Entre no Kyrub para continuar.');
  return {
    user,
    name:
      user.displayName?.trim() ||
      user.email?.split('@')[0]?.trim() ||
      'Usuário Kyrub',
    avatar: user.photoURL?.trim() || '',
  };
};

const parseVisibility = (value: unknown): CommunityVisibility =>
  value === 'private'
    ? 'private'
    : value === 'moderated'
      ? 'moderated'
      : 'public';

const parseMembershipStatus = (
  value: unknown
): CommunityMembershipStatus => (value === 'pending' ? 'pending' : 'active');

const parseMemberRole = (value: unknown): CommunityMemberRole =>
  value === 'owner'
    ? 'owner'
    : value === 'moderator'
      ? 'moderator'
      : 'member';

const mapCommunity = (
  id: string,
  data: Record<string, unknown>
): CloudCommunity | null => {
  const ownerId = readString(data.ownerId);
  const name = readString(data.name);
  if (!ownerId || !name) return null;
  const createdAt =
    readString(data.createdAtIso) ||
    timestampToIso(data.createdAt, new Date().toISOString());
  const updatedAt =
    readString(data.updatedAtIso) || timestampToIso(data.updatedAt, createdAt);
  const activityAt =
    readString(data.activityAtIso) || timestampToIso(data.activityAt, updatedAt);

  return {
    id,
    ownerId,
    ownerName: readString(data.ownerName) || 'Usuário Kyrub',
    ownerAvatar: readString(data.ownerAvatar),
    name,
    description: readString(data.description),
    category: readString(data.category) || 'Outros interesses',
    location: readString(data.location),
    visibility: parseVisibility(data.visibility),
    rules: readString(data.rules),
    coverImage: readString(data.coverImage),
    coverPath: readString(data.coverPath),
    memberCount: Math.max(1, Math.floor(readNumber(data.memberCount, 1))),
    lastMembershipChangeId: readString(data.lastMembershipChangeId),
    createdAt,
    updatedAt,
    activityAt,
  };
};

const mapMembership = (
  id: string,
  data: Record<string, unknown>
): CloudCommunityMembership | null => {
  const communityId = readString(data.communityId);
  const userId = readString(data.userId);
  if (!communityId || !userId) return null;
  const joinedAt =
    readString(data.joinedAtIso) ||
    timestampToIso(data.joinedAt, new Date().toISOString());
  return {
    id,
    communityId,
    userId,
    userName: readString(data.userName) || 'Usuário Kyrub',
    userAvatar: readString(data.userAvatar),
    role: parseMemberRole(data.role),
    status: parseMembershipStatus(data.status),
    joinedAt,
    updatedAt:
      readString(data.updatedAtIso) ||
      timestampToIso(data.updatedAt, joinedAt),
  };
};

const mapPost = (
  id: string,
  data: Record<string, unknown>
): CloudCommunityPost | null => {
  const communityId = readString(data.communityId);
  const authorId = readString(data.authorId);
  if (!communityId || !authorId) return null;
  const createdAt =
    readString(data.createdAtIso) ||
    timestampToIso(data.createdAt, new Date().toISOString());
  return {
    id,
    communityId,
    authorId,
    authorName: readString(data.authorName) || 'Usuário Kyrub',
    authorAvatar: readString(data.authorAvatar),
    content: readString(data.content),
    mediaUrls: readStringList(data.mediaUrls),
    allowComments: data.allowComments !== false,
    pinnedCommentId: readString(data.pinnedCommentId),
    createdAt,
    updatedAt:
      readString(data.updatedAtIso) || timestampToIso(data.updatedAt, createdAt),
  };
};

const snapshotItems = <T>(
  snapshot: QuerySnapshot<DocumentData>,
  mapper: (id: string, data: Record<string, unknown>) => T | null
): T[] =>
  snapshot.docs.flatMap(item => {
    const mapped = mapper(item.id, item.data() as Record<string, unknown>);
    return mapped ? [mapped] : [];
  });

const byActivity = <T extends { activityAt?: string; createdAt: string }>(
  items: T[]
): T[] =>
  [...items].sort(
    (left, right) =>
      Date.parse(right.activityAt || right.createdAt) -
      Date.parse(left.activityAt || left.createdAt)
  );

export const communityMembershipId = (
  communityId: string,
  userId: string
): string => `${communityId}__${userId}`;

export const subscribeDiscoverableCommunities = (
  onChange: (communities: CloudCommunity[]) => void,
  onError?: (error: Error) => void
): Unsubscribe =>
  onSnapshot(
    query(
      collection(db, 'communities'),
      where('visibility', 'in', ['public', 'moderated']),
      limit(24)
    ),
    snapshot => onChange(byActivity(snapshotItems(snapshot, mapCommunity))),
    error => onError?.(error)
  );

export const subscribeOwnedCommunities = (
  userId: string,
  onChange: (communities: CloudCommunity[]) => void,
  onError?: (error: Error) => void
): Unsubscribe =>
  onSnapshot(
    query(collection(db, 'communities'), where('ownerId', '==', userId)),
    snapshot => onChange(byActivity(snapshotItems(snapshot, mapCommunity))),
    error => onError?.(error)
  );

export const subscribeUserMemberships = (
  userId: string,
  onChange: (memberships: CloudCommunityMembership[]) => void,
  onError?: (error: Error) => void
): Unsubscribe =>
  onSnapshot(
    query(collection(db, 'community_members'), where('userId', '==', userId)),
    snapshot => onChange(snapshotItems(snapshot, mapMembership)),
    error => onError?.(error)
  );

export const subscribeCommunityMemberships = (
  communityId: string,
  onChange: (memberships: CloudCommunityMembership[]) => void,
  onError?: (error: Error) => void,
  context?: { viewerId?: string; ownerId?: string; isOwner?: boolean },
): Unsubscribe => {
  const sortMembers = (memberships: CloudCommunityMembership[]) =>
    [...memberships].sort((left, right) => {
      if (left.role === 'owner') return -1;
      if (right.role === 'owner') return 1;
      if (left.status !== right.status) return left.status === 'pending' ? -1 : 1;
      return left.userName.localeCompare(right.userName, 'pt-BR');
    });

  if (context?.isOwner) {
    // The owner may list all active participants and pending requests.
    return onSnapshot(
      query(collection(db, 'community_members'), where('communityId', '==', communityId)),
      snapshot => onChange(sortMembers(snapshotItems(snapshot, mapMembership))),
      error => onError?.(error),
    );
  }

  // Public readers must not query all memberships: that would also include
  // pending requests, which the Firestore rules correctly keep private.
  // Listen only to the creator and the current viewer; no composite index or
  // list-level access to private applications is required.
  const ids = Array.from(new Set(
    [context?.ownerId, context?.viewerId]
      .filter((uid): uid is string => Boolean(uid))
      .map(uid => communityMembershipId(communityId, uid)),
  ));
  const visible = new Map<string, CloudCommunityMembership>();
  const stops = ids.map(id => onSnapshot(
    doc(db, 'community_members', id),
    snapshot => {
      const member = snapshot.exists()
        ? mapMembership(snapshot.id, snapshot.data() as Record<string, unknown>)
        : null;
      if (member && member.communityId === communityId) visible.set(id, member);
      else visible.delete(id);
      onChange(sortMembers([...visible.values()]));
    },
    error => onError?.(error),
  ));
  if (ids.length === 0) onChange([]);
  return () => stops.forEach(stop => stop());
};

export const subscribeCommunityPosts = (
  communityId: string,
  onChange: (posts: CloudCommunityPost[]) => void,
  onError?: (error: Error) => void
): Unsubscribe =>
  onSnapshot(
    query(
      collection(db, 'community_posts'),
      where('communityId', '==', communityId)
    ),
    snapshot =>
      onChange(
        snapshotItems(snapshot, mapPost).sort(
          (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)
        )
      ),
    error => onError?.(error)
  );

export const getCommunity = async (
  communityId: string
): Promise<CloudCommunity | null> => {
  const snapshot = await getDoc(doc(db, 'communities', communityId));
  return snapshot.exists()
    ? mapCommunity(snapshot.id, snapshot.data() as Record<string, unknown>)
    : null;
};

/**
 * Read-through repair for public directory IDs discovered by the Praça API.
 *
 * The full Firestore SDK can return a server-labelled missing snapshot for an
 * existing public community when its persistent multi-tab listener state is
 * out of sync. Firestore Lite uses the same authenticated FirebaseApp and
 * security rules, but issues a direct REST read without a persistent cache.
 *
 * Only public/moderated documents may be reconciled here; private community
 * reads, membership queries and all writes keep their existing guarded paths.
 * No extra server endpoint or second directory model is introduced.
 */
export const getPublicCommunityFromServer = async (
  communityId: string
): Promise<CloudCommunity | null> => {
  const snapshot = await getLiteDoc(liteDoc(liteDb, 'communities', communityId));
  if (!snapshot.exists()) return null;
  const data = snapshot.data() as Record<string, unknown>;
  if (data.visibility !== 'public' && data.visibility !== 'moderated') return null;
  return mapCommunity(snapshot.id, data);
};

/**
 * Paginated authenticated discovery uses the same uncached Lite path that
 * recovered Manual KYRUB. Both visitor API and Lite order by document ID;
 * only public/moderated communities are eligible for this list.
 */
export const listPublicCommunityPageLite = async (
  cursor: string | null,
): Promise<{ items: CloudCommunity[]; nextCursor: string | null }> => {
  const { user } = currentIdentity();
  if (cursor && !/^[A-Za-z0-9_-]{1,128}$/.test(cursor)) {
    throw Error('INVALID_COMMUNITY_CURSOR');
  }
  const constraints = [
    liteWhere('visibility', 'in', ['public', 'moderated']),
    liteOrderBy(liteDocumentId()),
    ...(cursor ? [liteStartAfter(cursor)] : []),
    liteLimit(21),
  ];
  const snapshot = await getLiteDocs(liteQuery(
    liteCollection(liteDb, 'communities'), ...constraints,
  ));
  if (auth.currentUser?.uid !== user.uid) throw Error('COMMUNITY_SESSION_CHANGED');
  const docs = snapshot.docs.slice(0, 20);
  const items = docs.flatMap(item => {
    const data = item.data() as Record<string, unknown>;
    if (data.visibility !== 'public' && data.visibility !== 'moderated') return [];
    const mapped = mapCommunity(item.id, data);
    return mapped ? [mapped] : [];
  });
  return {
    items,
    nextCursor: snapshot.docs.length > 20 ? docs[docs.length - 1].id : null,
  };
};

/**
 * Server-authoritative recovery for the current creator's entire directory,
 * including private communities. Unlike the public Praça API, this is not
 * capped at 30 records and never reads another person's private communities.
 * Firestore rules still enforce ownerId == request.auth.uid.
 */
export const getOwnedCommunitiesFromServer = async (
  user: User
): Promise<CloudCommunity[]> => {
  if (auth.currentUser?.uid !== user.uid) {
    throw new Error('COMMUNITY_SESSION_CHANGED');
  }
  const result = await getLiteDocs(liteQuery(
    liteCollection(liteDb, 'communities'),
    liteWhere('ownerId', '==', user.uid)
  ));
  if (auth.currentUser?.uid !== user.uid) {
    throw new Error('COMMUNITY_SESSION_CHANGED');
  }
  return byActivity(result.docs.flatMap(item => {
    const mapped = mapCommunity(item.id, item.data() as Record<string, unknown>);
    return mapped && mapped.ownerId === user.uid ? [mapped] : [];
  }));
};

const createCommunityWithId = async (
  communityId: string,
  input: CommunityCreateInput,
  user: User
): Promise<CloudCommunity> => {
  const { name: ownerName, avatar: ownerAvatar } = currentIdentity(user);
  const name = input.name.trim().slice(0, 80);
  const description = input.description.trim().slice(0, 500);
  const rules =
    input.rules.trim().slice(0, 1200) ||
    'Respeite os participantes e mantenha o conteúdo relacionado ao propósito da comunidade.';
  if (!name) throw new Error('Informe o nome da comunidade.');
  if (!description) throw new Error('Informe a descrição da comunidade.');

  const nowIso = new Date().toISOString();
  const membershipId = communityMembershipId(communityId, user.uid);
  const batch = writeBatch(db);
  batch.set(doc(db, 'communities', communityId), {
    communityId,
    ownerId: user.uid,
    ownerName,
    ownerAvatar,
    name,
    description,
    category: input.category.trim().slice(0, 80) || 'Outros interesses',
    location: input.location.trim().slice(0, 120),
    visibility: input.visibility,
    rules,
    coverImage: '',
    coverPath: '',
    memberCount: 1,
    lastMembershipChangeId: membershipId,
    createdAtIso: nowIso,
    createdAt: serverTimestamp(),
    updatedAtIso: nowIso,
    updatedAt: serverTimestamp(),
    activityAtIso: nowIso,
    activityAt: serverTimestamp(),
  });
  batch.set(doc(db, 'community_members', membershipId), {
    membershipId,
    communityId,
    userId: user.uid,
    userName: ownerName,
    userAvatar: ownerAvatar,
    role: 'owner',
    status: 'active',
    joinedAtIso: nowIso,
    joinedAt: serverTimestamp(),
    updatedAtIso: nowIso,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();

  return {
    id: communityId,
    ownerId: user.uid,
    ownerName,
    ownerAvatar,
    name,
    description,
    category: input.category.trim().slice(0, 80) || 'Outros interesses',
    location: input.location.trim().slice(0, 120),
    visibility: input.visibility,
    rules,
    coverImage: '',
    coverPath: '',
    memberCount: 1,
    lastMembershipChangeId: membershipId,
    createdAt: nowIso,
    updatedAt: nowIso,
    activityAt: nowIso,
  };
};

export const createCommunity = async (
  input: CommunityCreateInput
): Promise<CloudCommunity> => {
  const { user } = currentIdentity();
  const reference = doc(collection(db, 'communities'));
  return createCommunityWithId(reference.id, input, user);
};

export const updateCommunity = async (
  input: CommunityUpdateInput
): Promise<void> => {
  currentIdentity();
  const trimmed = {
    name: input.name?.trim(),
    description: input.description?.trim(),
    category: input.category?.trim(),
    location: input.location?.trim(),
    rules: input.rules.trim(),
  };
  if (input.name !== undefined && (!trimmed.name || trimmed.name.length > 80)) {
    throw new Error('Informe um nome de até 80 caracteres para a comunidade.');
  }
  if (input.description !== undefined && (!trimmed.description || trimmed.description.length > 500)) {
    throw new Error('Informe uma descrição de até 500 caracteres.');
  }
  if (input.category !== undefined && (!trimmed.category || trimmed.category.length > 80)) {
    throw new Error('Informe uma categoria de até 80 caracteres.');
  }
  if (input.location !== undefined && (trimmed.location?.length ?? 0) > 120) {
    throw new Error('A localização deve ter até 120 caracteres.');
  }
  if (!trimmed.rules || trimmed.rules.length > 1200) {
    throw new Error('Informe regras de até 1.200 caracteres.');
  }
  const nowIso = new Date().toISOString();
  await updateDoc(doc(db, 'communities', input.communityId), {
    ...(input.name !== undefined ? { name: trimmed.name } : {}),
    ...(input.description !== undefined ? { description: trimmed.description } : {}),
    ...(input.category !== undefined ? { category: trimmed.category } : {}),
    ...(input.location !== undefined ? { location: trimmed.location } : {}),
    rules: trimmed.rules,
    ...(input.coverImage !== undefined
      ? { coverImage: input.coverImage.trim().slice(0, 4096) }
      : {}),
    ...(input.coverPath !== undefined
      ? { coverPath: input.coverPath.trim().slice(0, 1024) }
      : {}),
    updatedAtIso: nowIso,
    updatedAt: serverTimestamp(),
    activityAtIso: nowIso,
    activityAt: serverTimestamp(),
  });
};

/**
 * Apply community details and a cover change as one Firestore update.
 * A new image is uploaded first but only becomes public in the community
 * after the metadata update succeeds. Failed saves discard the staged file.
 * Existing cover files are removed only after a confirmed metadata update.
 */
export const saveCommunityProfile = async (
  community: CloudCommunity,
  input: CommunityUpdateInput,
  coverBlob: Blob | null,
  removeCover: boolean
): Promise<void> => {
  const { user } = currentIdentity();
  if (community.ownerId !== user.uid || input.communityId !== community.id) {
    throw new Error('Somente o criador pode editar esta comunidade.');
  }

  let coverImage = community.coverImage;
  let coverPath = community.coverPath;
  let stagedPath = '';

  if (removeCover) {
    coverImage = '';
    coverPath = '';
  } else if (coverBlob) {
    stagedPath = `community-covers/${community.id}/${user.uid}/${Date.now()}-${crypto.randomUUID()}.jpg`;
    const destination = ref(storage, stagedPath);
    try {
      await uploadBytes(destination, coverBlob, {
        contentType: coverBlob.type || 'image/jpeg',
        customMetadata: { communityId: community.id, ownerId: user.uid },
      });
      coverImage = await getDownloadURL(destination);
      coverPath = stagedPath;
    } catch (error) {
      await deleteObject(destination).catch(() => undefined);
      throw error;
    }
  }

  try {
    await updateCommunity({ ...input, coverImage, coverPath });
  } catch (error) {
    if (stagedPath) {
      await deleteObject(ref(storage, stagedPath)).catch(() => undefined);
    }
    throw error;
  }

  if (community.coverPath && community.coverPath !== coverPath) {
    void deleteObject(ref(storage, community.coverPath)).catch(() => undefined);
  }
};

export const uploadCommunityCover = async (
  community: CloudCommunity,
  file: Blob
): Promise<{ url: string; path: string }> => {
  const { user } = currentIdentity();
  if (community.ownerId !== user.uid) {
    throw new Error('Somente o criador pode trocar a capa.');
  }
  const path = `community-covers/${community.id}/${user.uid}/${Date.now()}.jpg`;
  const storageReference = ref(storage, path);
  await uploadBytes(storageReference, file, {
    contentType: file.type || 'image/jpeg',
    customMetadata: {
      communityId: community.id,
      ownerId: user.uid,
    },
  });
  const url = await getDownloadURL(storageReference);
  const previousPath = community.coverPath;
  await updateCommunity({
    communityId: community.id,
    rules: community.rules,
    coverImage: url,
    coverPath: path,
  });
  if (previousPath && previousPath !== path) {
    deleteObject(ref(storage, previousPath)).catch(() => undefined);
  }
  return { url, path };
};

export const removeCommunityCover = async (
  community: CloudCommunity
): Promise<void> => {
  const previousPath = community.coverPath;
  await updateCommunity({
    communityId: community.id,
    rules: community.rules,
    coverImage: '',
    coverPath: '',
  });
  if (previousPath) deleteObject(ref(storage, previousPath)).catch(() => undefined);
};

export const joinCommunity = async (
  communityId: string
): Promise<CommunityMembershipStatus> => {
  const { user, name, avatar } = currentIdentity();
  const communityReference = doc(db, 'communities', communityId);
  const membershipId = communityMembershipId(communityId, user.uid);
  const membershipReference = doc(db, 'community_members', membershipId);

  return runTransaction(db, async transaction => {
    const [communitySnapshot, membershipSnapshot] = await Promise.all([
      transaction.get(communityReference),
      transaction.get(membershipReference),
    ]);
    if (!communitySnapshot.exists()) throw new Error('Comunidade não encontrada.');
    if (membershipSnapshot.exists()) {
      return parseMembershipStatus(membershipSnapshot.data().status);
    }
    const community = mapCommunity(
      communitySnapshot.id,
      communitySnapshot.data() as Record<string, unknown>
    );
    if (!community) throw new Error('Os dados da comunidade são inválidos.');
    if (community.visibility === 'private') {
      throw new Error('Esta comunidade aceita somente participantes convidados.');
    }

    const status: CommunityMembershipStatus =
      community.visibility === 'moderated' ? 'pending' : 'active';
    const nowIso = new Date().toISOString();
    transaction.set(membershipReference, {
      membershipId,
      communityId,
      userId: user.uid,
      userName: name,
      userAvatar: avatar,
      role: 'member',
      status,
      joinedAtIso: nowIso,
      joinedAt: serverTimestamp(),
      updatedAtIso: nowIso,
      updatedAt: serverTimestamp(),
    });
    if (status === 'active') {
      transaction.update(communityReference, {
        memberCount: community.memberCount + 1,
        lastMembershipChangeId: membershipId,
        updatedAtIso: nowIso,
        updatedAt: serverTimestamp(),
        activityAtIso: nowIso,
        activityAt: serverTimestamp(),
      });
    }
    return status;
  });
};

export const leaveCommunity = async (communityId: string): Promise<void> => {
  const { user } = currentIdentity();
  const communityReference = doc(db, 'communities', communityId);
  const membershipId = communityMembershipId(communityId, user.uid);
  const membershipReference = doc(db, 'community_members', membershipId);

  await runTransaction(db, async transaction => {
    const [communitySnapshot, membershipSnapshot] = await Promise.all([
      transaction.get(communityReference),
      transaction.get(membershipReference),
    ]);
    if (!membershipSnapshot.exists()) return;
    const membership = mapMembership(
      membershipSnapshot.id,
      membershipSnapshot.data() as Record<string, unknown>
    );
    if (!membership) return;
    if (membership.role === 'owner') {
      throw new Error('O criador não pode sair da própria comunidade.');
    }
    transaction.delete(membershipReference);
    if (membership.status === 'active' && communitySnapshot.exists()) {
      const community = mapCommunity(
        communitySnapshot.id,
        communitySnapshot.data() as Record<string, unknown>
      );
      if (community) {
        const nowIso = new Date().toISOString();
        transaction.update(communityReference, {
          memberCount: Math.max(1, community.memberCount - 1),
          lastMembershipChangeId: membershipId,
          updatedAtIso: nowIso,
          updatedAt: serverTimestamp(),
          activityAtIso: nowIso,
          activityAt: serverTimestamp(),
        });
      }
    }
  });
};

export const approveCommunityMember = async (
  communityId: string,
  userId: string
): Promise<void> => {
  const { user } = currentIdentity();
  const communityReference = doc(db, 'communities', communityId);
  const membershipId = communityMembershipId(communityId, userId);
  const membershipReference = doc(db, 'community_members', membershipId);

  await runTransaction(db, async transaction => {
    const [communitySnapshot, membershipSnapshot] = await Promise.all([
      transaction.get(communityReference),
      transaction.get(membershipReference),
    ]);
    if (!communitySnapshot.exists() || !membershipSnapshot.exists()) {
      throw new Error('Solicitação não encontrada.');
    }
    const community = mapCommunity(
      communitySnapshot.id,
      communitySnapshot.data() as Record<string, unknown>
    );
    const membership = mapMembership(
      membershipSnapshot.id,
      membershipSnapshot.data() as Record<string, unknown>
    );
    if (!community || !membership || community.ownerId !== user.uid) {
      throw new Error('Somente o criador pode aprovar participantes.');
    }
    if (membership.status === 'active') return;
    const nowIso = new Date().toISOString();
    transaction.update(membershipReference, {
      status: 'active',
      updatedAtIso: nowIso,
      updatedAt: serverTimestamp(),
    });
    transaction.update(communityReference, {
      memberCount: community.memberCount + 1,
      lastMembershipChangeId: membershipId,
      updatedAtIso: nowIso,
      updatedAt: serverTimestamp(),
      activityAtIso: nowIso,
      activityAt: serverTimestamp(),
    });
  });
};

export const rejectCommunityMember = async (
  communityId: string,
  userId: string
): Promise<void> => {
  const { user } = currentIdentity();
  const community = await getCommunity(communityId);
  if (!community || community.ownerId !== user.uid) {
    throw new Error('Somente o criador pode recusar solicitações.');
  }
  await deleteDoc(
    doc(db, 'community_members', communityMembershipId(communityId, userId))
  );
};

/** Uploads for community wall posts live in one owner-scoped, community-scoped
 * Storage location. The Storage Rules independently enforce membership and MIME limits.
 * Never store temporary blob/data URLs in a Firestore post. */
export const uploadCommunityPostMedia = async (
  communityId: string,
  file: File,
  attempt?: WallUploadAttempt,
): Promise<string> => {
  const { user } = currentIdentity();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(communityId)) {
    throw new Error('Comunidade inválida para anexos.');
  }
  const extensions: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
  };
  const community = await getCommunity(communityId);
  if (!community || community.visibility === 'private') {
    throw new Error('Anexos da comunidade privada exigem um leitor de mídia protegido. Por enquanto, publique texto.');
  }
  const extension = extensions[file.type];
  const maxSize = file.type.startsWith('video/') ? 20 : 8;
  if (!extension || file.size === 0 || file.size > maxSize * 1024 * 1024) {
    throw new Error('Use imagem JPG/PNG/WebP de até 8 MB ou vídeo MP4/WebM de até 20 MB.');
  }
  const assertSession = () => {
    if (auth.currentUser !== user) throw new Error('Faça login novamente antes de enviar o anexo.');
  };
  const kind = file.type.startsWith('video/') ? 'video' : 'image';
  const attachmentId = attempt?.id ?? crypto.randomUUID();
  if (!/^[a-f0-9-]{36}$/i.test(attachmentId)) throw new Error('Identificador de anexo inválido.');
  const path = `community-post-media/${communityId}/${user.uid}/${kind}-${attachmentId}.${extension}`;
  const destination = ref(storage, path);
  assertSession();
  // Only retry the exact same selected attachment. Storage rules prohibit
  // overwriting community media. Never treat denied access as missing.
  if (attempt?.started) {
    const metadata = await getMetadata(destination).catch((error: unknown) => {
      if ((error as { code?: string } | null)?.code === 'storage/object-not-found') return null;
      throw error;
    });
    assertSession();
    if (metadata) {
      if (metadata.contentType !== file.type || metadata.size <= 0 ||
          metadata.size > maxSize * 1024 * 1024 ||
          metadata.customMetadata?.ownerId !== user.uid ||
          metadata.customMetadata?.communityId !== communityId ||
          metadata.customMetadata?.purpose !== 'community-wall') {
        throw new Error('O anexo enviado não corresponde à tentativa atual.');
      }
      const url = await getDownloadURL(destination);
      assertSession();
      return url;
    }
  }
  const uploadFile = await optimizeCommunityWallImage(file);
  assertSession();
  if (attempt) attempt.started = true;
  await uploadBytes(destination, uploadFile, {
    contentType: file.type,
    customMetadata: { communityId, ownerId: user.uid, purpose: 'community-wall' },
  });
  assertSession();
  const url = await getDownloadURL(destination);
  assertSession();
  return url;
};

export const createCommunityPost = async (input: {
  communityId: string;
  content: string;
  mediaUrls?: string[];
  shareToSquare?: boolean;
  allowComments?: boolean;
  attempt?: { postId: string; owner: User };
}): Promise<string> => {
  const { user, name, avatar } = currentIdentity();
  const content = input.content.trim().slice(0, 3000);
  const mediaUrls = Array.from(new Set(input.mediaUrls ?? []))
    .filter(item => item && !item.startsWith('blob:'))
    .slice(0, 9);
  if (!content && mediaUrls.length === 0) {
    throw new Error('Escreva algo ou adicione uma imagem.');
  }
  const attempt = input.attempt;
  if (attempt) {
    if (attempt.owner !== user || !/^wall_[a-f0-9-]{36}$/.test(attempt.postId)) {
      throw new Error('Tentativa de publicação inválida.');
    }
    const assertSession = () => {
      if (auth.currentUser !== user) throw new Error('Faça login novamente para confirmar a publicação.');
    };
    // A fingerprint detects accidental reuse of the same ID for a different
    // payload. It is not a trusted authorization or content signature.
    const bytes = new TextEncoder().encode(JSON.stringify([
      input.communityId, content, mediaUrls, input.shareToSquare !== false, input.allowComments !== false,
    ]));
    const requestHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
      .map(value => value.toString(16).padStart(2, '0')).join('');
    assertSession();
    const postRef = doc(db, 'community_posts', attempt.postId);
    const receiptRef = doc(db, 'community_wall_publish_receipts', attempt.postId);
    return runTransaction(db, async tx => {
      assertSession();
      const receipt = await tx.get(receiptRef);
      assertSession();
      if (receipt.exists()) {
        const data = receipt.data();
        if (data.authorId !== user.uid || data.communityId !== input.communityId ||
            data.postId !== attempt.postId || data.requestHash !== requestHash) {
          throw new Error('A tentativa anterior não corresponde a esta publicação.');
        }
        // Receipt remains even after author/moderator removes the post.
        // Never resurrect a removed publication, or recreate Praça discovery.
        return attempt.postId;
      }
      const community = input.shareToSquare === false ? null :
        await tx.get(doc(db, 'communities', input.communityId));
      assertSession();
      const nowIso = new Date().toISOString();
      tx.set(postRef, {
        postId: postRef.id, communityId: input.communityId, authorId: user.uid,
        authorName: name, authorAvatar: avatar, content, mediaUrls,
        allowComments: input.allowComments !== false, pinnedCommentId: '',
        createdAtIso: nowIso, createdAt: serverTimestamp(),
        updatedAtIso: nowIso, updatedAt: serverTimestamp(),
      });
      tx.set(receiptRef, {
        postId: postRef.id, communityId: input.communityId, authorId: user.uid,
        requestHash, createdAt: serverTimestamp(),
      });
      if (community?.exists() && community.data().visibility === 'public') {
        tx.set(doc(db, 'community_square_posts', postRef.id), {
          postId: postRef.id, communityId: input.communityId, createdAt: serverTimestamp(),
        });
      }
      return postRef.id;
    });
  }
  const reference = doc(collection(db, 'community_posts'));
  const nowIso = new Date().toISOString();
  // Public community posts enter the 24h discovery feed unless the author opts out.
  // Private/moderated communities are excluded, regardless of the checkbox.
  const community = input.shareToSquare === false ? null : await getCommunity(input.communityId);
  const publishToSquare = input.shareToSquare !== false && community?.visibility === 'public';
  const batch = writeBatch(db);
  batch.set(reference, {
    postId: reference.id,
    communityId: input.communityId,
    authorId: user.uid,
    authorName: name,
    authorAvatar: avatar,
    content,
    mediaUrls,
    allowComments: input.allowComments !== false,
    pinnedCommentId: '',
    createdAtIso: nowIso,
    createdAt: serverTimestamp(),
    updatedAtIso: nowIso,
    updatedAt: serverTimestamp(),
  });
  if (publishToSquare) {
    batch.set(doc(db, 'community_square_posts', reference.id), {
      postId: reference.id,
      communityId: input.communityId,
      createdAt: serverTimestamp(),
    });
  }
  await batch.commit();
  return reference.id;
};

const parseLocalArray = (key: string): Array<Record<string, unknown>> => {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === 'object'
        )
      : [];
  } catch {
    return [];
  }
};

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

export const hasLocalCommunityPrototype = (): boolean =>
  parseLocalArray(LOCAL_COMMUNITIES_KEY).some(item => item.isOwner === true);

const dataUrlToBlob = async (dataUrl: string): Promise<Blob | null> => {
  if (!dataUrl.startsWith('data:image/')) return null;
  try {
    return await (await fetch(dataUrl)).blob();
  } catch {
    return null;
  }
};

export const importLocalCommunityPrototype = async (): Promise<number> => {
  const { user } = currentIdentity();
  const localCommunities = parseLocalArray(LOCAL_COMMUNITIES_KEY).filter(
    item => item.isOwner === true
  );
  if (localCommunities.length === 0) return 0;
  const localPosts = parseLocalArray(LOCAL_POSTS_KEY);
  let imported = 0;

  for (const localCommunity of localCommunities) {
    const localId = readString(localCommunity.id) || readString(localCommunity.name);
    if (!localId) continue;
    const communityId = `imported-${stableHash(`${user.uid}|${localId}`)}`;
    const existing = await getDoc(doc(db, 'communities', communityId));
    let cloudCommunity: CloudCommunity | null = existing.exists()
      ? mapCommunity(
          existing.id,
          existing.data() as Record<string, unknown>
        )
      : null;

    if (!cloudCommunity) {
      cloudCommunity = await createCommunityWithId(
        communityId,
        {
          name: readString(localCommunity.name) || 'Comunidade importada',
          description:
            readString(localCommunity.description) ||
            'Comunidade importada do protótipo local.',
          category: readString(localCommunity.category),
          location: readString(localCommunity.location),
          visibility: parseVisibility(localCommunity.visibility),
          rules: readString(localCommunity.rules),
        },
        user
      );
      imported += 1;

      const coverBlob = await dataUrlToBlob(readString(localCommunity.coverImage));
      if (coverBlob) {
        try {
          const uploaded = await uploadCommunityCover(cloudCommunity, coverBlob);
          cloudCommunity = {
            ...cloudCommunity,
            coverImage: uploaded.url,
            coverPath: uploaded.path,
          };
        } catch {
          // The remaining community data is still imported if the local image fails.
        }
      }

      for (const localPost of localPosts.filter(
        item => readString(item.communityId) === localId
      )) {
        try {
          await createCommunityPost({
            communityId,
            content: readString(localPost.content),
            mediaUrls: readStringList(localPost.mediaUrls).filter(
              url => !url.startsWith('data:') && !url.startsWith('blob:')
            ),
          });
        } catch {
          // Skip invalid local entries without aborting the whole migration.
        }
      }

    }
  }

  localStorage.setItem(
    `kyrub_cloud_community_imported_${user.uid}`,
    new Date().toISOString()
  );
  return imported;
};
