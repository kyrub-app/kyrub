import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  runTransaction,
  serverTimestamp,
  Timestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

const PROJECT_ID = 'kyrub-security-test';
const OWNER = 'community_owner';
const MEMBER = 'community_member';
const OUTSIDER = 'community_outsider';
let environment: RulesTestEnvironment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('.firebase/firestore.combined.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8088,
    },
  });
});

beforeEach(async () => environment.clearFirestore());
after(async () => environment.cleanup());

const memberId = (communityId: string, userId: string) =>
  `${communityId}__${userId}`;

const communityData = (
  communityId: string,
  visibility: 'public' | 'moderated' | 'private',
  count = 1,
  changeId = memberId(communityId, OWNER)
) => ({
  communityId,
  ownerId: OWNER,
  ownerName: 'Criador Kyrub',
  ownerAvatar: '',
  name: `Comunidade ${communityId}`,
  description: 'Comunidade usada para validar acesso entre perfis.',
  category: 'Testes',
  location: 'Brasil',
  visibility,
  rules: 'Respeite todos os participantes.',
  coverImage: '',
  coverPath: '',
  memberCount: count,
  lastMembershipChangeId: changeId,
  createdAtIso: '2026-08-05T00:00:00.000Z',
  createdAt: serverTimestamp(),
  updatedAtIso: '2026-08-05T00:00:00.000Z',
  updatedAt: serverTimestamp(),
  activityAtIso: '2026-08-05T00:00:00.000Z',
  activityAt: serverTimestamp(),
});

const membershipData = (
  communityId: string,
  userId: string,
  status: 'active' | 'pending',
  role: 'owner' | 'member' = 'member'
) => ({
  membershipId: memberId(communityId, userId),
  communityId,
  userId,
  userName: userId,
  userAvatar: '',
  role,
  status,
  joinedAtIso: '2026-08-05T00:00:00.000Z',
  joinedAt: serverTimestamp(),
  updatedAtIso: '2026-08-05T00:00:00.000Z',
  updatedAt: serverTimestamp(),
});

const createCommunity = async (
  firestore: any,
  communityId: string,
  visibility: 'public' | 'moderated' | 'private'
) => {
  const batch = writeBatch(firestore);
  batch.set(
    doc(firestore, 'communities', communityId),
    communityData(communityId, visibility)
  );
  batch.set(
    doc(firestore, 'community_members', memberId(communityId, OWNER)),
    membershipData(communityId, OWNER, 'active', 'owner')
  );
  await batch.commit();
};

const joinPublic = async (
  firestore: any,
  communityId: string,
  userId: string
) => {
  const id = memberId(communityId, userId);
  const batch = writeBatch(firestore);
  batch.set(
    doc(firestore, 'community_members', id),
    membershipData(communityId, userId, 'active')
  );
  batch.update(doc(firestore, 'communities', communityId), {
    memberCount: 2,
    lastMembershipChangeId: id,
    updatedAtIso: '2026-08-05T00:01:00.000Z',
    updatedAt: serverTimestamp(),
    activityAtIso: '2026-08-05T00:01:00.000Z',
    activityAt: serverTimestamp(),
  });
  await batch.commit();
};

const debateData = (communityId: string, debateId: string) => ({
  debateId,
  communityId,
  authorId: MEMBER,
  authorName: 'Membro',
  authorAvatar: '',
  title: 'Como melhorar nossa comunidade?',
  content: 'Compartilhe uma proposta e continue este debate.',
  status: 'open',
  pinned: false,
  resolved: false,
  commentCount: 0,
  lastCommentId: '',
  createdAtIso: '2026-08-05T00:02:00.000Z',
  createdAt: serverTimestamp(),
  updatedAtIso: '2026-08-05T00:02:00.000Z',
  updatedAt: serverTimestamp(),
  activityAtIso: '2026-08-05T00:02:00.000Z',
  activityAt: serverTimestamp(),
});

test('creator creates the community and owner membership atomically', async () => {
  const owner = environment.authenticatedContext(OWNER).firestore();
  await assertSucceeds(createCommunity(owner, 'public_a', 'public'));
  await assertSucceeds(getDoc(doc(owner, 'communities', 'public_a')));
});

test('new public and private communities persist for their creator across a fresh session', async () => {
  const firstSession = environment.authenticatedContext(OWNER).firestore();
  await assertSucceeds(createCommunity(firstSession, 'future_public', 'public'));
  await assertSucceeds(createCommunity(firstSession, 'future_private', 'private'));

  // Simulate a new authenticated reader after creation, rather than relying
  // on the same write client's local listener/cache.
  const newSession = environment.authenticatedContext(OWNER).firestore();
  const own = await assertSucceeds(getDocs(query(
    collection(newSession, 'communities'), where('ownerId', '==', OWNER),
  )));
  const ids = own.docs.map(item => item.id).sort();
  if (ids.join(',') !== ['future_private', 'future_public'].join(',')) {
    throw Error('Owned communities were not visible after a fresh login: ' + ids.join(','));
  }
  for (const id of ids) {
    const community = await assertSucceeds(getDoc(doc(newSession, 'communities', id)));
    const membership = await assertSucceeds(getDoc(doc(
      newSession, 'community_members', memberId(id, OWNER),
    )));
    if (!community.exists() || community.data().ownerId !== OWNER ||
        !membership.exists() || membership.data().role !== 'owner' ||
        membership.data().status !== 'active') {
      throw Error('New community or its atomic owner membership is missing: ' + id);
    }
  }

  const outsider = environment.authenticatedContext(OUTSIDER).firestore();
  const publicList = await assertSucceeds(getDocs(query(
    collection(outsider, 'communities'),
    where('visibility', 'in', ['public', 'moderated']),
  )));
  if (!publicList.docs.some(item => item.id === 'future_public') ||
      publicList.docs.some(item => item.id === 'future_private')) {
    throw Error('Public discovery leaked private data or hid a newly created public community');
  }
  await assertSucceeds(getDoc(doc(outsider, 'communities', 'future_public')));
  await assertFails(getDoc(doc(outsider, 'communities', 'future_private')));
  await assertFails(updateDoc(doc(outsider, 'communities', 'future_public'), {
    name: 'Nome alterado por outro usuário',
  }));
});

test('cursor pages public communities without duplicates or private disclosures', async () => {
  const owner = environment.authenticatedContext(OWNER).firestore();
  const guestAccount = environment.authenticatedContext(OUTSIDER).firestore();
  for (const [id, visibility] of [
    ['cursor_a', 'public'], ['cursor_b', 'private'],
    ['cursor_c', 'moderated'], ['cursor_d', 'public'],
    ['cursor_e', 'public'],
  ] as const) {
    await assertSucceeds(createCommunity(owner, id, visibility));
  }
  const first = await assertSucceeds(getDocs(query(
    collection(guestAccount, 'communities'),
    where('visibility', 'in', ['public', 'moderated']),
    orderBy(documentId()), limit(2),
  )));
  const ids1 = first.docs.map(item => item.id);
  if (ids1.join(',') !== 'cursor_a,cursor_c') {
    throw Error('Unexpected first cursor batch: ' + ids1.join(','));
  }
  const second = await assertSucceeds(getDocs(query(
    collection(guestAccount, 'communities'),
    where('visibility', 'in', ['public', 'moderated']),
    orderBy(documentId()), startAfter(ids1[1]), limit(2),
  )));
  const ids2 = second.docs.map(item => item.id);
  if (ids2.join(',') !== 'cursor_d,cursor_e') {
    throw Error('Unexpected second cursor batch: ' + ids2.join(','));
  }
  const third = await assertSucceeds(getDocs(query(
    collection(guestAccount, 'communities'),
    where('visibility', 'in', ['public', 'moderated']),
    orderBy(documentId()), startAfter(ids2[1]), limit(2),
  )));
  if (third.docs.length !== 0 || new Set([...ids1, ...ids2]).size !== 4) {
    throw Error('Cursor discovery duplicates or omits communities');
  }
  await assertFails(getDoc(doc(guestAccount, 'communities', 'cursor_b')));
});

test('another authenticated profile reads but cannot administer a public community', async () => {
  const owner = environment.authenticatedContext(OWNER).firestore();
  const outsider = environment.authenticatedContext(OUTSIDER).firestore();
  await createCommunity(owner, 'public_b', 'public');
  await assertSucceeds(getDoc(doc(outsider, 'communities', 'public_b')));
  await assertFails(
    updateDoc(doc(outsider, 'communities', 'public_b'), {
      rules: 'Regra adulterada.',
      updatedAtIso: '2026-08-05T00:03:00.000Z',
      updatedAt: serverTimestamp(),
      activityAtIso: '2026-08-05T00:03:00.000Z',
      activityAt: serverTimestamp(),
    })
  );
});

