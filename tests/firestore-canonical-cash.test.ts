import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';

const PROJECT_ID = 'kyrub-security-test';
const STORE_ID = 'store-cash-a';
const LEGACY_STORE_ID = 'owner-a';
const SESSION_ID = 'cash-session-a';
let environment: RulesTestEnvironment;

const storeRecord = () => ({
  id: STORE_ID,
  ownerId: 'owner-a',
  name: 'Loja Caixa',
  publicationStatus: 'paused',
  plan: 'free',
  legacyTenantId: LEGACY_STORE_ID,
  migrationStatus: 'dual_write',
  createdAt: Timestamp.fromMillis(1_700_000_000_000),
  updatedAt: Timestamp.fromMillis(1_700_000_000_000),
});

const memberRecord = (userId: string, role: string) => ({
  storeId: STORE_ID,
  storeName: 'Loja Caixa',
  userId,
  displayName: userId,
  email: `${userId}@example.com`,
  photoUrl: '',
  role,
  status: 'active',
  invitedBy: 'owner-a',
  invitedAt: Timestamp.fromMillis(1_700_000_000_000),
  acceptedAt: Timestamp.fromMillis(1_700_000_000_000),
  suspendedAt: '',
  removedAt: '',
  createdAt: Timestamp.fromMillis(1_700_000_000_000),
  updatedAt: Timestamp.fromMillis(1_700_000_000_000),
});

const openSession = (
  actorUserId = 'owner-a',
  actorRole = 'owner',
  actorName = 'Proprietário'
) => ({
  id: SESSION_ID,
  storeId: STORE_ID,
  status: 'open',
  operatorUserId: actorUserId,
  operatorRole: actorRole,
  operatorName: actorName,
  openingAmount: 100,
  expectedAmount: 100,
  countedAmount: 0,
  difference: 0,
  openedAt: serverTimestamp(),
  closedAt: '',
  closedByUserId: '',
  closedByRole: '',
  closedByName: '',
  closeReason: '',
  deviceId: 'device-a',
  legacyStoreId: LEGACY_STORE_ID,
  migration: { mode: 'write_through', source: 'dexie' },
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

const movement = (
  actorUserId = 'cashier-a',
  actorRole = 'cashier',
  overrides: Record<string, unknown> = {}
) => ({
  id: 'cash-movement-a',
  storeId: STORE_ID,
  sessionId: SESSION_ID,
  type: 'supply',
  direction: 'in',
  amount: 20,
  description: 'Troco adicional',
  category: 'Suprimento de caixa',
  reason: '',
  actorUserId,
  actorRole,
  actorName: actorUserId,
  source: 'manual',
  paymentId: '',
  deviceId: 'device-a',
  legacyStoreId: LEGACY_STORE_ID,
  occurredAt: serverTimestamp(),
  createdAt: serverTimestamp(),
  ...overrides,
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
    await setDoc(doc(firestore, 'stores', STORE_ID), storeRecord());
    await Promise.all([
      setDoc(doc(firestore, 'stores', STORE_ID, 'members', 'manager-a'), memberRecord('manager-a', 'manager')),
      setDoc(doc(firestore, 'stores', STORE_ID, 'members', 'cashier-a'), memberRecord('cashier-a', 'cashier')),
      setDoc(doc(firestore, 'stores', STORE_ID, 'members', 'seller-a'), memberRecord('seller-a', 'seller')),
      setDoc(doc(firestore, 'stores', STORE_ID, 'members', 'production-a'), memberRecord('production-a', 'production')),
    ]);
  });
});

after(async () => {
  await environment.cleanup();
});

