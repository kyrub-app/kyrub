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
  getDoc,
  getDocs,
  query,
  where,
  runTransaction,
  serverTimestamp,
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

test('public membership unlocks mural and debate participation', async () => {
  const owner = environment.authenticatedContext(OWNER).firestore();
  const member = environment.authenticatedContext(MEMBER).firestore();
  await createCommunity(owner, 'public_c', 'public');
  await assertSucceeds(joinPublic(member, 'public_c', MEMBER));
  await assertSucceeds(
    setDoc(doc(member, 'community_posts', 'post_a'), {
      postId: 'post_a',
      communityId: 'public_c',
      authorId: MEMBER,
      authorName: 'Membro',
      authorAvatar: '',
      content: 'Publicação visível em outro perfil.',
      mediaUrls: [],
      createdAtIso: '2026-08-05T00:02:00.000Z',
      createdAt: serverTimestamp(),
      updatedAtIso: '2026-08-05T00:02:00.000Z',
      updatedAt: serverTimestamp(),
    })
  );
  await assertSucceeds(
    setDoc(
      doc(member, 'community_debates', 'debate_a'),
      debateData('public_c', 'debate_a')
    )
  );
});

test('moderated membership remains pending until creator approval', async () => {
  const owner = environment.authenticatedContext(OWNER).firestore();
  const member = environment.authenticatedContext(MEMBER).firestore();
  await createCommunity(owner, 'moderated_a', 'moderated');
  const id = memberId('moderated_a', MEMBER);
  await assertSucceeds(
    setDoc(
      doc(member, 'community_members', id),
      membershipData('moderated_a', MEMBER, 'pending')
    )
  );
  await assertFails(
    setDoc(
      doc(member, 'community_debates', 'blocked'),
      debateData('moderated_a', 'blocked')
    )
  );

  const approval = writeBatch(owner);
  approval.update(doc(owner, 'community_members', id), {
    status: 'active',
    updatedAtIso: '2026-08-05T00:04:00.000Z',
    updatedAt: serverTimestamp(),
  });
  approval.update(doc(owner, 'communities', 'moderated_a'), {
    memberCount: 2,
    lastMembershipChangeId: id,
    updatedAtIso: '2026-08-05T00:04:00.000Z',
    updatedAt: serverTimestamp(),
    activityAtIso: '2026-08-05T00:04:00.000Z',
    activityAt: serverTimestamp(),
  });
  await assertSucceeds(approval.commit());
  await assertSucceeds(
    setDoc(
      doc(member, 'community_debates', 'approved'),
      debateData('moderated_a', 'approved')
    )
  );
});

test('active member adds a shared comment only with the atomic debate counter', async () => {
  const owner = environment.authenticatedContext(OWNER).firestore();
  const member = environment.authenticatedContext(MEMBER).firestore();
  const outsider = environment.authenticatedContext(OUTSIDER).firestore();
  await createCommunity(owner, 'public_d', 'public');
  await joinPublic(member, 'public_d', MEMBER);
  await setDoc(
    doc(member, 'community_debates', 'debate_b'),
    debateData('public_d', 'debate_b')
  );

  await assertFails(
    setDoc(doc(outsider, 'community_debate_comments', 'forged'), {
      commentId: 'forged',
      communityId: 'public_d',
      debateId: 'debate_b',
      authorId: OUTSIDER,
      authorName: 'Intruso',
      authorAvatar: '',
      text: 'Comentário sem participação.',
      parentCommentId: '',
      createdAtIso: '2026-08-05T00:05:00.000Z',
      createdAt: serverTimestamp(),
      updatedAtIso: '2026-08-05T00:05:00.000Z',
      updatedAt: serverTimestamp(),
    })
  );

  await assertSucceeds(
    runTransaction(member, async transaction => {
      const debateRef = doc(member, 'community_debates', 'debate_b');
      const debate = await transaction.get(debateRef);
      const commentRef = doc(collection(member, 'community_debate_comments'));
      transaction.set(commentRef, {
        commentId: commentRef.id,
        communityId: 'public_d',
        debateId: 'debate_b',
        authorId: MEMBER,
        authorName: 'Membro',
        authorAvatar: '',
        text: 'Este comentário continua o debate em outro perfil.',
        parentCommentId: '',
        createdAtIso: '2026-08-05T00:05:00.000Z',
        createdAt: serverTimestamp(),
        updatedAtIso: '2026-08-05T00:05:00.000Z',
        updatedAt: serverTimestamp(),
      });
      transaction.update(debateRef, {
        commentCount: Number(debate.data()?.commentCount ?? 0) + 1,
        lastCommentId: commentRef.id,
        updatedAtIso: '2026-08-05T00:05:00.000Z',
        updatedAt: serverTimestamp(),
        activityAtIso: '2026-08-05T00:05:00.000Z',
        activityAt: serverTimestamp(),
      });
    })
  );
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
  const result = await getDoc(doc(member, 'community_posts', postId));
  if (result.exists()) throw new Error('Post removido ainda existe no Firestore');
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