test('public membership unlocks the mural, but legacy debate creation is disabled', async () => {
  const owner = environment.authenticatedContext(OWNER).firestore();
  const member = environment.authenticatedContext(MEMBER).firestore();
  await createCommunity(owner, 'public_c', 'public');
  await assertSucceeds(joinPublic(member, 'public_c', MEMBER));
  await assertSucceeds(setDoc(doc(member, 'community_posts', 'post_a'), {
    postId: 'post_a', communityId: 'public_c', authorId: MEMBER,
    authorName: 'Membro', authorAvatar: '', content: 'Publicação no Mural.',
    mediaUrls: [], createdAtIso: '2026-08-05T00:02:00.000Z', createdAt: serverTimestamp(),
    updatedAtIso: '2026-08-05T00:02:00.000Z', updatedAt: serverTimestamp(),
  }));
  await assertFails(setDoc(
    doc(member, 'community_debates', 'debate_a'),
    debateData('public_c', 'debate_a'),
  ));
});

test('moderated membership still needs owner approval before posting in Mural', async () => {
  const owner = environment.authenticatedContext(OWNER).firestore();
  const member = environment.authenticatedContext(MEMBER).firestore();
  await createCommunity(owner, 'moderated_a', 'moderated');
  const id = memberId('moderated_a', MEMBER);
  await assertSucceeds(setDoc(
    doc(member, 'community_members', id),
    membershipData('moderated_a', MEMBER, 'pending'),
  ));

  const postData = {
    postId: 'approved_mural_post', communityId: 'moderated_a', authorId: MEMBER,
    authorName: 'Membro', authorAvatar: '', content: 'Publicado após aprovação.',
    mediaUrls: [], createdAtIso: '2026-08-05T00:02:00.000Z', createdAt: serverTimestamp(),
    updatedAtIso: '2026-08-05T00:02:00.000Z', updatedAt: serverTimestamp(),
  };
  await assertFails(setDoc(doc(member, 'community_posts', 'approved_mural_post'), postData));

  const approval = writeBatch(owner);
  approval.update(doc(owner, 'community_members', id), {
    status: 'active',
    updatedAtIso: '2026-08-05T00:04:00.000Z',
    updatedAt: serverTimestamp(),
  });
  approval.update(doc(owner, 'communities', 'moderated_a'), {
    memberCount: 2, lastMembershipChangeId: id,
    updatedAtIso: '2026-08-05T00:04:00.000Z', updatedAt: serverTimestamp(),
    activityAtIso: '2026-08-05T00:04:00.000Z', activityAt: serverTimestamp(),
  });
  await assertSucceeds(approval.commit());
  await assertSucceeds(setDoc(doc(member, 'community_posts', 'approved_mural_post'), postData));
  await assertFails(setDoc(
    doc(member, 'community_debates', 'approved'),
    debateData('moderated_a', 'approved'),
  ));
});

test('retired historical debates and comments are retained read-only, even for their authors', async () => {
  const owner = environment.authenticatedContext(OWNER).firestore();
  const member = environment.authenticatedContext(MEMBER).firestore();
  await createCommunity(owner, 'public_d', 'public');
  await joinPublic(member, 'public_d', MEMBER);

  await environment.withSecurityRulesDisabled(async context => {
    const privileged = context.firestore();
    await setDoc(doc(privileged, 'community_debates', 'legacy_debate'), {
      ...debateData('public_d', 'legacy_debate'),
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), activityAt: serverTimestamp(),
    });
    await setDoc(doc(privileged, 'community_debate_comments', 'legacy_comment'), {
      commentId: 'legacy_comment', communityId: 'public_d', debateId: 'legacy_debate',
      authorId: MEMBER, authorName: 'Membro', authorAvatar: '',
      text: 'Comentário histórico preservado.', parentCommentId: '',
      createdAtIso: '2026-08-05T00:05:00.000Z', createdAt: serverTimestamp(),
      updatedAtIso: '2026-08-05T00:05:00.000Z', updatedAt: serverTimestamp(),
    });
  });

  await assertSucceeds(getDoc(doc(member, 'community_debates', 'legacy_debate')));
  await assertSucceeds(getDoc(doc(member, 'community_debate_comments', 'legacy_comment')));
  await assertFails(updateDoc(doc(member, 'community_debates', 'legacy_debate'), { status: 'closed' }));
  await assertFails(deleteDoc(doc(owner, 'community_debates', 'legacy_debate')));
  await assertFails(updateDoc(doc(member, 'community_debate_comments', 'legacy_comment'), { text: 'Alterado' }));
  await assertFails(deleteDoc(doc(member, 'community_debate_comments', 'legacy_comment')));
  await assertFails(setDoc(doc(member, 'community_debate_comments', 'new_legacy_comment'), {
    commentId: 'new_legacy_comment', communityId: 'public_d', debateId: 'legacy_debate',
    authorId: MEMBER, authorName: 'Membro', authorAvatar: '', text: 'Novo',
    parentCommentId: '', createdAtIso: '2026-08-05T00:05:00.000Z',
    createdAt: serverTimestamp(), updatedAtIso: '2026-08-05T00:05:00.000Z',
    updatedAt: serverTimestamp(),
  }));
});

test('community wall likes, comments and immutable reports enforce membership and ownership', async () => {
  const owner = environment.authenticatedContext(OWNER).firestore();
  const member = environment.authenticatedContext(MEMBER).firestore();
  const outsider = environment.authenticatedContext(OUTSIDER).firestore();
  const communityId = 'interaction_a';
  const postId = 'interaction_post';
  await createCommunity(owner, communityId, 'public');
  await joinPublic(member, communityId, MEMBER);
  await assertSucceeds(setDoc(doc(owner, 'community_posts', postId), {
    postId, communityId, authorId: OWNER, authorName: 'Criador Kyrub',
    authorAvatar: '', content: 'Publicação para testar reações.',
    mediaUrls: [], createdAtIso: '2026-11-19T12:00:00.000Z', createdAt: serverTimestamp(),
    updatedAtIso: '2026-11-19T12:00:00.000Z', updatedAt: serverTimestamp(),
  }));

  const likeId = `${postId}__${MEMBER}`;
  const likeData = { communityId, postId, userId: MEMBER, createdAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(member, 'community_post_likes', likeId), likeData));
  await assertSucceeds(getDocs(query(collection(member, 'community_post_likes'), where('communityId', '==', communityId))));
  await assertFails(setDoc(doc(outsider, 'community_post_likes', `${postId}__${OUTSIDER}`), {
    ...likeData, userId: OUTSIDER,
  }));
  await assertFails(setDoc(doc(member, 'community_post_likes', likeId), likeData));
  await assertFails(setDoc(doc(member, 'community_post_likes', 'forged'), likeData));
  await assertSucceeds(deleteDoc(doc(member, 'community_post_likes', likeId)));

  const commentId = 'interaction_comment';
  const commentData = {
    commentId, communityId, postId, authorId: MEMBER, authorName: 'Membro',
    authorAvatar: '', text: 'Que publicação boa!',
    createdAtIso: '2026-11-19T12:01:00.000Z', createdAt: serverTimestamp(),
  };
  await assertSucceeds(setDoc(doc(member, 'community_post_comments', commentId), commentData));
  await assertSucceeds(getDocs(query(collection(member, 'community_post_comments'), where('communityId', '==', communityId))));
  await assertFails(setDoc(doc(outsider, 'community_post_comments', 'outsider_comment'), {
    ...commentData, commentId: 'outsider_comment', authorId: OUTSIDER,
  }));
  await assertFails(setDoc(doc(member, 'community_post_comments', 'forged_comment'), {
    ...commentData, commentId: 'forged_comment', text: '',
  }));
  await assertFails(deleteDoc(doc(outsider, 'community_post_comments', commentId)));
  await assertSucceeds(deleteDoc(doc(owner, 'community_post_comments', commentId)));

  const reportId = `${postId}__${MEMBER}`;
  const reportData = {
    reportId, communityId, postId, reporterId: MEMBER, authorId: OWNER,
    reason: 'spam', status: 'pending', createdAt: serverTimestamp(),
  };
  await assertSucceeds(setDoc(doc(member, 'community_post_reports', reportId), reportData));
  await assertSucceeds(getDoc(doc(member, 'community_post_reports', reportId)));
  await assertFails(setDoc(doc(member, 'community_post_reports', reportId), reportData));
  await assertFails(getDoc(doc(outsider, 'community_post_reports', reportId)));
  await assertFails(setDoc(doc(owner, 'community_post_reports', `${postId}__${OWNER}`), {
    ...reportData, reportId: `${postId}__${OWNER}`, reporterId: OWNER,
  }));
  await assertFails(setDoc(doc(member, 'community_post_reports', 'wrong_group'), {
    ...reportData, reportId: 'wrong_group', communityId: 'other',
  }));
});