test('owner and cashier can open a cash session while seller is denied', async () => {
  const owner = environment.authenticatedContext('owner-a').firestore();
  await assertSucceeds(
    setDoc(doc(owner, 'stores', STORE_ID, 'cashSessions', SESSION_ID), openSession())
  );

  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    const firestore = context.firestore();
    await setDoc(doc(firestore, 'stores', STORE_ID), storeRecord());
    await setDoc(
      doc(firestore, 'stores', STORE_ID, 'members', 'cashier-a'),
      memberRecord('cashier-a', 'cashier')
    );
    await setDoc(
      doc(firestore, 'stores', STORE_ID, 'members', 'seller-a'),
      memberRecord('seller-a', 'seller')
    );
  });

  const cashier = environment.authenticatedContext('cashier-a').firestore();
  await assertSucceeds(
    setDoc(
      doc(cashier, 'stores', STORE_ID, 'cashSessions', SESSION_ID),
      openSession('cashier-a', 'cashier', 'Caixa')
    )
  );

  const seller = environment.authenticatedContext('seller-a').firestore();
  await assertFails(
    setDoc(
      doc(seller, 'stores', STORE_ID, 'cashSessions', 'cash-session-b'),
      { ...openSession('seller-a', 'seller', 'Vendedor'), id: 'cash-session-b' }
    )
  );
});

test('cashier creates append-only supply and withdrawal movements', async () => {
  const cashier = environment.authenticatedContext('cashier-a').firestore();
  await assertSucceeds(
    setDoc(
      doc(cashier, 'stores', STORE_ID, 'cashSessions', SESSION_ID),
      openSession('cashier-a', 'cashier', 'Caixa')
    )
  );

  const supplyReference = doc(
    cashier,
    'stores',
    STORE_ID,
    'cashSessions',
    SESSION_ID,
    'movements',
    'cash-movement-a'
  );
  await assertSucceeds(setDoc(supplyReference, movement()));

  const withdrawalReference = doc(
    cashier,
    'stores',
    STORE_ID,
    'cashSessions',
    SESSION_ID,
    'movements',
    'cash-movement-b'
  );
  await assertSucceeds(
    setDoc(
      withdrawalReference,
      movement('cashier-a', 'cashier', {
        id: 'cash-movement-b',
        type: 'withdrawal',
        direction: 'out',
        amount: 10,
        description: 'Retirada para cofre',
        category: 'Sangria',
        reason: 'Limite de numerário no caixa',
      })
    )
  );

  await assertFails(updateDoc(supplyReference, { amount: 999 }));
  await assertFails(deleteDoc(withdrawalReference));
});

test('withdrawal without reason and movement with mismatched direction are denied', async () => {
  const cashier = environment.authenticatedContext('cashier-a').firestore();
  await assertSucceeds(
    setDoc(
      doc(cashier, 'stores', STORE_ID, 'cashSessions', SESSION_ID),
      openSession('cashier-a', 'cashier', 'Caixa')
    )
  );

  await assertFails(
    setDoc(
      doc(cashier, 'stores', STORE_ID, 'cashSessions', SESSION_ID, 'movements', 'bad-a'),
      movement('cashier-a', 'cashier', {
        id: 'bad-a',
        type: 'withdrawal',
        direction: 'out',
        reason: '',
      })
    )
  );

  await assertFails(
    setDoc(
      doc(cashier, 'stores', STORE_ID, 'cashSessions', SESSION_ID, 'movements', 'bad-b'),
      movement('cashier-a', 'cashier', {
        id: 'bad-b',
        type: 'supply',
        direction: 'out',
      })
    )
  );
});

test('manager closes an open session with exact financial difference and cannot reopen it', async () => {
  const cashier = environment.authenticatedContext('cashier-a').firestore();
  const sessionReference = doc(cashier, 'stores', STORE_ID, 'cashSessions', SESSION_ID);
  await assertSucceeds(
    setDoc(sessionReference, openSession('cashier-a', 'cashier', 'Caixa'))
  );

  const manager = environment.authenticatedContext('manager-a').firestore();
  const managerReference = doc(manager, 'stores', STORE_ID, 'cashSessions', SESSION_ID);
  await assertSucceeds(
    updateDoc(managerReference, {
      status: 'closed',
      expectedAmount: 120,
      countedAmount: 115,
      difference: -5,
      closedAt: serverTimestamp(),
      closedByUserId: 'manager-a',
      closedByRole: 'manager',
      closedByName: 'Gerente',
      closeReason: 'Diferença em conferência manual',
      updatedAt: serverTimestamp(),
    })
  );

  await assertFails(
    updateDoc(managerReference, {
      status: 'open',
      updatedAt: serverTimestamp(),
    })
  );
});

