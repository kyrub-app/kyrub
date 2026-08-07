import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
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
  ref,
  uploadBytes,
} from 'firebase/storage';
import { auth, db, storage } from './firebase';

export type CommunityVisibility = 'public' | 'moderated' | 'private';
export type CommunityMembershipStatus = 'active' | 'pending';
export type CommunityMemberRole = 'owner' | 'moderator' | 'member';
export type CommunityDebateStatus = 'open' | 'closed';

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
  createdAt: string;
  updatedAt: string;
}

export interface CloudCommunityDebate {
  id: string;
  communityId: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  title: string;
  content: string;
  status: CommunityDebateStatus;
  pinned: boolean;
  resolved: boolean;
  commentCount: number;
  lastCommentId: string;
  createdAt: string;
  updatedAt: string;
  activityAt: string;
}

export interface CloudCommunityDebateComment {
  id: string;
  communityId: string;
  debateId: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  text: string;
  parentCommentId: string;
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
  rules: string;
  coverImage?: string;
  coverPath?: string;
}

export const OPEN_COMMUNITY_CLOUD_CREATE_EVENT =
  'kyrub-open-community-cloud-create';

const LOCAL_COMMUNITIES_KEY = 'kyrub_preview_communities_v1';
const LOCAL_POSTS_KEY = 'kyrub_preview_community_posts_v1';
const LOCAL_DEBATES_KEY = 'kyrub_preview_community_discussions_v1';

const readString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const readStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean)
    : [];

const readBoolean = (value: unknown): boolean => value === true;

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
    createdAt,
    updatedAt:
      readString(data.updatedAtIso) || timestampToIso(data.updatedAt, createdAt),
  };
};

const mapDebate = (
  id: string,
  data: Record<string, unknown>
): CloudCommunityDebate | null => {
  const communityId = readString(data.communityId);
  const authorId = readString(data.authorId);
  const title = readString(data.title);
  if (!communityId || !authorId || !title) return null;
  const createdAt =
    readString(data.createdAtIso) ||
    timestampToIso(data.createdAt, new Date().toISOString());
  const updatedAt =
    readString(data.updatedAtIso) || timestampToIso(data.updatedAt, createdAt);
  return {
    id,
    communityId,
    authorId,
    authorName: readString(data.authorName) || 'Usuário Kyrub',
    authorAvatar: readString(data.authorAvatar),
    title,
    content: readString(data.content),
    status: data.status === 'closed' ? 'closed' : 'open',
    pinned: readBoolean(data.pinned),
    resolved: readBoolean(data.resolved),
    commentCount: Math.max(0, Math.floor(readNumber(data.commentCount))),
    lastCommentId: readString(data.lastCommentId),
    createdAt,
    updatedAt,
    activityAt:
      readString(data.activityAtIso) ||
      timestampToIso(data.activityAt, updatedAt),
  };
};