test('threaded community replies preserve scope, author permissions and existing records', async () => {
  const owner = environment.authenticatedContext(OWNER).firestore();
  const member = environment.authenticatedContext(MEMBER).firestore();
  const outsider = environment.authenticatedContext(OUTSIDER).firestore();
  const communityId = 'threaded_a';
  const otherCommunityId = 'threaded_b';
  await createCommunity(owner, communityId, 'public');
  await createCommunity(owner, otherCommunityId, 'public');
  await joinPublic(member, communityId, MEMBER);
  await joinPublic(member, otherCommunityId, MEMBER);
  const createPost = (id: string, group: string) => setDoc(doc(owner, 'community_posts', id), {
    postId: id, communityId: group, authorId: OWNER, authorName: 'Criador Kyrub',
    authorAvatar: '', content: 'Publicação para respostas.',
    mediaUrls: [], createdAtIso: '2026-11-20T12:00:00.000Z', createdAt: serverTimestamp(),
    updatedAtIso: '2026-11-20T12:00:00.000Z', updatedAt: serverTimestamp(),
  });
  await assertSucceeds(createPost('thread_post_a', communityId));
  await assertSucceeds(createPost('thread_post_b', communityId));
  await assertSucceeds(createPost('thread_post_other', otherCommunityId));
  const comment = (id: string, postId: string, group: string, parentCommentId?: string) => ({
    commentId: id, communityId: group, postId,
    authorId: MEMBER, authorName: 'Membro', authorAvatar: '', text: 'Participação.',
    createdAtIso: '2026-11-20T12:01:00.000Z', createdAt: serverTimestamp(),
    ...(parentCommentId ? { parentCommentId } : {}),
  });
  await assertSucceeds(setDoc(doc(member, 'community_post_comments', 'thread_root'),
    comment('thread_root', 'thread_post_a', communityId)));
  await assertSucceeds(setDoc(doc(member, 'community_post_comments', 'thread_reply'),
    comment('thread_reply', 'thread_post_a', communityId, 'thread_root')));
  await assertSucceeds(setDoc(doc(member, 'community_post_comments', 'thread_nested'),
    comment('thread_nested', 'thread_post_a', communityId, 'thread_reply')));
  await assertFails(setDoc(doc(member, 'community_post_comments', 'thread_missing'),
    comment('thread_missing', 'thread_post_a', communityId, 'not_found')));
  await assertFails(setDoc(doc(member, 'community_post_comments', 'thread_self'),
    comment('thread_self', 'thread_post_a', communityId, 'thread_self')));
  await assertFails(setDoc(doc(member, 'community_post_comments', 'thread_cross_post'),
    comment('thread_cross_post', 'thread_post_b', communityId, 'thread_root')));
  await assertFails(setDoc(doc(member, 'community_post_comments', 'thread_cross_group'),
    comment('thread_cross_group', 'thread_post_other', otherCommunityId, 'thread_root')));
  await assertFails(setDoc(doc(outsider, 'community_post_comments', 'thread_unauthorized'),
    { ...comment('thread_unauthorized', 'thread_post_a', communityId, 'thread_root'), authorId: OUTSIDER }));
  await assertSucceeds(deleteDoc(doc(member, 'community_post_comments', 'thread_root')));
  const surviving = await assertSucceeds(getDoc(doc(member, 'community_post_comments', 'thread_reply')));
  if (!surviving.exists()) throw new Error('Uma resposta foi apagada junto com o comentário original.');
});
test('author controls comment permission and pinned comment with validated post scope', async () => {
  const owner = environment.authenticatedContext(OWNER).firestore();
  const member = environment.authenticatedContext(MEMBER).firestore();
  const outsider = environment.authenticatedContext(OUTSIDER).firestore();
  const communityId = 'comments_control';
  await createCommunity(owner, communityId, 'public');
  await joinPublic(member, communityId, MEMBER);

  const makePost = (id: string, allowComments?: unknown, pinnedCommentId?: string) => ({
    postId: id, communityId, authorId: MEMBER, authorName: 'Membro',
    authorAvatar: '', content: 'Publicação de teste', mediaUrls: [],
    ...(allowComments === undefined ? {} : { allowComments }),
    ...(pinnedCommentId === undefined ? {} : { pinnedCommentId }),
    createdAtIso: '2026-11-23T10:00:00.000Z', createdAt: serverTimestamp(),
    updatedAtIso: '2026-11-23T10:00:00.000Z', updatedAt: serverTimestamp(),
  });
  const makeComment = (id: string, postId: string, parentCommentId?: string) => ({
    commentId: id, communityId, postId, authorId: OWNER,
    authorName: 'Criador', authorAvatar: '', text: 'Resposta útil',
    createdAtIso: '2026-11-23T10:01:00.000Z', createdAt: serverTimestamp(),
    ...(parentCommentId ? { parentCommentId } : {}),
  });
  const editPin = (firestore: any, postId: string, commentId: string) =>
    updateDoc(doc(firestore, 'community_posts', postId), {
      pinnedCommentId: commentId,
      updatedAtIso: '2026-11-23T10:04:00.000Z',
      updatedAt: serverTimestamp(),
    });

  await assertSucceeds(setDoc(doc(member, 'community_posts', 'legacy_post'), makePost('legacy_post')));
  await assertSucceeds(setDoc(doc(owner, 'community_post_comments', 'legacy_comment'), makeComment('legacy_comment', 'legacy_post')));
  await assertSucceeds(setDoc(doc(member, 'community_posts', 'closed_post'), makePost('closed_post', false, '')));
  await assertFails(setDoc(doc(owner, 'community_post_comments', 'closed_comment'), makeComment('closed_comment', 'closed_post')));
  await assertFails(setDoc(doc(owner, 'community_post_comments', 'closed_reply'), makeComment('closed_reply', 'closed_post', 'legacy_comment')));
  await assertFails(setDoc(doc(member, 'community_posts', 'invalid_boolean'), makePost('invalid_boolean', 'false')));
  await assertFails(setDoc(doc(member, 'community_posts', 'pre_pinned'), makePost('pre_pinned', true, 'legacy_comment')));
  await assertFails(updateDoc(doc(owner, 'community_posts', 'closed_post'), { allowComments: true, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(member, 'community_posts', 'closed_post'), { allowComments: true, updatedAt: serverTimestamp() }));

  await assertSucceeds(setDoc(doc(owner, 'community_post_comments', 'legit_pin'), makeComment('legit_pin', 'legacy_post')));
  await assertFails(editPin(owner, 'legacy_post', 'legit_pin')); // Community owner is not the post author.
  await assertFails(editPin(outsider, 'legacy_post', 'legit_pin'));
  await assertFails(editPin(member, 'legacy_post', 'missing_comment'));
  await assertFails(editPin(member, 'closed_post', 'legit_pin')); // Other post.
  await assertSucceeds(editPin(member, 'legacy_post', 'legit_pin'));
  const pinned = await assertSucceeds(getDoc(doc(member, 'community_posts', 'legacy_post')));
  if (pinned.data()?.pinnedCommentId !== 'legit_pin') throw new Error('Pinned comment was not persisted.');

  await assertSucceeds(editPin(member, 'legacy_post', 'legacy_comment')); // Replaces previous pin.
  await assertSucceeds(deleteDoc(doc(owner, 'community_post_comments', 'legacy_comment')));
  await assertSucceeds(editPin(member, 'legacy_post', '')); // Unpin even if the comment has been deleted.
  const cleared = await assertSucceeds(getDoc(doc(member, 'community_posts', 'legacy_post')));
  if (cleared.data()?.pinnedCommentId !== '') throw new Error('Pinned comment was not cleared.');
});

test('pending members cannot comment or like in a moderated community', async () => {
  const owner = environment.authenticatedContext(OWNER).firestore();
  const member = environment.authenticatedContext(MEMBER).firestore();
  const communityId = 'interaction_moderated';
  const postId = 'moderated_post';
  await createCommunity(owner, communityId, 'moderated');
  await assertSucceeds(setDoc(doc(owner, 'community_posts', postId), {
    postId, communityId, authorId: OWNER, authorName: 'Criador Kyrub',
    authorAvatar: '', content: 'Apenas membros aprovados.',
    mediaUrls: [], createdAtIso: '2026-11-19T12:00:00.000Z', createdAt: serverTimestamp(),
    updatedAtIso: '2026-11-19T12:00:00.000Z', updatedAt: serverTimestamp(),
  }));
  const membershipId = memberId(communityId, MEMBER);
  await assertSucceeds(setDoc(doc(member, 'community_members', membershipId),
    membershipData(communityId, MEMBER, 'pending')));
  await assertFails(setDoc(doc(member, 'community_post_likes', `${postId}__${MEMBER}`), {
    communityId, postId, userId: MEMBER, createdAt: serverTimestamp(),
  }));
});

test('community publications can be saved privately and unsaved by their owner', async () => {
  const member = environment.authenticatedContext(MEMBER).firestore();
  const outsider = environment.authenticatedContext(OUTSIDER).firestore();
  const savedId = 'community__interaction_post';
  const reference = doc(member, 'users', MEMBER, 'savedItems', savedId);
  await assertSucceeds(setDoc(reference, {
    type: 'publication', sourceKind: 'community', sourceId: 'interaction_post',
    selectionIds: [], savedAtIso: '2026-11-19T12:00:00.000Z',
    savedAt: serverTimestamp(),
  }));
  await assertSucceeds(getDoc(reference));
  await assertFails(getDoc(doc(outsider, 'users', MEMBER, 'savedItems', savedId)));
  await assertSucceeds(deleteDoc(reference));
});

test('a community wall author can remove own post but another participant cannot', async () => {
  const owner = environment.authenticatedContext(OWNER).firestore();
  const member = environment.authenticatedContext(MEMBER).firestore();
  const outsider = environment.authenticatedContext(OUTSIDER).firestore();
  const communityId = 'author_removal_case';
  const postId = 'author_owned_post';
  await createCommunity(owner, communityId, 'public');
  await joinPublic(member, communityId, MEMBER);
  const post = doc(member, 'community_posts', postId);
  await assertSucceeds(setDoc(post, {
    postId, communityId, authorId: MEMBER, authorName: 'Membro',
    authorAvatar: '', content: 'Publicação que seu autor poderá remover.',
    mediaUrls: [], createdAtIso: '2026-11-19T12:00:00.000Z', createdAt: serverTimestamp(),
    updatedAtIso: '2026-11-19T12:00:00.000Z', updatedAt: serverTimestamp(),
  }));
  await assertFails(deleteDoc(doc(outsider, 'community_posts', postId)));
  await assertSucceeds(deleteDoc(post));
  await environment.withSecurityRulesDisabled(async context => {
    const result = await getDoc(doc(context.firestore(), 'community_posts', postId));
    if (result.exists()) throw new Error('Post removido ainda existe no Firestore');
  });
});

test('organic community metrics reuse Praça rules: unique view, active save and completed share receipts', async () => {
  const owner = environment.authenticatedContext(OWNER).firestore();
  const member = environment.authenticatedContext(MEMBER).firestore();
  const outsider = environment.authenticatedContext(OUTSIDER).firestore();
  const communityId = 'organic_metrics_a';
  const postId = 'organic_post';
  await createCommunity(owner, communityId, 'public');
  await joinPublic(member, communityId, MEMBER);
  await assertSucceeds(setDoc(doc(owner, 'community_posts', postId), {
    postId, communityId, authorId: OWNER, authorName: 'Criador',
    authorAvatar: '', content: 'Dados orgânicos auditáveis.', mediaUrls: [],
    createdAtIso: '2026-11-19T12:00:00.000Z', createdAt: serverTimestamp(),
    updatedAtIso: '2026-11-19T12:00:00.000Z', updatedAt: serverTimestamp(),
  }));
  const viewId = `${postId}__view__${MEMBER}`;
  await assertSucceeds(getDoc(doc(member, 'community_post_engagements', viewId))); // Uncreated own receipt is readable.
  const engagement = (id: string, type: 'view' | 'save' | 'share') => ({
    engagementId: id, communityId, postId, postAuthorId: OWNER,
    actorId: MEMBER, type, createdAt: serverTimestamp(),
  });
  await assertSucceeds(setDoc(doc(member, 'community_post_engagements', viewId), engagement(viewId, 'view')));
  await assertFails(setDoc(doc(member, 'community_post_engagements', viewId), engagement(viewId, 'view')));
  await assertFails(setDoc(doc(outsider, 'community_post_engagements', viewId), engagement(viewId, 'view')));
  await assertSucceeds(getDoc(doc(owner, 'community_post_engagements', viewId)));
  await assertSucceeds(getDocs(query(collection(owner, 'community_post_engagements'), where('postAuthorId', '==', OWNER))));
  await assertFails(getDoc(doc(outsider, 'community_post_engagements', viewId)));

  const saveId = `${postId}__save__${MEMBER}`;
  const savedRef = doc(member, 'users', MEMBER, 'savedItems', 'community__' + postId);
  const saveRef = doc(member, 'community_post_engagements', saveId);
  await assertSucceeds(runTransaction(member, async tx => {
    tx.set(savedRef, {
      type: 'publication', sourceKind: 'community', sourceId: postId,
      selectionIds: [], savedAtIso: '2026-11-19T12:01:00.000Z', savedAt: serverTimestamp(),
    });
    tx.set(saveRef, engagement(saveId, 'save'));
  }));
  await assertSucceeds(getDoc(savedRef));
  await assertSucceeds(getDoc(saveRef));
  await assertSucceeds(runTransaction(member, async tx => {
    tx.delete(savedRef);
    tx.delete(saveRef);
  }));
  if ((await getDoc(saveRef)).exists()) throw new Error('Salvamento ainda contabilizado depois de remover dos Salvos.');

  const shareA = doc(member, 'community_post_engagements', 'share_action_01');
  const shareB = doc(member, 'community_post_engagements', 'share_action_02');
  await assertSucceeds(setDoc(shareA, engagement(shareA.id, 'share')));
  await assertSucceeds(setDoc(shareB, engagement(shareB.id, 'share')));
  await assertFails(deleteDoc(shareA)); // Only active saves may be deleted by the user.
  await assertFails(setDoc(doc(member, 'community_post_engagements', 'forged_author'), {
    ...engagement('forged_author', 'share'), postAuthorId: OUTSIDER,
  }));
  await assertFails(setDoc(doc(member, 'community_post_engagements', 'wrong_unique_id'), engagement('wrong_unique_id', 'view')));
});

test('private community organic views cannot be collected from outsiders', async () => {
  const owner = environment.authenticatedContext(OWNER).firestore();
  const outsider = environment.authenticatedContext(OUTSIDER).firestore();
  const communityId = 'private_metrics';
  const postId = 'private_post_metrics';
  await createCommunity(owner, communityId, 'private');
  await assertSucceeds(setDoc(doc(owner, 'community_posts', postId), {
    postId, communityId, authorId: OWNER, authorName: 'Criador',
    authorAvatar: '', content: 'Privada.', mediaUrls: [],
    createdAtIso: '2026-11-19T12:00:00.000Z', createdAt: serverTimestamp(),
    updatedAtIso: '2026-11-19T12:00:00.000Z', updatedAt: serverTimestamp(),
  }));
  const receiptId = `${postId}__view__${OUTSIDER}`;
  await assertFails(setDoc(doc(outsider, 'community_post_engagements', receiptId), {
    engagementId: receiptId, communityId, postId, postAuthorId: OWNER,
    actorId: OUTSIDER, type: 'view', createdAt: serverTimestamp(),
  }));
});

test('public community publication creates one canonical Praça pointer atomically', async () => {
  const owner = environment.authenticatedContext(OWNER).firestore();
  const reader = environment.authenticatedContext(OUTSIDER).firestore();
  const communityId = 'square_public';
  const postId = 'square_original';
  await createCommunity(owner, communityId, 'public');
  const batch = writeBatch(owner);
  batch.set(doc(owner, 'community_posts', postId), {
    postId, communityId, authorId: OWNER, authorName: 'Criador Kyrub', authorAvatar: '',
    content: 'Apenas uma publicação original.', mediaUrls: [],
    createdAtIso: new Date().toISOString(), createdAt: serverTimestamp(),
    updatedAtIso: new Date().toISOString(), updatedAt: serverTimestamp(),
  });
  batch.set(doc(owner, 'community_square_posts', postId), {
    postId, communityId, createdAt: serverTimestamp(),
  });
  await assertSucceeds(batch.commit());
  await assertSucceeds(getDoc(doc(reader, 'community_square_posts', postId)));
  await assertSucceeds(getDoc(doc(reader, 'community_posts', postId)));
  await assertFails(setDoc(doc(owner, 'community_square_posts', postId), {
    postId, communityId, createdAt: serverTimestamp(),
  })); // No duplicate/replay of existing distribution document.
  await assertFails(updateDoc(doc(owner, 'community_square_posts', postId), { communityId: 'other' }));
  await assertFails(deleteDoc(doc(reader, 'community_square_posts', postId)));
  await assertSucceeds(deleteDoc(doc(owner, 'community_square_posts', postId)));
  await assertSucceeds(getDoc(doc(reader, 'community_posts', postId))); // Opt-out keeps source intact.
});

test('Praça pointer rejects unauthorized authors, forged sources and private/moderated communities', async () => {
  const owner = environment.authenticatedContext(OWNER).firestore();
  const outsider = environment.authenticatedContext(OUTSIDER).firestore();
  for (const visibility of ['private', 'moderated'] as const) {
    const communityId = `square_${visibility}`;
    const postId = `post_${visibility}`;
    await createCommunity(owner, communityId, visibility);
    const batch = writeBatch(owner);
    batch.set(doc(owner, 'community_posts', postId), {
      postId, communityId, authorId: OWNER, authorName: 'Criador Kyrub', authorAvatar: '',
      content: 'Não deve aparecer na Praça.', mediaUrls: [],
      createdAtIso: new Date().toISOString(), createdAt: serverTimestamp(),
      updatedAtIso: new Date().toISOString(), updatedAt: serverTimestamp(),
    });
    batch.set(doc(owner, 'community_square_posts', postId), {
      postId, communityId, createdAt: serverTimestamp(),
    });
    await assertFails(batch.commit());
    await assertSucceeds(setDoc(doc(owner, 'community_posts', postId), {
      postId, communityId, authorId: OWNER, authorName: 'Criador Kyrub', authorAvatar: '',
      content: 'Fica somente na comunidade.', mediaUrls: [],
      createdAtIso: new Date().toISOString(), createdAt: serverTimestamp(),
      updatedAtIso: new Date().toISOString(), updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(owner, 'community_square_posts', postId), {
      postId, communityId, createdAt: serverTimestamp(),
    }));
    if (visibility === 'private') await assertFails(getDoc(doc(outsider, 'community_posts', postId)));
    else await assertSucceeds(getDoc(doc(outsider, 'community_posts', postId))); // Moderated walls are readable, not auto-distributed.
  }
  await createCommunity(owner, 'square_forgery', 'public');
  const forged = {
    postId: 'missing_post', communityId: 'square_forgery',
    createdAt: serverTimestamp(),
  };
  await assertFails(setDoc(doc(owner, 'community_square_posts', 'missing_post'), forged));
  await assertFails(setDoc(doc(outsider, 'community_square_posts', 'missing_post'), forged));

  // A valid public source cannot be syndicated by a person other than its author.
  const sourcePostId = 'owned_source';
  await assertSucceeds(setDoc(doc(owner, 'community_posts', sourcePostId), {
    postId: sourcePostId, communityId: 'square_forgery', authorId: OWNER,
    authorName: 'Criador', authorAvatar: '', content: 'Público, mas somente o autor distribui.',
    mediaUrls: [], createdAtIso: new Date().toISOString(), createdAt: serverTimestamp(),
    updatedAtIso: new Date().toISOString(), updatedAt: serverTimestamp(),
  }));
  const source = await getDoc(doc(owner, 'community_posts', sourcePostId));
  const syndication = {
    postId: sourcePostId, communityId: 'square_forgery', createdAt: source.data()!.createdAt,
  };
  await assertFails(setDoc(doc(outsider, 'community_square_posts', sourcePostId), syndication));
  await assertSucceeds(setDoc(doc(owner, 'community_square_posts', sourcePostId), syndication));
});

test('switching a public community to private revokes the original content despite a stale pointer', async () => {
  const owner = environment.authenticatedContext(OWNER).firestore();
  const reader = environment.authenticatedContext(OUTSIDER).firestore();
  const communityId = 'square_revoke';
  const postId = 'revoked_post';
  await createCommunity(owner, communityId, 'public');
  const batch = writeBatch(owner);
  batch.set(doc(owner, 'community_posts', postId), {
    postId, communityId, authorId: OWNER, authorName: 'Criador Kyrub', authorAvatar: '',
    content: 'Não pode vazar após alterar a privacidade.', mediaUrls: [],
    createdAtIso: new Date().toISOString(), createdAt: serverTimestamp(),
    updatedAtIso: new Date().toISOString(), updatedAt: serverTimestamp(),
  });
  batch.set(doc(owner, 'community_square_posts', postId), {
    postId, communityId, createdAt: serverTimestamp(),
  });
  await assertSucceeds(batch.commit());
  await environment.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'communities', communityId), { visibility: 'private' });
  });
  await assertSucceeds(getDoc(doc(reader, 'community_square_posts', postId))); // Harmless pointer metadata.
  await assertFails(getDoc(doc(reader, 'community_posts', postId))); // Source is no longer public.
  await assertFails(getDoc(doc(reader, 'communities', communityId)));
});

