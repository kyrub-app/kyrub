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
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';

const PROJECT_ID = 'kyrub-security-test';
const OWNER_ID = 'community_owner';
const MEMBER_ID = 'community_member';
const OUTSIDER_ID = 'community_outsider';
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

beforeEach(async () => {
  await environment.clearFirestore();
});

after(async () => {
  await environment.cleanup();
});

const membershipId = (communityId: string, userId: string) =>
  `${communityId}__${userId}`;

const communityPayload = (
  communityId: string,
  visibility: 'public' | 'moderated' | 'private',
  memberCount = 1,
  lastMembershipChangeId = membershipId(communityId, OWNER_ID)
) => ({
  communityId,
  ownerId: OWNER_ID,
  ownerName: 'Criador Kyrub',
  ownerAvatar: '',
  name: `Comunidade ${communityId}`,
  description: 'Espaço criado para validar comunidades multiusuário.',
  category: 'Testes',
  location: 'Brasil',
  visibility,
  rules: 'Respeite todos os participantes.',
  coverImage: '',
  coverPath: '',
  memberCount,
  lastMembershipChangeId,
  createdAtIso: '2026-08-05T00:00:00.000Z',
  createdAt: serverTimestamp(),
  updatedAtIso: '2026-08-05T00:00:00.000Z',
  updatedAt: serverTimestamp(),
  activityAtIso: '2026-08-05T00:00:00.000Z',
  activityAt: serverTimestamp(),
});

