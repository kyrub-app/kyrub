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
  authorName: 'UsuÃ¡rio Social',
  authorAvatar: '',
  content: 'PublicaÃ§Ã£o pÃºblica de teste.',
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
  content: 'PublicaÃ§Ã£o da linha do tempo com usuÃ¡rio marcado.',
  taggedUsers: ['Visitante'],
  taggedUserIds: [VIEWER_ID],
  visibility: 'private',
  audienceIds: [OWNER_ID, VIEWER_ID],
});

const statusPayload = (publicSquare = false) => ({
  postId: publicSquare ? PUBLIC_STATUS_ID : STATUS_ID,
  sourcePostId: publicSquare ? 'status-public' : 'status-123',
  authorId: OWNER_ID,
  authorName: 'UsuÃ¡rio Social',
  authorAvatar: '',
  content: publicSquare
    ? 'Status enviado voluntariamente para a PraÃ§a.'
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

test('author opts a permanent publication into the public PraÃ§a feed', async () => {
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

test('status stays connection scoped unless the author sends it to PraÃ§a', async () => {
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
      text: 'ComentÃ¡rio real.',
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

test('viewer records a unique view that only the actor and post author can read', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'social_posts', POST_ID), {
      ...postPayload(),
      createdAt: new Date('2026-07-25T12:00:00.000Z'),
      updatedAt: new Date('2026-07-25T12:00:00.000Z'),
    });
  });

  const viewer = environment.authenticatedContext(VIEWER_ID).firestore();
  const engagementId = `${POST_ID}__view__${VIEWER_ID}`;
  const engagementReference = doc(
    viewer,
    'social_post_engagements',
    engagementId
  );
  await assertSucceeds(
    setDoc(engagementReference, {
      engagementId,
      postId: POST_ID,
      postAuthorId: OWNER_ID,
      actorId: VIEWER_ID,
      type: 'view',
      createdAt: serverTimestamp(),
    })
  );
  await assertSucceeds(getDoc(engagementReference));
  await assertFails(
    setDoc(engagementReference, {
      engagementId,
      postId: POST_ID,
      postAuthorId: OWNER_ID,
      actorId: VIEWER_ID,
      type: 'view',
      createdAt: serverTimestamp(),
    })
  );

  const owner = environment.authenticatedContext(OWNER_ID).firestore();
  const metricsSnapshot = await assertSucceeds(
    getDocs(
      query(
        collection(owner, 'social_post_engagements'),
        where('postAuthorId', '==', OWNER_ID)
      )
    )
  );
  if (metricsSnapshot.size !== 1) {
    throw new Error(`Expected one engagement, received ${metricsSnapshot.size}.`);
  }

  const stranger = environment.authenticatedContext(STRANGER_ID).firestore();
  await assertFails(
    getDoc(doc(stranger, 'social_post_engagements', engagementId))
  );
});

test('save metrics are reversible while share metrics are permanent events', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'social_posts', POST_ID), {
      ...postPayload(),
      createdAt: new Date('2026-07-25T12:00:00.000Z'),
      updatedAt: new Date('2026-07-25T12:00:00.000Z'),
    });
  });

  const viewer = environment.authenticatedContext(VIEWER_ID).firestore();
  const saveId = `${POST_ID}__save__${VIEWER_ID}`;
  const saveReference = doc(viewer, 'social_post_engagements', saveId);
  await assertSucceeds(
    setDoc(saveReference, {
      engagementId: saveId,
      postId: POST_ID,
      postAuthorId: OWNER_ID,
      actorId: VIEWER_ID,
      type: 'save',
      createdAt: serverTimestamp(),
    })
  );
  await assertSucceeds(deleteDoc(saveReference));

  const shareReference = doc(
    collection(viewer, 'social_post_engagements')
  );
  await assertSucceeds(
    setDoc(shareReference, {
      engagementId: shareReference.id,
      postId: POST_ID,
      postAuthorId: OWNER_ID,
      actorId: VIEWER_ID,
      type: 'share',
      createdAt: serverTimestamp(),
    })
  );
  await assertFails(deleteDoc(shareReference));
});