test('creator can edit community display metadata without changing identity, visibility or membership', async () => {
  const owner = environment.authenticatedContext(OWNER).firestore();
  const outsider = environment.authenticatedContext(OUTSIDER).firestore();
  const communityId = 'editable_community';
  await createCommunity(owner, communityId, 'public');

  const original = await getDoc(doc(owner, 'communities', communityId));
  if (!original.exists()) throw new Error('Comunidade de teste não encontrada.');
  const originalId = original.data().communityId;
  const originalCreatedAt = original.data().createdAt.toMillis();

  const ownerEdit = {
    name: 'Nação Renomeada',
    description: 'Nova apresentação legítima da mesma comunidade.',
    category: 'Música',
    location: 'São Paulo',
    rules: 'Respeite o tema, participantes e regras de convivência.',
    updatedAtIso: new Date().toISOString(),
    updatedAt: serverTimestamp(),
    activityAtIso: new Date().toISOString(),
    activityAt: serverTimestamp(),
  };

  await assertSucceeds(updateDoc(doc(owner, 'communities', communityId), ownerEdit));
  const updated = await assertSucceeds(getDoc(doc(outsider, 'communities', communityId)));
  if (updated.data()?.name !== ownerEdit.name || updated.data()?.description !== ownerEdit.description
    || updated.data()?.category !== ownerEdit.category || updated.data()?.location !== ownerEdit.location
    || updated.data()?.rules !== ownerEdit.rules) {
    throw new Error('As novas informações públicas não foram persistidas.');
  }
  if (updated.data()?.communityId !== originalId || updated.data()?.createdAt.toMillis() !== originalCreatedAt
    || updated.data()?.ownerId !== OWNER || updated.data()?.visibility !== 'public'
    || updated.data()?.memberCount !== 1) {
    throw new Error('A identidade ou os participantes foram alterados por uma edição de metadados.');
  }
  await assertSucceeds(getDoc(doc(owner, 'community_members', memberId(communityId, OWNER))));

  await assertFails(updateDoc(doc(outsider, 'communities', communityId), {
    ...ownerEdit, name: 'Sequestro de nome',
  }));
  await assertFails(updateDoc(doc(owner, 'communities', communityId), {
    ...ownerEdit, name: '',
  }));
  await assertFails(updateDoc(doc(owner, 'communities', communityId), {
    ...ownerEdit, name: 'x'.repeat(81),
  }));
  await assertFails(updateDoc(doc(owner, 'communities', communityId), {
    ...ownerEdit, visibility: 'private',
  }));
  await assertFails(updateDoc(doc(owner, 'communities', communityId), {
    ...ownerEdit, ownerId: OUTSIDER,
  }));
  await assertFails(updateDoc(doc(owner, 'communities', communityId), {
    ...ownerEdit, communityId: 'different_community',
  }));
  await assertFails(updateDoc(doc(owner, 'communities', communityId), {
    ...ownerEdit, memberCount: 200,
  }));
});

