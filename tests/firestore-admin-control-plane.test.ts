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
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';

const PROJECT_ID = 'kyrub-security-test';
let environment: RulesTestEnvironment;

const adminRecord = (
  uid: string,
  role: string,
  status = 'active'
) => ({
  uid,
  email: `${uid}@example.com`,
  displayName: uid,
  role,
  status,
  createdBy: 'bootstrap_admin',
  createdAt: Timestamp.fromMillis(1_700_000_000_000),
  updatedAt: Timestamp.fromMillis(1_700_000_000_000),
  suspendedAt: status === 'suspended' ? Timestamp.fromMillis(1_700_000_000_000) : '',
  revokedAt: status === 'revoked' ? Timestamp.fromMillis(1_700_000_000_000) : '',
});

const validAudit = (actorId: string, actorRole: string) => ({
  id: 'audit_session_a',
  action: 'admin.session.accessed',
  actorId,
  actorRole,
  targetType: 'control_plane',
  targetId: 'admin_portal',
  source: 'client',
  createdAt: serverTimestamp(),
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
        doc(firestore, 'kyrub_admin', 'control_plane', 'admins', 'super_admin_a'),
        adminRecord('super_admin_a', 'super_admin')
      ),
      setDoc(
        doc(firestore, 'kyrub_admin', 'control_plane', 'admins', 'support_a'),
        adminRecord('support_a', 'support')
      ),
      setDoc(
        doc(firestore, 'kyrub_admin', 'control_plane', 'admins', 'operations_a'),
        adminRecord('operations_a', 'operations')
      ),
      setDoc(
        doc(firestore, 'kyrub_admin', 'control_plane', 'admins', 'finance_a'),
        adminRecord('finance_a', 'finance')
      ),
      setDoc(
        doc(firestore, 'kyrub_admin', 'control_plane', 'admins', 'compliance_a'),
        adminRecord('compliance_a', 'compliance')
      ),
      setDoc(
        doc(firestore, 'kyrub_admin', 'control_plane', 'admins', 'suspended_a'),
        adminRecord('suspended_a', 'operations', 'suspended')
      ),
      setDoc(doc(firestore, 'users', 'user_a'), {
        uid: 'user_a',
        name: 'User A',
        email: 'user_a@example.com',
        photoUrl: '',
        isProfileVisible: true,
        createdAt: Timestamp.fromMillis(1_700_000_000_000),
        updatedAt: Timestamp.fromMillis(1_700_000_000_000),
      }),
      setDoc(doc(firestore, 'stores', 'store_admin_a'), {
        id: 'store_admin_a',
        ownerId: 'owner_a',
        name: 'Store A',
        publicationStatus: 'paused',
        plan: 'free',
        legacyTenantId: 'owner_a',
        migrationStatus: 'dual_write',
        createdAt: Timestamp.fromMillis(1_700_000_000_000),
        updatedAt: Timestamp.fromMillis(1_700_000_000_000),
      }),
    ]);
  });
});

after(async () => {
  await environment.cleanup();
});

test('a regular account cannot provision or inspect administrative identities', async () => {
  const regular = environment.authenticatedContext('regular_a').firestore();
  await assertFails(
    getDoc(doc(regular, 'kyrub_admin', 'control_plane', 'admins', 'support_a'))
  );
  await assertFails(
    setDoc(
      doc(regular, 'kyrub_admin', 'control_plane', 'admins', 'regular_a'),
      adminRecord('regular_a', 'super_admin')
    )
  );
});

test('an administrator can read its own record while only super admin can list administrators', async () => {
  const support = environment.authenticatedContext('support_a').firestore();
  await assertSucceeds(
    getDoc(doc(support, 'kyrub_admin', 'control_plane', 'admins', 'support_a'))
  );
  await assertFails(
    getDocs(collection(support, 'kyrub_admin', 'control_plane', 'admins'))
  );

  const superAdmin = environment.authenticatedContext('super_admin_a').firestore();
  await assertSucceeds(
    getDocs(collection(superAdmin, 'kyrub_admin', 'control_plane', 'admins'))
  );
});

test('an active administrator can append only a strict session audit event', async () => {
  const support = environment.authenticatedContext('support_a').firestore();
  const auditRef = doc(
    support,
    'kyrub_admin',
    'control_plane',
    'audit_logs',
    'audit_session_a'
  );

  await assertSucceeds(setDoc(auditRef, validAudit('support_a', 'support')));
  await assertFails(updateDoc(auditRef, { targetId: 'changed' }));
  await assertFails(deleteDoc(auditRef));

  await assertFails(
    setDoc(
      doc(
        support,
        'kyrub_admin',
        'control_plane',
        'audit_logs',
        'audit_arbitrary_a'
      ),
      {
        ...validAudit('support_a', 'support'),
        id: 'audit_arbitrary_a',
        action: 'admin.user.blocked',
      }
    )
  );
});

test('suspension blocks audit writes and compliance can inspect immutable events', async () => {
  const suspended = environment.authenticatedContext('suspended_a').firestore();
  await assertFails(
    setDoc(
      doc(
        suspended,
        'kyrub_admin',
        'control_plane',
        'audit_logs',
        'audit_suspended_a'
      ),
      {
        ...validAudit('suspended_a', 'operations'),
        id: 'audit_suspended_a',
      }
    )
  );

  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(
      doc(
        context.firestore(),
        'kyrub_admin',
        'control_plane',
        'audit_logs',
        'audit_existing_a'
      ),
      {
        ...validAudit('support_a', 'support'),
        id: 'audit_existing_a',
        createdAt: Timestamp.fromMillis(1_700_000_000_000),
      }
    );
  });

  const compliance = environment.authenticatedContext('compliance_a').firestore();
  await assertSucceeds(
    getDocs(collection(compliance, 'kyrub_admin', 'control_plane', 'audit_logs'))
  );

  const support = environment.authenticatedContext('support_a').firestore();
  await assertFails(
    getDocs(collection(support, 'kyrub_admin', 'control_plane', 'audit_logs'))
  );
});

test('operations can aggregate canonical stores while finance cannot enumerate them', async () => {
  const operations = environment.authenticatedContext('operations_a').firestore();
  await assertSucceeds(getDocs(collection(operations, 'stores')));

  const finance = environment.authenticatedContext('finance_a').firestore();
  await assertFails(getDocs(collection(finance, 'stores')));
});
