import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KYRUB_PLANNED_ACTION_REGISTRY,
} from '../shared/kyrubActions';
import { authorizeStoreActionContext } from '../src/actions/storeActionAuthorization';
import type {
  CanonicalStoreRecord,
  StoreMemberDirectoryRecord,
} from '../src/utils/storeDirectory';

const store: CanonicalStoreRecord = {
  id: 'store-demo',
  ownerId: 'owner-1',
  name: 'Loja Demo',
  publicationStatus: 'paused',
  plan: 'free',
  legacyTenantId: 'owner-1',
  migrationStatus: 'dual_write',
  createdAt: '2026-08-07T00:00:00.000Z',
  updatedAt: '2026-08-07T00:00:00.000Z',
};

const member = (
  role: StoreMemberDirectoryRecord['role'],
  status: StoreMemberDirectoryRecord['status'] = 'active'
): StoreMemberDirectoryRecord => ({
  storeId: store.id,
  storeName: store.name,
  userId: 'member-1',
  displayName: 'Membro',
  email: 'member@example.com',
  photoUrl: '',
  role,
  status,
  invitedBy: store.ownerId,
  invitedAt: '',
  acceptedAt: '',
  suspendedAt: '',
  removedAt: '',
  createdAt: '',
  updatedAt: '',
});

test('planned ERP writes are explicit and require confirmation', () => {
  assert.equal(
    KYRUB_PLANNED_ACTION_REGISTRY.create_product_draft.permission,
    'products.write'
  );
  assert.equal(
    KYRUB_PLANNED_ACTION_REGISTRY.create_product_draft.requiresConfirmation,
    true
  );
  assert.equal(
    KYRUB_PLANNED_ACTION_REGISTRY.adjust_inventory.risk,
    'high'
  );
  assert.equal(
    KYRUB_PLANNED_ACTION_REGISTRY.import_catalog_draft.requiresConfirmation,
    true
  );
  assert.equal(
    KYRUB_PLANNED_ACTION_REGISTRY.analyze_catalog.mode,
    'read'
  );
});

test('owner is authorized by canonical ownership, not by conversation context', () => {
  const result = authorizeStoreActionContext(
    'owner-1',
    store,
    null,
    'products.write'
  );
  assert.equal(result.role, 'owner');
  assert.equal(result.store.id, store.id);
});

test('active member is authorized only when role grants the requested permission', () => {
  const manager = authorizeStoreActionContext(
    'member-1',
    store,
    member('manager'),
    'products.write'
  );
  assert.equal(manager.role, 'manager');

  assert.throws(
    () => authorizeStoreActionContext(
      'member-1',
      store,
      member('seller'),
      'products.write'
    ),
    /não permite executar esta ação/i
  );
});

test('invited, suspended and unrelated users cannot authorize ERP writes', () => {
  assert.throws(
    () => authorizeStoreActionContext(
      'member-1',
      store,
      member('manager', 'invited'),
      'products.write'
    ),
    /não está ativo/i
  );

  assert.throws(
    () => authorizeStoreActionContext(
      'member-1',
      store,
      member('manager', 'suspended'),
      'products.write'
    ),
    /não está ativo/i
  );

  assert.throws(
    () => authorizeStoreActionContext(
      'outsider-1',
      store,
      null,
      'products.write'
    ),
    /não possui acesso/i
  );
});