test('another Kairubido can forward a public original into Praça once per 24h, not clone it', async () => {
  const owner = environment.authenticatedContext(OWNER).firestore();
  const actor = environment.authenticatedContext(MEMBER).firestore();
  const other = environment.authenticatedContext(OUTSIDER).firestore();
  const communityId = 'forward_public';
  const postId = 'original_to_forward';
  await createCommunity(owner, communityId, 'public');
  await assertSucceeds(setDoc(doc(owner, 'community_posts', postId), {
    postId, communityId, authorId: OWNER, authorName: 'Criador', authorAvatar: '',
    content: 'Texto da publicação original.', mediaUrls: [],
    createdAtIso: '2026-11-10T00:00:00.000Z', createdAt: serverTimestamp(),
    updatedAtIso: '2026-11-10T00:00:00.000Z', updatedAt: serverTimestamp(),
  }));

  const ref = doc(actor, 'community_square_forwards', postId + '__' + MEMBER);
  const forward = {
    postId, communityId, actorId: MEMBER, actorName: 'Membro conectado',
    forwardedAt: serverTimestamp(),
  };
  await assertSucceeds(setDoc(ref, forward));
  await assertSucceeds(getDoc(doc(other, 'community_square_forwards', ref.id)));
  await assertFails(updateDoc(ref, { forwardedAt: serverTimestamp() })); // 24h anti-spam.
  await assertFails(setDoc(ref, forward)); // Cannot overwrite to bypass cooldown.
  await assertFails(updateDoc(doc(other, 'community_square_forwards', ref.id), {
    forwardedAt: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(other, 'community_square_forwards', postId + '__' + MEMBER), {
    ...forward, actorId: OUTSIDER,
  }));
  await assertFails(setDoc(doc(actor, 'community_square_forwards', postId + '__' + MEMBER + '_fake'), forward));
  await assertFails(updateDoc(ref, { actorName: 'Outro usuário' }));

  // The original post, author and metrics remain canonical and untouched.
  const original = await assertSucceeds(getDoc(doc(actor, 'community_posts', postId)));
  if (original.data()?.authorId !== OWNER || original.data()?.content !== 'Texto da publicação original.') {
    throw new Error('Encaminhamento alterou a publicação original.');
  }

  // The server permits a new forward only after the previous 24h period.
  await environment.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'community_square_forwards', ref.id), {
      forwardedAt: Timestamp.fromMillis(Date.now() - 25 * 60 * 60 * 1000),
    });
  });
  await assertSucceeds(updateDoc(ref, { forwardedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { forwardedAt: serverTimestamp() }));
});