const mapComment = (
  id: string,
  data: Record<string, unknown>
): CloudCommunityDebateComment | null => {
  const communityId = readString(data.communityId);
  const debateId = readString(data.debateId);
  const authorId = readString(data.authorId);
  const text = readString(data.text);
  if (!communityId || !debateId || !authorId || !text) return null;
  const createdAt =
    readString(data.createdAtIso) ||
    timestampToIso(data.createdAt, new Date().toISOString());
  return {
    id,
    communityId,
    debateId,
    authorId,
    authorName: readString(data.authorName) || 'Usuário Kyrub',
    authorAvatar: readString(data.authorAvatar),
    text,
    parentCommentId: readString(data.parentCommentId),
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
      where('visibility', 'in', ['public', 'moderated'])
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
  onError?: (error: Error) => void
): Unsubscribe =>
  onSnapshot(
    query(
      collection(db, 'community_members'),
      where('communityId', '==', communityId)
    ),
    snapshot =>
      onChange(
        snapshotItems(snapshot, mapMembership).sort((left, right) => {
          if (left.role === 'owner') return -1;
          if (right.role === 'owner') return 1;
          if (left.status !== right.status) return left.status === 'pending' ? -1 : 1;
          return left.userName.localeCompare(right.userName, 'pt-BR');
        })
      ),
    error => onError?.(error)
  );

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

export const subscribeCommunityDebates = (
  communityId: string,
  onChange: (debates: CloudCommunityDebate[]) => void,
  onError?: (error: Error) => void
): Unsubscribe =>
  onSnapshot(
    query(
      collection(db, 'community_debates'),
      where('communityId', '==', communityId)
    ),
    snapshot => onChange(byActivity(snapshotItems(snapshot, mapDebate))),
    error => onError?.(error)
  );

export const subscribeDebateComments = (
  debateId: string,
  onChange: (comments: CloudCommunityDebateComment[]) => void,
  onError?: (error: Error) => void
): Unsubscribe =>
  onSnapshot(
    query(
      collection(db, 'community_debate_comments'),
      where('debateId', '==', debateId)
    ),
    snapshot =>
      onChange(
        snapshotItems(snapshot, mapComment).sort(
          (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)
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
  const nowIso = new Date().toISOString();
  await updateDoc(doc(db, 'communities', input.communityId), {
    rules: input.rules.trim().slice(0, 1200),
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

export const createCommunityPost = async (input: {
  communityId: string;
  content: string;
  mediaUrls?: string[];
}): Promise<string> => {
  const { user, name, avatar } = currentIdentity();
  const content = input.content.trim().slice(0, 3000);
  const mediaUrls = Array.from(new Set(input.mediaUrls ?? []))
    .filter(item => item && !item.startsWith('blob:'))
    .slice(0, 9);
  if (!content && mediaUrls.length === 0) {
    throw new Error('Escreva algo ou adicione uma imagem.');
  }
  const reference = doc(collection(db, 'community_posts'));
  const nowIso = new Date().toISOString();
  await setDoc(reference, {
    postId: reference.id,
    communityId: input.communityId,
    authorId: user.uid,
    authorName: name,
    authorAvatar: avatar,
    content,
    mediaUrls,
    createdAtIso: nowIso,
    createdAt: serverTimestamp(),
    updatedAtIso: nowIso,
    updatedAt: serverTimestamp(),
  });
  return reference.id;
};

export const createCommunityDebate = async (input: {
  communityId: string;
  title: string;
  content: string;
}): Promise<string> => {
  const { user, name, avatar } = currentIdentity();
  const title = input.title.trim().slice(0, 140);
  const content = input.content.trim().slice(0, 3000);
  if (!title) throw new Error('Informe o título do debate.');
  if (!content) throw new Error('Explique o assunto do debate.');
  const reference = doc(collection(db, 'community_debates'));
  const nowIso = new Date().toISOString();
  await setDoc(reference, {
    debateId: reference.id,
    communityId: input.communityId,
    authorId: user.uid,
    authorName: name,
    authorAvatar: avatar,
    title,
    content,
    status: 'open',
    pinned: false,
    resolved: false,
    commentCount: 0,
    lastCommentId: '',
    createdAtIso: nowIso,
    createdAt: serverTimestamp(),
    updatedAtIso: nowIso,
    updatedAt: serverTimestamp(),
    activityAtIso: nowIso,
    activityAt: serverTimestamp(),
  });
  return reference.id;
};

export const updateDebateStatus = async (
  debateId: string,
  status: CommunityDebateStatus
): Promise<void> => {
  currentIdentity();
  const nowIso = new Date().toISOString();
  await updateDoc(doc(db, 'community_debates', debateId), {
    status,
    updatedAtIso: nowIso,
    updatedAt: serverTimestamp(),
    activityAtIso: nowIso,
    activityAt: serverTimestamp(),
  });
};

export const addDebateComment = async (input: {
  communityId: string;
  debateId: string;
  text: string;
  parentCommentId?: string;
}): Promise<string> => {
  const { user, name, avatar } = currentIdentity();
  const text = input.text.trim().slice(0, 1400);
  if (!text) throw new Error('O comentário está vazio.');
  const debateReference = doc(db, 'community_debates', input.debateId);
  const commentReference = doc(collection(db, 'community_debate_comments'));
  const nowIso = new Date().toISOString();

  await runTransaction(db, async transaction => {
    const debateSnapshot = await transaction.get(debateReference);
    if (!debateSnapshot.exists()) throw new Error('Debate não encontrado.');
    const debate = mapDebate(
      debateSnapshot.id,
      debateSnapshot.data() as Record<string, unknown>
    );
    if (!debate || debate.communityId !== input.communityId) {
      throw new Error('Debate inválido.');
    }
    if (debate.status !== 'open') {
      throw new Error('Este debate está encerrado para novos comentários.');
    }
    transaction.set(commentReference, {
      commentId: commentReference.id,
      communityId: input.communityId,
      debateId: input.debateId,
      authorId: user.uid,
      authorName: name,
      authorAvatar: avatar,
      text,
      parentCommentId: input.parentCommentId?.trim().slice(0, 500) || '',
      createdAtIso: nowIso,
      createdAt: serverTimestamp(),
      updatedAtIso: nowIso,
      updatedAt: serverTimestamp(),
    });
    transaction.update(debateReference, {
      commentCount: debate.commentCount + 1,
      lastCommentId: commentReference.id,
      updatedAtIso: nowIso,
      updatedAt: serverTimestamp(),
      activityAtIso: nowIso,
      activityAt: serverTimestamp(),
    });
  });
  return commentReference.id;
};

export const updateDebateComment = async (
  commentId: string,
  text: string
): Promise<void> => {
  currentIdentity();
  const normalizedText = text.trim().slice(0, 1400);
  if (!normalizedText) throw new Error('O comentário está vazio.');
  const nowIso = new Date().toISOString();
  await updateDoc(doc(db, 'community_debate_comments', commentId), {
    text: normalizedText,
    updatedAtIso: nowIso,
    updatedAt: serverTimestamp(),
  });
};

export const deleteDebateComment = async (
  debateId: string,
  commentId: string
): Promise<void> => {
  currentIdentity();
  const debateReference = doc(db, 'community_debates', debateId);
  const commentReference = doc(db, 'community_debate_comments', commentId);
  await runTransaction(db, async transaction => {
    const [debateSnapshot, commentSnapshot] = await Promise.all([
      transaction.get(debateReference),
      transaction.get(commentReference),
    ]);
    if (!commentSnapshot.exists()) return;
    if (!debateSnapshot.exists()) {
      transaction.delete(commentReference);
      return;
    }
    const debate = mapDebate(
      debateSnapshot.id,
      debateSnapshot.data() as Record<string, unknown>
    );
    if (!debate) throw new Error('Debate inválido.');
    const nowIso = new Date().toISOString();
    transaction.delete(commentReference);
    transaction.update(debateReference, {
      commentCount: Math.max(0, debate.commentCount - 1),
      lastCommentId: commentId,
      updatedAtIso: nowIso,
      updatedAt: serverTimestamp(),
      activityAtIso: nowIso,
      activityAt: serverTimestamp(),
    });
  });
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
  const localDebates = parseLocalArray(LOCAL_DEBATES_KEY);
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

      for (const localDebate of localDebates.filter(
        item => readString(item.communityId) === localId
      )) {
        try {
          await createCommunityDebate({
            communityId,
            title: readString(localDebate.title),
            content: readString(localDebate.content),
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
