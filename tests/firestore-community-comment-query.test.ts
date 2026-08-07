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
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore';

const PROJECT_ID = 'kyrub-security-test';
const OWNER = 'comment_query_owner';
const MEMBER = 'comment_query_member';
const OUTSIDER = 'comment_query_outsider';
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

const seedCommentScenario = async () => {
  await environment.withSecurityRulesDisabled(async context => {
    const firestore = context.firestore();

    await setDoc(doc(firestore, 'communities', 'public_comments'), {
      ownerId: OWNER,
      visibility: 'public',
    });
    await setDoc(doc(firestore, 'community_debates', 'public_debate'), {
      communityId: 'public_comments',
    });
    await setDoc(doc(firestore, 'community_debate_comments', 'public_comment'), {
      communityId: 'public_comments',
      debateId: 'public_debate',
      text: 'Comentário visível para perfis autenticados.',
    });

    await setDoc(doc(firestore, 'communities', 'private_comments'), {
      ownerId: OWNER,
      visibility: 'private',
    });
    await setDoc(doc(firestore, 'community_debates', 'private_debate'), {
      communityId: 'private_comments',
    });
    await setDoc(doc(firestore, 'community_debate_comments', 'private_comment'), {
      communityId: 'private_comments',
      debateId: 'private_debate',
      text: 'Comentário restrito aos participantes.',
    });
    await setDoc(
      doc(
        firestore,
        'community_members',
        `private_comments__${MEMBER}`
      ),
      {
        communityId: 'private_comments',
        userId: MEMBER,
        status: 'active',
      }
    );
  });
};

const commentsForDebate = (firestore: any, debateId: string) =>
  getDocs(
    query(
      collection(firestore, 'community_debate_comments'),
      where('debateId', '==', debateId)
    )
  );

test('another authenticated profile lists comments for a public debate', async () => {
  await seedCommentScenario();
  const outsider = environment.authenticatedContext(OUTSIDER).firestore();
  await assertSucceeds(commentsForDebate(outsider, 'public_debate'));
});

test('debate-scoped authorization does not allow an unrestricted comment list', async () => {
  await seedCommentScenario();
  const outsider = environment.authenticatedContext(OUTSIDER).firestore();
  await assertFails(
    getDocs(collection(outsider, 'community_debate_comments'))
  );
});

test('private debate comments stay limited to community participants', async () => {
  await seedCommentScenario();
  const outsider = environment.authenticatedContext(OUTSIDER).firestore();
  const member = environment.authenticatedContext(MEMBER).firestore();

  await assertFails(commentsForDebate(outsider, 'private_debate'));
  await assertSucceeds(commentsForDebate(member, 'private_debate'));
});