test('forwarding a private or moderated post and impersonating the sender is denied', async () => {
  const owner = environment.authenticatedContext(OWNER).firestore();
  const actor = environment.authenticatedContext(MEMBER).firestore();
  for (const visibility of ['private', 'moderated'] as const) {
    const communityId = 'forward_' + visibility;
    const postId = 'forward_post_' + visibility;
    await createCommunity(owner, communityId, visibility);
    await assertSucceeds(setDoc(doc(owner, 'community_posts', postId), {
      postId, communityId, authorId: OWNER, authorName: 'Criador', authorAvatar: '',
      content: 'Este conteúdo não pode ser encaminhado para o público.', mediaUrls: [],
      createdAtIso: new Date().toISOString(), createdAt: serverTimestamp(),
      updatedAtIso: new Date().toISOString(), updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(actor, 'community_square_forwards', postId + '__' + MEMBER), {
      postId, communityId, actorId: MEMBER, actorName: 'Membro',
      forwardedAt: serverTimestamp(),
    }));
  }
  await assertFails(setDoc(doc(actor, 'community_square_forwards', 'does_not_exist__' + MEMBER), {
    postId: 'does_not_exist', communityId: 'forward_private',
    actorId: MEMBER, actorName: 'Membro', forwardedAt: serverTimestamp(),
  }));
});

test('private forward to a connected Kairubido is atomic and rate limited per post/person for 24 hours', async () => {
  const owner = environment.authenticatedContext(OWNER).firestore();
  const sender = environment.authenticatedContext(MEMBER).firestore();
  const other = environment.authenticatedContext(OUTSIDER).firestore();
  const communityId = 'private_forward_public_origin';
  const postId = 'source_public_dm';
  const connectionId = 'accepted_forward_pair';
  await createCommunity(owner, communityId, 'public');
  await assertSucceeds(setDoc(doc(owner, 'community_posts', postId), {
    postId, communityId, authorId: OWNER, authorName: 'Autor', authorAvatar: '',
    content: 'Encaminhar sem duplicar.', mediaUrls: [],
    createdAtIso: '2026-11-20T09:00:00.000Z', createdAt: serverTimestamp(),
    updatedAtIso: '2026-11-20T09:00:00.000Z', updatedAt: serverTimestamp(),
  }));
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'connections', connectionId), {
      senderId: MEMBER, receiverId: OUTSIDER, participantIds: [MEMBER, OUTSIDER],
      status: 'accepted',
    });
  });
  const receiptId = postId + '__' + MEMBER + '__' + OUTSIDER;
  const receiptRef = doc(sender, 'community_direct_forward_receipts', receiptId);
  const send = (messageId: string) => runTransaction(sender, async tx => {
    const existing = await tx.get(receiptRef);
    const messageRef = doc(sender, 'social_chats', connectionId, 'messages', messageId);
    tx.set(messageRef, {
      senderId: MEMBER, receiverId: OUTSIDER,
      text: 'Encaminhando esta publicação pelo Kyrub.',
      createdAt: serverTimestamp(),
    });
    if (existing.exists()) {
      tx.update(receiptRef, { messageId, forwardedAt: serverTimestamp() });
    } else {
      tx.set(receiptRef, {
        postId, communityId, actorId: MEMBER, receiverId: OUTSIDER, connectionId,
        messageId, forwardedAt: serverTimestamp(),
      });
    }
  });

  await assertSucceeds(send('message_first'));
  await assertSucceeds(getDoc(doc(other, 'social_chats', connectionId, 'messages', 'message_first')));
  await assertFails(send('message_repeat'));
  const blockedMessage = await assertSucceeds(getDoc(doc(other, 'social_chats', connectionId, 'messages', 'message_repeat')));
  if (blockedMessage.exists()) throw new Error('Um envio bloqueado não pode criar mensagem.');
  await assertFails(getDoc(doc(other, 'community_direct_forward_receipts', receiptId)));
  await assertFails(getDocs(collection(sender, 'community_direct_forward_receipts')));

  await environment.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'community_direct_forward_receipts', receiptId), {
      forwardedAt: Timestamp.fromMillis(Date.now() - 25 * 60 * 60 * 1000),
    });
  });
  await assertSucceeds(send('message_after_24h'));
  await assertFails(send('message_after_24h_duplicate'));

  const source = await getDoc(doc(sender, 'community_posts', postId));
  if (source.data()?.authorId !== OWNER || source.data()?.content !== 'Encaminhar sem duplicar.') {
    throw new Error('O encaminhamento duplicou ou alterou a publicação original.');
  }
});

test('private forward receipt cannot fake connection, source or recipient', async () => {
  const owner = environment.authenticatedContext(OWNER).firestore();
  const sender = environment.authenticatedContext(MEMBER).firestore();
  await createCommunity(owner, 'forward_protected_private', 'private');
  const postId = 'forward_protected_post';
  await assertSucceeds(setDoc(doc(owner, 'community_posts', postId), {
    postId, communityId: 'forward_protected_private', authorId: OWNER,
    authorName: 'Autor', authorAvatar: '', content: 'Conteúdo protegido', mediaUrls: [],
    createdAtIso: '2026-11-20T09:00:00.000Z', createdAt: serverTimestamp(),
    updatedAtIso: '2026-11-20T09:00:00.000Z', updatedAt: serverTimestamp(),
  }));
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'connections', 'forward_private_link'), {
      senderId: MEMBER, receiverId: OUTSIDER, participantIds: [MEMBER, OUTSIDER],
      status: 'accepted',
    });
  });
  const receipt = doc(sender, 'community_direct_forward_receipts', postId + '__' + MEMBER + '__' + OUTSIDER);
  await assertFails(runTransaction(sender, async tx => {
    await tx.get(receipt);
    tx.set(doc(sender, 'social_chats', 'forward_private_link', 'messages', 'message_private'), {
      senderId: MEMBER, receiverId: OUTSIDER, text: 'Inadequado', createdAt: serverTimestamp(),
    });
    tx.set(receipt, {
      postId, communityId: 'forward_protected_private', actorId: MEMBER,
      receiverId: OUTSIDER, connectionId: 'forward_private_link',
      messageId: 'message_private', forwardedAt: serverTimestamp(),
    });
  }));
  const blockedPrivateMessage = await assertSucceeds(getDoc(doc(sender, 'social_chats', 'forward_private_link', 'messages', 'message_private')));
  if (blockedPrivateMessage.exists()) throw new Error('Encaminhamento privado foi publicado sem autorização.');
});

