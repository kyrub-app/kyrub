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
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';

const PROJECT_ID = 'kyrub-security-test';
const OWNER_ID = 'social-owner';
const VIEWER_ID = 'social-viewer';
const STRANGER_ID = 'social-stranger';
const POST_ID = `${OWNER_ID}__feed-123`;
const PRIVATE_POST_ID = `${OWNER_ID}__feed-private`;
const STATUS_ID = `${OWNER_ID}__status-123`;
const PUBLIC_STATUS_ID = `${OWNER_ID}__status-public`;
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
  audienceIds: [],
  createdAtIso: '2026-07-25T12:00:00.000Z',
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

const privatePostPayload = () => ({
  ...postPayload(),
  postId: PRIVATE_POST_ID,
  sourcePostId: 'feed-private',
  content: 'Publicação da linha do tempo com usuário marcado.',
  taggedUsers: ['Visitante'],
  taggedUserIds: [VIEWER_ID],
  visibility: 'private',
  audienceIds: [OWNER_ID, VIEWER_ID],
});

const statusPayload = (publicSquare = false) => ({
  postId: publicSquare ? PUBLIC_STATUS_ID : STATUS_ID,
  sourcePostId: publicSquare ? 'status-public' : 'status-123',
  authorId: OWNER_ID,
  authorName: 'Usuário Social',
  authorAvatar: '',
  content: publicSquare
    ? 'Status enviado voluntariamente para a Praça.'
    : 'Status somente para conectados.',
  publicationType: 'status',
  taggedUsers: [],
  taggedUserIds: [],
  mediaUrls: [],
  visibility: publicSquare ? 'public' : 'connections',
  audienceIds: [OWNER_ID, VIEWER_ID],
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

test('author opts a permanent publication into the public Praça feed', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  await assertSucceeds(setDoc(doc(owner, 'social_posts', POST_ID), postPayload()));

  const viewer = environment.authenticatedContext(VIEWER_ID).firestore();
  const snapshot = await assertSucceeds(
    getDocs(
      query(
        collection(viewer, 'social_posts'),
        where('visibility', '==', 'public')
      )
    )
  );
  if (snapshot.size !== 1) {
    throw new Error(`Expected one public post, received ${snapshot.size}.`);
  }
});

test('private timeline publication is readable by author and tagged audience only', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  await assertSucceeds(
    setDoc(doc(owner, 'social_posts', PRIVATE_POST_ID), privatePostPayload())
  );
  await assertSucceeds(getDoc(doc(owner, 'social_posts', PRIVATE_POST_ID)));

  const viewer = environment.authenticatedContext(VIEWER_ID).firestore();
  const audienceSnapshot = await assertSucceeds(
    getDocs(
      query(
        collection(viewer, 'social_posts'),
        where('audienceIds', 'array-contains', VIEWER_ID)
      )
    )
  );
  if (audienceSnapshot.size !== 1) {
    throw new Error(`Expected one tagged post, received ${audienceSnapshot.size}.`);
  }
  await assertSucceeds(getDoc(doc(viewer, 'social_posts', PRIVATE_POST_ID)));

  const stranger = environment.authenticatedContext(STRANGER_ID).firestore();
  await assertFails(getDoc(doc(stranger, 'social_posts', PRIVATE_POST_ID)));
});

test('status stays connection scoped unless the author sends it to Praça', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  await assertSucceeds(
    setDoc(doc(owner, 'social_posts', STATUS_ID), statusPayload(false))
  );
  await assertSucceeds(
    setDoc(doc(owner, 'social_posts', PUBLIC_STATUS_ID), statusPayload(true))
  );

  const viewer = environment.authenticatedContext(VIEWER_ID).firestore();
  const audienceSnapshot = await assertSucceeds(
    getDocs(
      query(
        collection(viewer, 'social_posts'),
        where('audienceIds', 'array-contains', VIEWER_ID)
      )
    )
  );
  if (audienceSnapshot.size !== 2) {
    throw new Error(`Expected two audience statuses, received ${audienceSnapshot.size}.`);
  }

  const stranger = environment.authenticatedContext(STRANGER_ID).firestore();
  await assertFails(getDoc(doc(stranger, 'social_posts', STATUS_ID)));
  await assertSucceeds(getDoc(doc(stranger, 'social_posts', PUBLIC_STATUS_ID)));
});

test('publication visibility and audience shapes cannot be forged', async () => {
  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  await assertFails(
    setDoc(doc(owner, 'social_posts', PRIVATE_POST_ID), {
      ...privatePostPayload(),
      audienceIds: [OWNER_ID],
    })
  );
  await assertFails(
    setDoc(doc(owner, 'social_posts', STATUS_ID), {
      ...statusPayload(false),
      visibility: 'private',
    })
  );
  await assertFails(
    setDoc(doc(owner, 'social_posts', POST_ID), {
      ...postPayload(),
      visibility: 'connections',
      audienceIds: [OWNER_ID],
    })
  );
});

test('users cannot publish content under another author identity', async () => {
  const viewer = environment.authenticatedContext(VIEWER_ID).firestore();
  await assertFails(
    setDoc(doc(viewer, 'social_posts', POST_ID), postPayload(OWNER_ID))
  );
});

test('viewer reports a publication once and only sees their own report', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'social_posts', POST_ID), {
      ...postPayload(),
      createdAt: new Date('2026-07-25T12:00:00.000Z'),
      updatedAt: new Date('2026-07-25T12:00:00.000Z'),
    });
  });

  const viewer = environment.authenticatedContext(VIEWER_ID).firestore();
  const reportId = `${POST_ID}__${VIEWER_ID}`;
  const reportReference = doc(viewer, 'social_post_reports', reportId);
  const reportPayload = {
    reportId,
    postId: POST_ID,
    reporterId: VIEWER_ID,
    authorId: OWNER_ID,
    reason: 'user_report',
    status: 'pending',
    createdAt: serverTimestamp(),
  };
  await assertSucceeds(setDoc(reportReference, reportPayload));
  await assertSucceeds(getDoc(reportReference));
  await assertFails(setDoc(reportReference, reportPayload));

  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  await assertFails(getDoc(doc(owner, 'social_post_reports', reportId)));
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

  const stranger = environment.authenticatedContext(STRANGER_ID).firestore();
  await assertFails(
    deleteDoc(doc(stranger, 'social_post_comments', 'comment-1'))
  );
  await assertSucceeds(deleteDoc(commentReference));
});
