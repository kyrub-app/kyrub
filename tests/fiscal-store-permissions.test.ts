import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  FISCAL_STORE_PERMISSIONS,
  STORE_ROLE_PERMISSIONS,
  hasStoreFiscalPermission,
  hasStorePermission,
  type StoreRole,
} from '../src/utils/storeSecurity';

const storeSecuritySource = readFileSync('src/utils/storeSecurity.ts', 'utf8');
const institutionalIdentitySource = readFileSync(
  'shared/storeInstitutionalIdentity.ts',
  'utf8'
);

test('canonical fiscal permissions are explicit and homologation-only', () => {
  assert.deepEqual(FISCAL_STORE_PERMISSIONS, [
    'fiscal.read',
    'fiscal.policy.manage',
    'fiscal.homologation.emit',
  ]);
  assert.doesNotMatch(storeSecuritySource, /fiscal\.production\.emit/);
});

test('owner is the only canonical role with fiscal authority in the initial boundary', () => {
  for (const permission of FISCAL_STORE_PERMISSIONS) {
    assert.equal(hasStoreFiscalPermission('owner', permission), true);
  }

  const deniedRoles: StoreRole[] = [
    'manager',
    'cashier',
    'seller',
    'production',
  ];
  for (const role of deniedRoles) {
    for (const permission of FISCAL_STORE_PERMISSIONS) {
      assert.equal(
        hasStoreFiscalPermission(role, permission),
        false,
        `${role} must not inherit ${permission}`
      );
    }
  }
});

test('generic operational powers do not imply fiscal emission authority', () => {
  assert.equal(hasStorePermission('manager', 'store.update'), true);
  assert.equal(hasStorePermission('cashier', 'payments.create'), true);
  assert.equal(hasStorePermission('cashier', 'cash.manage'), true);
  assert.equal(hasStorePermission('production', 'production.update'), true);

  assert.equal(hasStorePermission('manager', 'fiscal.homologation.emit'), false);
  assert.equal(hasStorePermission('cashier', 'fiscal.homologation.emit'), false);
  assert.equal(hasStorePermission('seller', 'fiscal.homologation.emit'), false);
  assert.equal(hasStorePermission('production', 'fiscal.homologation.emit'), false);
});

test('institutional attendant vocabulary remains separate from canonical fiscal membership authority', () => {
  assert.match(institutionalIdentitySource, /StoreInstitutionalRole = 'owner' \| 'manager' \| 'attendant'/);
  assert.match(institutionalIdentitySource, /attendant: \['relationship_read', 'conversation_act'\]/);
  assert.doesNotMatch(institutionalIdentitySource, /fiscal\.homologation\.emit/);
  assert.doesNotMatch(institutionalIdentitySource, /fiscal\.policy\.manage/);
});

test('manager permission expansion remains explicit instead of inheriting future fiscal permissions', () => {
  assert.equal(
    STORE_ROLE_PERMISSIONS.manager.some(permission => permission.startsWith('fiscal.')),
    false
  );
  assert.match(storeSecuritySource, /!isFiscalStorePermission\(permission\)/);
});