test('fresh public join transaction reads own missing membership, creates it once and increments memberCount', async () => {
  const owner = environment.authenticatedContext(OWNER).firestore();
  const visitor = environment.authenticatedContext(MEMBER).firestore();
  const other = environment.authenticatedContext(OUTSIDER).firestore();
  const communityId = 'join_fresh_public';
  const selfId = memberId(communityId, MEMBER);
  await createCommunity(owner, communityId, 'public');

  const missing = await assertSucceeds(getDoc(doc(visitor, 'community_members', selfId)));
  if (missing.exists()) throw new Error('O novo participante já tinha um registro.');
  await assertFails(getDoc(doc(visitor, 'community_members', memberId(communityId, OUTSIDER))));

  const join = () => runTransaction(visitor, async tx => {
    const communityRef = doc(visitor, 'communities', communityId);
    const membershipRef = doc(visitor, 'community_members', selfId);
    const [community, existing] = await Promise.all([
      tx.get(communityRef), tx.get(membershipRef),
    ]);
    if (existing.exists()) return;
    if (!community.exists()) throw new Error('Comunidade não encontrada.');
    const nowIso = new Date().toISOString();
    tx.set(membershipRef, {
      membershipId: selfId, communityId, userId: MEMBER,
      userName: 'Participante', userAvatar: '', role: 'member', status: 'active',
      joinedAtIso: nowIso, joinedAt: serverTimestamp(),
      updatedAtIso: nowIso, updatedAt: serverTimestamp(),
    });
    tx.update(communityRef, {
      memberCount: community.data().memberCount + 1,
      lastMembershipChangeId: selfId,
      updatedAtIso: nowIso, updatedAt: serverTimestamp(),
      activityAtIso: nowIso, activityAt: serverTimestamp(),
    });
  });

  await assertSucceeds(join());
  await assertSucceeds(join()); // Repeated click is idempotent.
  const joined = await assertSucceeds(getDoc(doc(visitor, 'community_members', selfId)));
  const community = await assertSucceeds(getDoc(doc(other, 'communities', communityId)));
  if (joined.data()?.status !== 'active' || community.data()?.memberCount !== 2) {
    throw new Error('O membro não foi ativado exatamente uma vez.');
  }
  await assertSucceeds(getDoc(doc(other, 'community_members', selfId)));
});

test('pending memberships remain private to applicant and community owner', async () => {
  const owner = environment.authenticatedContext(OWNER).firestore();
  const applicant = environment.authenticatedContext(MEMBER).firestore();
  const visitor = environment.authenticatedContext(OUTSIDER).firestore();
  const communityId = 'join_pending_moderated';
  const pendingId = memberId(communityId, MEMBER);
  await createCommunity(owner, communityId, 'moderated');

  await assertSucceeds(runTransaction(applicant, async tx => {
    const community = await tx.get(doc(applicant, 'communities', communityId));
    const pendingRef = doc(applicant, 'community_members', pendingId);
    const missing = await tx.get(pendingRef);
    if (!community.exists() || missing.exists()) throw new Error('Estado inválido.');
    const nowIso = new Date().toISOString();
    tx.set(pendingRef, {
      membershipId: pendingId, communityId, userId: MEMBER,
      userName: 'Participante', userAvatar: '', role: 'member', status: 'pending',
      joinedAtIso: nowIso, joinedAt: serverTimestamp(),
      updatedAtIso: nowIso, updatedAt: serverTimestamp(),
    });
  }));
  await assertSucceeds(getDoc(doc(applicant, 'community_members', pendingId)));
  await assertSucceeds(getDoc(doc(owner, 'community_members', pendingId)));
  await assertFails(getDoc(doc(visitor, 'community_members', pendingId)));
  const ownerList = await assertSucceeds(
    getDocs(query(collection(owner, 'community_members'), where('communityId', '==', communityId))),
  );
  if (!ownerList.docs.some(item => item.id === pendingId)) {
    throw new Error('O criador não consegue administrar solicitações pendentes.');
  }
  await assertFails(
    getDocs(query(collection(visitor, 'community_members'), where('communityId', '==', communityId))),
  );
});

test('wall publication receipt is atomic, author-only, and prevents resurrection after removal', async () => {
  const owner = environment.authenticatedContext(OWNER).firestore();
  const outsider = environment.authenticatedContext(OUTSIDER).firestore();
  const anonymous = environment.unauthenticatedContext().firestore();
  const communityId = 'wall_receipt_case';
  const postId = 'wall_12345678-1234-1234-1234-123456789abc';
  const receiptPath = 'community_wall_publish_receipts';
  const post = doc(owner, 'community_posts', postId);
  const receipt = doc(owner, receiptPath, postId);
  const pointer = doc(owner, 'community_square_posts', postId);
  await createCommunity(owner, communityId, 'public');
  const postData = () => ({
    postId, communityId, authorId: OWNER, authorName: 'Criador Kyrub', authorAvatar: '',
    content: 'Uma única publicação.', mediaUrls: [], allowComments: true, pinnedCommentId: '',
    createdAtIso: '2026-11-25T00:00:00.000Z', createdAt: serverTimestamp(),
    updatedAtIso: '2026-11-25T00:00:00.000Z', updatedAt: serverTimestamp(),
  });
  const receiptData = () => ({postId, communityId, authorId: OWNER, requestHash: 'a'.repeat(64), createdAt: serverTimestamp()});
  const missing = await assertSucceeds(getDoc(receipt));
  if (missing.exists()) throw Error('receipt should not exist');
  await assertFails(getDoc(doc(anonymous, receiptPath, postId)));
  await assertFails(setDoc(post, postData()));
  await assertFails(setDoc(receipt, receiptData()));
  const malformed = writeBatch(owner);
  malformed.set(post,postData());
  malformed.set(receipt,{...receiptData(),communityId:'different_community'});
  malformed.set(pointer,{postId,communityId,createdAt:serverTimestamp()});
  await assertFails(malformed.commit());
  await environment.withSecurityRulesDisabled(async ctx=>{
    for(const path of ['community_posts',receiptPath,'community_square_posts']){
      if((await getDoc(doc(ctx.firestore(),path,postId))).exists())throw Error('partial invalid atomic write');
    }
  });
  const publish = () => runTransaction(owner, async tx => {
    const previous = await tx.get(receipt);
    if (previous.exists()) return 'replay';
    tx.set(post, postData());
    tx.set(receipt, receiptData());
    tx.set(pointer, {postId, communityId, createdAt: serverTimestamp()});
    return 'created';
  });
  // Isolate authorization of the first atomic write from concurrent retries.
  if (await assertSucceeds(publish()) !== 'created') throw Error('first atomic commit must succeed');
  const results = await Promise.all([publish(), publish()]);
  if (results.some(x => x !== 'replay')) throw Error('expected two read-only replays after commit');
  const first = await assertSucceeds(getDoc(receipt));
  if (!first.exists()) throw Error('missing atomic receipt');
  await assertSucceeds(getDoc(post));
  await assertSucceeds(getDoc(pointer));
  await assertFails(getDoc(doc(outsider, receiptPath, postId)));
  await assertFails(getDocs(collection(owner, receiptPath)));
  await assertFails(updateDoc(receipt, {requestHash: 'b'.repeat(64)}));
  await assertFails(deleteDoc(receipt));
  await assertSucceeds(deleteDoc(pointer));
  await assertSucceeds(deleteDoc(post));
  if (await publish() !== 'replay') throw Error('receipt must prevent resurrection');
  await assertFails(setDoc(post, postData()));
  await environment.withSecurityRulesDisabled(async ctx => {
    if ((await getDoc(doc(ctx.firestore(), 'community_posts', postId))).exists()) throw Error('post resurrected');
    if ((await getDoc(doc(ctx.firestore(), 'community_square_posts', postId))).exists()) throw Error('pointer resurrected');
  });
});