test('financial reads are limited to owner, manager and cashier', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(
      doc(context.firestore(), 'stores', STORE_ID, 'cashSessions', SESSION_ID),
      {
        ...openSession(),
        openedAt: Timestamp.fromMillis(1_700_000_000_000),
        createdAt: Timestamp.fromMillis(1_700_000_000_000),
        updatedAt: Timestamp.fromMillis(1_700_000_000_000),
      }
    );
  });

  const owner = environment.authenticatedContext('owner-a').firestore();
  const manager = environment.authenticatedContext('manager-a').firestore();
  const cashier = environment.authenticatedContext('cashier-a').firestore();
  const seller = environment.authenticatedContext('seller-a').firestore();
  const production = environment.authenticatedContext('production-a').firestore();

  await assertSucceeds(getDoc(doc(owner, 'stores', STORE_ID, 'cashSessions', SESSION_ID)));
  await assertSucceeds(getDoc(doc(manager, 'stores', STORE_ID, 'cashSessions', SESSION_ID)));
  await assertSucceeds(getDoc(doc(cashier, 'stores', STORE_ID, 'cashSessions', SESSION_ID)));
  await assertFails(getDoc(doc(seller, 'stores', STORE_ID, 'cashSessions', SESSION_ID)));
  await assertFails(getDoc(doc(production, 'stores', STORE_ID, 'cashSessions', SESSION_ID)));
});


test('server-managed Cash sessions reject direct Firebase client movements and close attempts', async () => {
  const managedId = 'cash-session-managed-operation-1234';
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(
      doc(context.firestore(), 'stores', STORE_ID, 'cashSessions', managedId),
      {
        ...openSession('cashier-a', 'cashier', 'Caixa Bruno'),
        id: managedId,
        deviceId: 'server-managed-register',
        registerId: 'register-01',
        openOperationId: 'managed-operation-1234',
        shiftLabel: 'Manhã',
        revision: 0,
        openingMinor: 10000,
        movementNetMinor: 0,
        movementCount: 0,
      }
    );
  });

  const cashier = environment.authenticatedContext('cashier-a').firestore();
  const manager = environment.authenticatedContext('manager-a').firestore();
  const owner = environment.authenticatedContext('owner-a').firestore();
  const path = ['stores', STORE_ID, 'cashSessions', managedId] as const;

  await assertSucceeds(getDoc(doc(cashier, ...path)));

  await assertFails(
    setDoc(
      doc(cashier, ...path, 'movements', 'cash-movement-managed-blocked'),
      movement('cashier-a', 'cashier', {
        id: 'cash-movement-managed-blocked',
        sessionId: managedId,
        deviceId: 'device-a',
      })
    )
  );

  await assertFails(
    setDoc(
      doc(owner, ...path, 'movements', 'cash-movement-owner-blocked'),
      movement('owner-a', 'owner', {
        id: 'cash-movement-owner-blocked',
        sessionId: managedId,
        deviceId: 'device-owner',
      })
    )
  );

  await assertFails(
    updateDoc(doc(manager, ...path), {
      status: 'closed',
      expectedAmount: 100,
      countedAmount: 100,
      difference: 0,
      closedAt: serverTimestamp(),
      closedByUserId: 'manager-a',
      closedByRole: 'manager',
      closedByName: 'Gerente',
      closeReason: '',
      updatedAt: serverTimestamp(),
    })
  );
});

