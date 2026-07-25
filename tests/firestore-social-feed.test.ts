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
  getDocs,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';

const PROJECT_ID = 'kyrub-security-test';
const OWNER_ID = 'social-owner';
const VIEWER_ID = 'social-viewer';
const POST_ID = `${OWNER_ID}__feed-123`;
let environment: RulesTestEnvironment;

const postPayload = (authorId = OWNER_ID) => ({
  postId: POST_ID,
  sourcePostId: 'feed-123',
  authorId,
  authorName: 'Usuário Social',
  authorAvatar: '',
  content: 'Publicação pública de teste.',
  publicationType: 'feed',
  taggedUsers: [],
  taggedUserIds: [],
  mediaUrls: [],
  visibility: 'public',
  createdAtIso: '2026-07-25T12:00:00.000Z',
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

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

test('author publishes and another authenticated user lists the public feed', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  await assertSucceeds(
    setDoc(doc(owner, 'social_posts', POST_ID), postPayload())
  );

  const viewer = environment.authenticatedContext(VIEWER_ID).firestore();
  const snapshot = await assertSucceeds(
    getDocs(collection(viewer, 'social_posts'))
  );
  if (snapshot.size !== 1) {
    throw new Error(`Expected one social post, received ${snapshot.size}.`);
  }
});

test('users cannot publish content under another author identity', async () => {
  const viewer = environment.authenticatedContext(VIEWER_ID).firestore();
  await assertFails(
    setDoc(doc(viewer, 'social_posts', POST_ID), postPayload(OWNER_ID))
  );
});

test('viewer can like once and remove their own like', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'social_posts', POST_ID), {
      ...postPayload(),
      createdAt: new Date('2026-07-25T12:00:00.000Z'),
      updatedAt: new Date('2026-07-25T12:00:00.000Z'),
    });
  });

  const viewer = environment.authenticatedContext(VIEWER_ID).firestore();
  const likeId = `${POST_ID}__${VIEWER_ID}`;
  const likeReference = doc(viewer, 'social_post_likes', likeId);
  await assertSucceeds(
    setDoc(likeReference, {
      postId: POST_ID,
      userId: VIEWER_ID,
      createdAt: serverTimestamp(),
    })
  );
  await assertSucceeds(deleteDoc(likeReference));
});

test('viewer comments and only the comment author may delete it', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'social_posts', POST_ID), {
      ...postPayload(),
      createdAt: new Date('2026-07-25T12:00:00.000Z'),
      updatedAt: new Date('2026-07-25T12:00:00.000Z'),
    });
  });

  const viewer = environment.authenticatedContext(VIEWER_ID).firestore();
  const commentReference = doc(viewer, 'social_post_comments', 'comment-1');
  await assertSucceeds(
    setDoc(commentReference, {
      postId: POST_ID,
      authorId: VIEWER_ID,
      authorName: 'Visitante',
      authorAvatar: '',
      text: 'Comentário real.',
      createdAtIso: '2026-07-25T12:05:00.000Z',
      createdAt: serverTimestamp(),
    })
  );

  const stranger = environment.authenticatedContext('stranger').firestore();
  await assertFails(
    deleteDoc(doc(stranger, 'social_post_comments', 'comment-1'))
  );
  await assertSucceeds(deleteDoc(commentReference));
});