test('wall receipt concurrent first publication never commits more than one original',async()=>{
  const owner=environment.authenticatedContext(OWNER).firestore();
  const communityId='wall_receipt_concurrent';
  const postId='wall_abcdef12-1234-1234-1234-123456789abc';
  await createCommunity(owner,communityId,'public');
  const receipt=doc(owner,'community_wall_publish_receipts',postId);
  const source=doc(owner,'community_posts',postId);
  const pointer=doc(owner,'community_square_posts',postId);
  const publish=()=>runTransaction(owner,async tx=>{
    const previous=await tx.get(receipt);
    if(previous.exists())return 'replay';
    tx.set(source,{postId,communityId,authorId:OWNER,authorName:'Criador',authorAvatar:'',content:'Publicação concorrente',mediaUrls:[],allowComments:true,pinnedCommentId:'',createdAtIso:'2026-11-25T00:00:00.000Z',updatedAtIso:'2026-11-25T00:00:00.000Z',createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    tx.set(receipt,{postId,communityId,authorId:OWNER,requestHash:'a'.repeat(64),createdAt:serverTimestamp()});
    tx.set(pointer,{postId,communityId,createdAt:serverTimestamp()});
    return 'created';
  });
  const result=await Promise.allSettled([publish(),publish()]);
  if(result.filter(x=>x.status==='fulfilled'&&x.value==='created').length!==1)throw Error('expected exactly one initial commit');
  for(const item of result)if(item.status==='rejected'&&!['permission-denied','aborted'].includes(item.reason?.code))throw item.reason;
  if(await publish()!=='replay')throw Error('retry must be idempotent');
  for(const item of [source,receipt,pointer])if(!(await assertSucceeds(getDoc(item))).exists())throw Error('atomic publication missing a document');
});

test('receipt publication preserves private and moderated visibility and public opt-out', async () => {
  const owner=environment.authenticatedContext(OWNER).firestore();
  const outsider=environment.authenticatedContext(OUTSIDER).firestore();
  for(const [index,visibility] of (['private','moderated','public'] as const).entries()){
    const communityId='wall_receipt_visibility_'+visibility;
    const postId='wall_87654321-1234-1234-1234-123456789ab'+index;
    await createCommunity(owner,communityId,visibility);
    const post=doc(owner,'community_posts',postId);
    const receipt=doc(owner,'community_wall_publish_receipts',postId);
    const pointer=doc(owner,'community_square_posts',postId);
    const payload=()=>({postId,communityId,authorId:OWNER,authorName:'Criador',authorAvatar:'',content:'Somente no mural',mediaUrls:[],allowComments:true,pinnedCommentId:'',createdAtIso:'2026-11-25T00:00:00.000Z',updatedAtIso:'2026-11-25T00:00:00.000Z',createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    const receiptData=()=>({postId,communityId,authorId:OWNER,requestHash:'b'.repeat(64),createdAt:serverTimestamp()});
    if(visibility!=='public'){
      const denied=writeBatch(owner);
      denied.set(post,payload());denied.set(receipt,receiptData());denied.set(pointer,{postId,communityId,createdAt:serverTimestamp()});
      await assertFails(denied.commit());
      if((await assertSucceeds(getDoc(receipt))).exists())throw Error('partial receipt on denied distribution');
    }
    await assertSucceeds(runTransaction(owner,async tx=>{
      const prior=await tx.get(receipt);
      if(prior.exists())throw Error('unexpected receipt');
      tx.set(post,payload());tx.set(receipt,receiptData());
    }));
    if(!(await assertSucceeds(getDoc(post))).exists()||!(await assertSucceeds(getDoc(receipt))).exists())throw Error('missing source or receipt');
    if((await assertSucceeds(getDoc(pointer))).exists())throw Error('opt-out or private source leaked to Praça');
    await assertFails(getDoc(doc(outsider,'community_wall_publish_receipts',postId)));
    if(visibility==='private')await assertFails(getDoc(doc(outsider,'community_posts',postId)));
    else await assertSucceeds(getDoc(doc(outsider,'community_posts',postId)));
    const source=await getDoc(post);
    const distribution={postId,communityId,createdAt:source.data()!.createdAt};
    if(visibility==='public'){
      await assertSucceeds(setDoc(pointer,distribution));
      await assertSucceeds(deleteDoc(pointer));
      await assertSucceeds(getDoc(post));
    }else await assertFails(setDoc(pointer,distribution));
  }
});


test('staged community age gate protects wall, square and comments without replacing membership checks', async () => {
  const owner=environment.authenticatedContext(OWNER).firestore();
  const member=environment.authenticatedContext(MEMBER).firestore();
  const outsider=environment.authenticatedContext(OUTSIDER).firestore();
  const id='age_gate_community',postId='age_gate_post';
  await createCommunity(owner,id,'public');
  await joinPublic(member,id,MEMBER);
  const writeAge=async(uid:string,status:string)=>{
    await environment.withSecurityRulesDisabled(async context=>{
      await setDoc(doc(context.firestore(),'age_eligibility_private',uid),{uid,status});
    });
  };
  await environment.withSecurityRulesDisabled(async context=>{
    await setDoc(doc(context.firestore(),'social_age_release_private','current'),{schemaVersion:1,mode:'verified_adult_only'});
  });
  const post=(authorId:string)=>({postId,communityId:id,authorId,authorName:'Membro',authorAvatar:'',
    content:'Mural de teste',mediaUrls:[],createdAtIso:'2026-11-25T12:00:00Z',createdAt:serverTimestamp(),
    updatedAtIso:'2026-11-25T12:00:00Z',updatedAt:serverTimestamp()});
  await assertFails(setDoc(doc(member,'community_posts',postId),post(MEMBER)));
  await writeAge(MEMBER,'verified_adult');
  await writeAge(OUTSIDER,'verified_adult');
  await assertFails(setDoc(doc(outsider,'community_posts',postId),post(OUTSIDER)));
  await assertSucceeds(setDoc(doc(member,'community_posts',postId),post(MEMBER)));
  const commentId='age_gate_comment';
  const comment=()=>({commentId,communityId:id,postId,authorId:MEMBER,authorName:'Membro',authorAvatar:'',
    text:'Comentario de teste',createdAtIso:'2026-11-25T12:00:00Z',createdAt:serverTimestamp()});
  await writeAge(MEMBER,'inconclusive');
  await assertFails(setDoc(doc(member,'community_post_comments',commentId),comment()));
  await assertFails(setDoc(doc(member,'community_square_posts',postId),{postId,communityId:id,createdAt:serverTimestamp()}));
  await writeAge(MEMBER,'verified_adult');
  await assertSucceeds(setDoc(doc(member,'community_post_comments',commentId),comment()));
  await writeAge(MEMBER,'suspended');
  await assertSucceeds(deleteDoc(doc(member,'community_post_comments',commentId)));
  await assertSucceeds(deleteDoc(doc(member,'community_posts',postId)));
});


test('staged eligibility governs community creation and admission without blocking departure', async()=>{
  const owner=environment.authenticatedContext(OWNER).firestore();
  const member=environment.authenticatedContext(MEMBER).firestore();
  const id='age_admission',moderated='age_moderated';
  const age=async(uid:string,status:string)=>{
    await environment.withSecurityRulesDisabled(async context=>{
      await setDoc(doc(context.firestore(),'age_eligibility_private',uid),{uid,status});
    });
  };
  await environment.withSecurityRulesDisabled(async context=>{
    await setDoc(doc(context.firestore(),'social_age_release_private','current'),{schemaVersion:1,mode:'verified_adult_only'});
  });
  await assertFails(createCommunity(owner,id,'public'));
  await age(OWNER,'verified_adult');
  await assertSucceeds(createCommunity(owner,id,'public'));
  await assertFails(joinPublic(member,id,MEMBER));
  await age(MEMBER,'verified_adult');
  await assertSucceeds(joinPublic(member,id,MEMBER));
  await assertSucceeds(createCommunity(owner,moderated,'moderated'));
  const pending=doc(member,'community_members',memberId(moderated,MEMBER));
  await assertSucceeds(setDoc(pending,membershipData(moderated,MEMBER,'pending')));
  const approve=()=>{
    const batch=writeBatch(owner);
    batch.update(doc(owner,'community_members',memberId(moderated,MEMBER)),{
      status:'active',updatedAtIso:'2026-11-25T12:01:00Z',updatedAt:serverTimestamp()
    });
    batch.update(doc(owner,'communities',moderated),{
      memberCount:2,lastMembershipChangeId:memberId(moderated,MEMBER),
      updatedAtIso:'2026-11-25T12:01:00Z',updatedAt:serverTimestamp(),
      activityAtIso:'2026-11-25T12:01:00Z',activityAt:serverTimestamp()
    });
    return batch.commit();
  };
  await age(MEMBER,'suspended');
  await assertFails(approve());
  await age(MEMBER,'verified_adult');
  await age(OWNER,'suspended');
  await assertFails(approve());
  await age(OWNER,'verified_adult');
  await assertSucceeds(approve());
  await age(MEMBER,'suspended');
  const departure=writeBatch(member);
  departure.delete(doc(member,'community_members',memberId(id,MEMBER)));
  departure.update(doc(member,'communities',id),{
    memberCount:1,lastMembershipChangeId:memberId(id,MEMBER),
    updatedAtIso:'2026-11-25T12:02:00Z',updatedAt:serverTimestamp(),
    activityAtIso:'2026-11-25T12:02:00Z',activityAt:serverTimestamp()
  });
  await assertSucceeds(departure.commit());
});