const memberPayload = (
  communityId: string,
  userId: string,
  status: 'active' | 'pending',
  role: 'owner' | 'member' = 'member'
) => ({
  membershipId: membershipId(communityId, userId),
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
  firestore: Firestore,
  communityId: string,
  visibility: 'public' | 'moderated' | 'private'
) => {
  const batch = writeBatch(firestore);
  batch.set(
    doc(firestore, 'communities', communityId),
    communityPayload(communityId, visibility)
  );
  batch.set(
    doc(firestore, 'community_members', membershipId(communityId, OWNER_ID)),
    memberPayload(communityId, OWNER_ID, 'active', 'owner')
  );
  await batch.commit();
};

const joinPublicCommunity = async (
  firestore: Firestore,
  communityId: string,
  userId: string
) => {
  const id = membershipId(communityId, userId);
  const batch = writeBatch(firestore);
  batch.set(
    doc(firestore, 'community_members', id),
    memberPayload(communityId, userId, 'active')
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

const debatePayload = (communityId: string, debateId: string) => ({
  debateId,
  communityId,
  authorId: MEMBER_ID,
  authorName: 'Membro',
  authorAvatar: '',
  title: 'Como melhorar nossa comunidade?',
  content: 'Compartilhe uma proposta prática para continuarmos este debate.',
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

test('creator atomically creates a community and owner membership', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  await assertSucceeds(createCommunity(owner, 'public_a', 'public'));
  await assertSucceeds(getDoc(doc(owner, 'communities', 'public_a')));
});

test('authenticated profiles discover public communities but cannot edit them', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  const visitor = environment.authenticatedContext(OUTSIDER_ID).firestore();
  await createCommunity(owner, 'public_b', 'public');
  await assertSucceeds(getDoc(doc(visitor, 'communities', 'public_b')));
  await assertFails(
    updateDoc(doc(visitor, 'communities', 'public_b'), {
      rules: 'Regra adulterada.',
      updatedAtIso: '2026-08-05T00:03:00.000Z',
      updatedAt: serverTimestamp(),
      activityAtIso: '2026-08-05T00:03:00.000Z',
      activityAt: serverTimestamp(),
    })
  );
});

test('public membership is atomic and enables mural and debate creation', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  const member = environment.authenticatedContext(MEMBER_ID).firestore();
  await createCommunity(owner, 'public_c', 'public');
  await assertSucceeds(joinPublicCommunity(member, 'public_c', MEMBER_ID));

  await assertSucceeds(
    setDoc(doc(member, 'community_posts', 'post_a'), {
      postId: 'post_a',
      communityId: 'public_c',
      authorId: MEMBER_ID,
      authorName: 'Membro',
      authorAvatar: '',
      content: 'Publicação compartilhada entre perfis.',
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
      debatePayload('public_c', 'debate_a')
    )
  );
});

test('moderated entry stays pending until the creator approves it', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  const member = environment.authenticatedContext(MEMBER_ID).firestore();
  await createCommunity(owner, 'moderated_a', 'moderated');

  const pendingId = membershipId('moderated_a', MEMBER_ID);
  await assertSucceeds(
    setDoc(
      doc(member, 'community_members', pendingId),
      memberPayload('moderated_a', MEMBER_ID, 'pending')
    )
  );
  await assertFails(
    setDoc(
      doc(member, 'community_debates', 'blocked_debate'),
      debatePayload('moderated_a', 'blocked_debate')
    )
  );

  const batch = writeBatch(owner);
  batch.update(doc(owner, 'community_members', pendingId), {
    status: 'active',
    updatedAtIso: '2026-08-05T00:04:00.000Z',
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(owner, 'communities', 'moderated_a'), {
    memberCount: 2,
    lastMembershipChangeId: pendingId,
    updatedAtIso: '2026-08-05T00:04:00.000Z',
    updatedAt: serverTimestamp(),
    activityAtIso: '2026-08-05T00:04:00.000Z',
    activityAt: serverTimestamp(),
  });
  await assertSucceeds(batch.commit());
  await assertSucceeds(
    setDoc(
      doc(member, 'community_debates', 'approved_debate'),
      debatePayload('moderated_a', 'approved_debate')
    )
  );
});

test('active members comment in a debate with an atomic counter update', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  const member = environment.authenticatedContext(MEMBER_ID).firestore();
  await createCommunity(owner, 'public_d', 'public');
  await joinPublicCommunity(member, 'public_d', MEMBER_ID);
  await setDoc(
    doc(member, 'community_debates', 'debate_b'),
    debatePayload('public_d', 'debate_b')
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
        authorId: MEMBER_ID,
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

test('outsiders cannot comment and comment deletion must decrement the debate', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  const member = environment.authenticatedContext(MEMBER_ID).firestore();
  const outsider = environment.authenticatedContext(OUTSIDER_ID).firestore();
  await createCommunity(owner, 'public_e', 'public');
  await joinPublicCommunity(member, 'public_e', MEMBER_ID);
  await setDoc(
    doc(member, 'community_debates', 'debate_c'),
    debatePayload('public_e', 'debate_c')
  );

  await assertFails(
    setDoc(doc(outsider, 'community_debate_comments', 'forged_comment'), {
      commentId: 'forged_comment',
      communityId: 'public_e',
      debateId: 'debate_c',
      authorId: OUTSIDER_ID,
      authorName: 'Intruso',
      authorAvatar: '',
      text: 'Comentário sem participação.',
      parentCommentId: '',
      createdAtIso: '2026-08-05T00:06:00.000Z',
      createdAt: serverTimestamp(),
      updatedAtIso: '2026-08-05T00:06:00.000Z',
      updatedAt: serverTimestamp(),
    })
  );

  await environment.withSecurityRulesDisabled(async context => {
    const admin = context.firestore();
    await setDoc(doc(admin, 'community_debate_comments', 'comment_to_delete'), {
      commentId: 'comment_to_delete',
      communityId: 'public_e',
      debateId: 'debate_c',
      authorId: MEMBER_ID,
      authorName: 'Membro',
      authorAvatar: '',
      text: 'Comentário que será removido.',
      parentCommentId: '',
      createdAtIso: '2026-08-05T00:06:00.000Z',
      createdAt: serverTimestamp(),
      updatedAtIso: '2026-08-05T00:06:00.000Z',
      updatedAt: serverTimestamp(),
    });
    await updateDoc(doc(admin, 'community_debates', 'debate_c'), {
      commentCount: 1,
      lastCommentId: 'comment_to_delete',
    });
  });

  await assertFails(
    deleteDoc(doc(member, 'community_debate_comments', 'comment_to_delete'))
  );
  await assertSucceeds(
    runTransaction(member, async transaction => {
      const debateRef = doc(member, 'community_debates', 'debate_c');
      const commentRef = doc(
        member,
        'community_debate_comments',
        'comment_to_delete'
      );
      transaction.delete(commentRef);
      transaction.update(debateRef, {
        commentCount: 0,
        lastCommentId: 'comment_to_delete',
        updatedAtIso: '2026-08-05T00:07:00.000Z',
        updatedAt: serverTimestamp(),
        activityAtIso: '2026-08-05T00:07:00.000Z',
        activityAt: serverTimestamp(),
      });
    })
  );
});
