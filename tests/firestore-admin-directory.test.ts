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
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';

const PROJECT_ID = 'kyrub-security-test';
let environment: RulesTestEnvironment;

const adminRecord = (uid: string, role: string, status = 'active') => ({
  uid,
  email: `${uid}@example.com`,
  displayName: uid,
  role,
  status,
  createdBy: 'bootstrap',
  createdAt: Timestamp.fromMillis(1_700_000_000_000),
  updatedAt: Timestamp.fromMillis(1_700_000_000_000),
  suspendedAt: '',
  revokedAt: '',
});

const userRecord = (uid: string, email: string) => ({
  uid,
  name: uid,
  email,
  photoUrl: '',
  isProfileVisible: true,
  createdAt: Timestamp.fromMillis(1_700_000_000_000),
  updatedAt: Timestamp.fromMillis(1_700_000_000_000),
});

const storeRecord = (id: string, ownerId: string) => ({
  id,
  ownerId,
  name: id,
  publicationStatus: 'paused',
  plan: 'business',
  legacyTenantId: ownerId,
  migrationStatus: 'dual_write',
  createdAt: Timestamp.fromMillis(1_700_000_000_000),
  updatedAt: Timestamp.fromMillis(1_700_000_000_000),
});

const memberRecord = (storeId: string, userId: string) => ({
  storeId,
  storeName: storeId,
  userId,
  displayName: userId,
  email: `${userId}@example.com`,
  photoUrl: '',
  role: 'seller',
  status: 'active',
  invitedBy: 'target-user',
  invitedAt: Timestamp.fromMillis(1_700_000_000_000),
  acceptedAt: Timestamp.fromMillis(1_700_000_000_000),
  suspendedAt: '',
  removedAt: '',
  createdAt: Timestamp.fromMillis(1_700_000_000_000),
  updatedAt: Timestamp.fromMillis(1_700_000_000_000),
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
  await environment.withSecurityRulesDisabled(async context => {
    const firestore = context.firestore();
    await Promise.all([
      setDoc(
        doc(firestore, 'kyrub_admin', 'control_plane', 'admins', 'support-a'),
        adminRecord('support-a', 'support')
      ),
      setDoc(
        doc(firestore, 'kyrub_admin', 'control_plane', 'admins', 'operations-a'),
        adminRecord('operations-a', 'operations')
      ),
      setDoc(
        doc(firestore, 'kyrub_admin', 'control_plane', 'admins', 'compliance-a'),
        adminRecord('compliance-a', 'compliance')
      ),
      setDoc(
        doc(firestore, 'kyrub_admin', 'control_plane', 'admins', 'finance-a'),
        adminRecord('finance-a', 'finance')
      ),
      setDoc(
        doc(firestore, 'users', 'target-user'),
        userRecord('target-user', 'target@example.com')
      ),
      setDoc(
        doc(firestore, 'stores', 'owned-store'),
        storeRecord('owned-store', 'target-user')
      ),
      setDoc(
        doc(firestore, 'stores', 'member-store'),
        storeRecord('member-store', 'another-owner')
      ),
      setDoc(
        doc(firestore, 'stores', 'member-store', 'members', 'target-user'),
        memberRecord('member-store', 'target-user')
      ),
      setDoc(doc(firestore, 'tenants', 'target-user'), {
        ownerId: 'target-user',
        name: 'Tenant legado',
        plan: 'free',
        status: 'open',
      }),
    ]);
  });
});

after(async () => {
  await environment.cleanup();
});

test('support can perform exact read-only user and store directory queries', async () => {
  const support = environment.authenticatedContext('support-a').firestore();

  await assertSucceeds(
    getDocs(
      query(
        collection(support, 'users'),
        where('email', '==', 'target@example.com'),
        limit(2)
      )
    )
  );

  await assertSucceeds(
    getDocs(
      query(
        collection(support, 'stores'),
        where('ownerId', '==', 'target-user'),
        limit(50)
      )
    )
  );

  await assertSucceeds(
    getDocs(
      query(
        collectionGroup(support, 'members'),
        where('userId', '==', 'target-user'),
        limit(100)
      )
    )
  );

  await assertSucceeds(getDoc(doc(support, 'stores', 'member-store')));
  await assertSucceeds(
    getDocs(
      query(
        collection(support, 'tenants'),
        where('ownerId', '==', 'target-user'),
        limit(50)
      )
    )
  );
});

test('operations and compliance can read directory while finance is denied', async () => {
  const operations = environment.authenticatedContext('operations-a').firestore();
  const compliance = environment.authenticatedContext('compliance-a').firestore();
  const finance = environment.authenticatedContext('finance-a').firestore();

  await assertSucceeds(getDoc(doc(operations, 'users', 'target-user')));
  await assertSucceeds(getDoc(doc(compliance, 'stores', 'owned-store')));

  await assertFails(
    getDocs(
      query(
        collection(finance, 'users'),
        where('email', '==', 'target@example.com'),
        limit(2)
      )
    )
  );
  await assertFails(getDoc(doc(finance, 'stores', 'owned-store')));
  await assertFails(
    getDocs(
      query(
        collectionGroup(finance, 'members'),
        where('userId', '==', 'target-user'),
        limit(100)
      )
    )
  );
});

test('directory access grants no user, store or tenant mutation', async () => {
  const support = environment.authenticatedContext('support-a').firestore();

  await assertFails(
    updateDoc(doc(support, 'users', 'target-user'), {
      name: 'Alteração indevida',
      updatedAt: serverTimestamp(),
    })
  );
  await assertFails(
    updateDoc(doc(support, 'stores', 'owned-store'), {
      plan: 'free',
      updatedAt: serverTimestamp(),
    })
  );
  await assertFails(
    updateDoc(doc(support, 'tenants', 'target-user'), {
      status: 'blocked',
    })
  );
});

test('successful directory search audit is strict and immutable', async () => {
  const support = environment.authenticatedContext('support-a').firestore();
  const auditPath = doc(
    support,
    'kyrub_admin',
    'control_plane',
    'audit_logs',
    'directory_search_a'
  );

  await assertSucceeds(
    setDoc(auditPath, {
      id: 'directory_search_a',
      action: 'admin.directory.user.searched',
      actorId: 'support-a',
      actorRole: 'support',
      targetType: 'user',
      targetId: 'target-user',
      source: 'client',
      createdAt: serverTimestamp(),
    })
  );

  await assertFails(updateDoc(auditPath, { targetId: 'another-user' }));
  await assertFails(
    setDoc(
      doc(
        support,
        'kyrub_admin',
        'control_plane',
        'audit_logs',
        'directory_search_invalid'
      ),
      {
        id: 'directory_search_invalid',
        action: 'admin.directory.user.searched',
        actorId: 'support-a',
        actorRole: 'support',
        targetType: 'store',
        targetId: 'owned-store',
        source: 'client',
        createdAt: serverTimestamp(),
      }
    )
  );
});