test('users cannot forge metrics for another actor, author or inaccessible post', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'social_posts', POST_ID), {
      ...postPayload(),
      createdAt: new Date('2026-07-25T12:00:00.000Z'),
      updatedAt: new Date('2026-07-25T12:00:00.000Z'),
    });
    await setDoc(doc(context.firestore(), 'social_posts', PRIVATE_POST_ID), {
      ...privatePostPayload(),
      audienceIds: [OWNER_ID],
      taggedUsers: [],
      taggedUserIds: [],
      createdAt: new Date('2026-07-25T12:00:00.000Z'),
      updatedAt: new Date('2026-07-25T12:00:00.000Z'),
    });
  });

  const viewer = environment.authenticatedContext(VIEWER_ID).firestore();
  const forgedActorId = `${POST_ID}__view__${STRANGER_ID}`;
  await assertFails(
    setDoc(doc(viewer, 'social_post_engagements', forgedActorId), {
      engagementId: forgedActorId,
      postId: POST_ID,
      postAuthorId: OWNER_ID,
      actorId: STRANGER_ID,
      type: 'view',
      createdAt: serverTimestamp(),
    })
  );

  const wrongAuthorId = `${POST_ID}__view__${VIEWER_ID}`;
  await assertFails(
    setDoc(doc(viewer, 'social_post_engagements', wrongAuthorId), {
      engagementId: wrongAuthorId,
      postId: POST_ID,
      postAuthorId: STRANGER_ID,
      actorId: VIEWER_ID,
      type: 'view',
      createdAt: serverTimestamp(),
    })
  );

  const privateMetricId = `${PRIVATE_POST_ID}__view__${VIEWER_ID}`;
  await assertFails(
    setDoc(doc(viewer, 'social_post_engagements', privateMetricId), {
      engagementId: privateMetricId,
      postId: PRIVATE_POST_ID,
      postAuthorId: OWNER_ID,
      actorId: VIEWER_ID,
      type: 'view',
      createdAt: serverTimestamp(),
    })
  );
});

const campaignPayload = (
  campaignId: string,
  ownerId = OWNER_ID
) => ({
  campaignId,
  ownerId,
  postId: POST_ID,
  objective: 'reach',
  dailyBudgetCents: 1000,
  startDate: '2026-08-03',
  endDate: '2026-08-10',
  audienceLocation: 'São Paulo',
  status: 'active',
  deliveryMode: 'configuration_only',
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

test(
  'post owner creates, reads and controls own sponsorship campaign',
  async () => {
    await environment.withSecurityRulesDisabled(async context => {
      await setDoc(
        doc(context.firestore(), 'social_posts', POST_ID),
        {
          ...postPayload(),
          createdAt: new Date('2026-08-03T12:00:00.000Z'),
          updatedAt: new Date('2026-08-03T12:00:00.000Z'),
        }
      );
    });

    const owner =
      environment.authenticatedContext(OWNER_ID).firestore();

    const campaignId = 'campaign-owner-1';
    const reference = doc(
      owner,
      'social_post_campaigns',
      campaignId
    );

    await assertSucceeds(
      setDoc(reference, campaignPayload(campaignId))
    );

    const snapshot = await assertSucceeds(
      getDocs(
        query(
          collection(owner, 'social_post_campaigns'),
          where('ownerId', '==', OWNER_ID)
        )
      )
    );

    if (snapshot.size !== 1) {
      throw new Error(
        'Expected one campaign, received ' +
          String(snapshot.size) +
          '.'
      );
    }

    await assertSucceeds(
      setDoc(
        reference,
        {
          status: 'paused',
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
    );

    await assertSucceeds(
      setDoc(
        reference,
        {
          status: 'active',
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
    );

    await assertSucceeds(
      setDoc(
        reference,
        {
          status: 'ended',
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
    );

    await assertFails(
      setDoc(
        reference,
        {
          status: 'active',
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
    );

    await assertFails(deleteDoc(reference));
  }
);

test(
  'campaigns reject forged owners, invalid budgets and foreign access',
  async () => {
    await environment.withSecurityRulesDisabled(async context => {
      await setDoc(
        doc(context.firestore(), 'social_posts', POST_ID),
        {
          ...postPayload(),
          createdAt: new Date('2026-08-03T12:00:00.000Z'),
          updatedAt: new Date('2026-08-03T12:00:00.000Z'),
        }
      );
    });

    const owner =
      environment.authenticatedContext(OWNER_ID).firestore();

    const campaignId = 'campaign-owner-2';
    const reference = doc(
      owner,
      'social_post_campaigns',
      campaignId
    );

    await assertSucceeds(
      setDoc(reference, campaignPayload(campaignId))
    );

    await assertFails(
      setDoc(
        doc(
          owner,
          'social_post_campaigns',
          'invalid-budget'
        ),
        {
          ...campaignPayload('invalid-budget'),
          dailyBudgetCents: 499,
        }
      )
    );

    await assertFails(
      setDoc(
        reference,
        {
          dailyBudgetCents: 999999,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
    );

    const viewer =
      environment.authenticatedContext(VIEWER_ID).firestore();

    await assertFails(
      setDoc(
        doc(
          viewer,
          'social_post_campaigns',
          'forged-campaign'
        ),
        campaignPayload('forged-campaign', VIEWER_ID)
      )
    );

    await assertFails(
      getDocs(
        query(
          collection(viewer, 'social_post_campaigns'),
          where('ownerId', '==', OWNER_ID)
        )
      )
    );

    await assertFails(
      setDoc(
        doc(
          viewer,
          'social_post_campaigns',
          campaignId
        ),
        {
          status: 'paused',
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
    );
  }
);