test('legacy client cannot impersonate server-managed session identity', async () => {
  const cashier = environment.authenticatedContext('cashier-a').firestore();
  const id = 'cash-session-forged-managed';
  await assertFails(
    setDoc(
      doc(cashier, 'stores', STORE_ID, 'cashSessions', id),
      {
        ...openSession('cashier-a', 'cashier', 'Caixa'),
        id,
        deviceId: 'server-managed-register',
      }
    )
  );
});


test('missing coordination document keeps authorized legacy cash working', async () => {
  const cashier = environment.authenticatedContext('cashier-a').firestore();
  await assertSucceeds(setDoc(
    doc(cashier, 'stores', STORE_ID, 'cashSessions', SESSION_ID),
    openSession('cashier-a', 'cashier', 'Caixa')
  ));
  await assertSucceeds(setDoc(
    doc(cashier, 'stores', STORE_ID, 'cashSessions', SESSION_ID, 'movements', 'cash-movement-a'),
    movement()
  ));
});

for (const mode of ['frozen', 'managed', 'unknown']) {
  test(`server-owned coordination mode ${mode} blocks ALL client-side legacy cash mutation`, async () => {
    await environment.withSecurityRulesDisabled(async context => {
      const firestore = context.firestore();
      await setDoc(doc(firestore, 'stores', STORE_ID, 'cashCoordination', 'current'), {
        mode,
        storeId: STORE_ID,
        schemaVersion: 1,
        cutoverOperationId: 'test-cutover-1234',
      });
      await setDoc(doc(firestore, 'stores', STORE_ID, 'cashSessions', SESSION_ID), {
        ...openSession('cashier-a', 'cashier', 'Caixa'),
        openedAt: Timestamp.fromMillis(1_700_000_000_000),
        createdAt: Timestamp.fromMillis(1_700_000_000_000),
        updatedAt: Timestamp.fromMillis(1_700_000_000_000),
      });
    });
    const cashier = environment.authenticatedContext('cashier-a').firestore();
    const manager = environment.authenticatedContext('manager-a').firestore();
    const owner = environment.authenticatedContext('owner-a').firestore();
    const session = doc(cashier, 'stores', STORE_ID, 'cashSessions', SESSION_ID);

    await assertFails(setDoc(doc(cashier, 'stores', STORE_ID, 'cashSessions', 'cash-session-new'), {
      ...openSession('cashier-a', 'cashier', 'Caixa'), id: 'cash-session-new',
    }));
    await assertFails(setDoc(
      doc(cashier, 'stores', STORE_ID, 'cashSessions', SESSION_ID, 'movements', 'cash-movement-a'),
      movement()
    ));
    await assertFails(updateDoc(doc(manager, 'stores', STORE_ID, 'cashSessions', SESSION_ID), {
      status: 'closed',
      expectedAmount: 100,
      countedAmount: 100,
      difference: 0,
      closedAt: serverTimestamp(),
      closedByUserId: 'manager-a',
      closedByRole: 'manager',
      closedByName: 'Gerente',
      closeReason: '',
      updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(getDoc(session));
    const control = doc(owner, 'stores', STORE_ID, 'cashCoordination', 'current');
    await assertSucceeds(getDoc(control));
    await assertFails(updateDoc(control, { mode: 'legacy' }));
    await assertFails(deleteDoc(control));
  });
}

test('client cannot forge cashCoordination document or read it without cash role', async () => {
  const owner = environment.authenticatedContext('owner-a').firestore();
  const seller = environment.authenticatedContext('seller-a').firestore();
  const control = doc(owner, 'stores', STORE_ID, 'cashCoordination', 'current');
  await assertFails(setDoc(control, {
    mode: 'managed', storeId: STORE_ID, schemaVersion: 1, cutoverOperationId: 'request-12345',
  }));
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'stores', STORE_ID, 'cashCoordination', 'current'), {
      mode: 'legacy', storeId: STORE_ID, schemaVersion: 1, cutoverOperationId: 'request-12345',
    });
  });
  await assertFails(getDoc(doc(seller, 'stores', STORE_ID, 'cashCoordination', 'current')));
});
