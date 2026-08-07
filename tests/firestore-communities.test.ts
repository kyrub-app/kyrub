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
  doc,
  getDoc,
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
