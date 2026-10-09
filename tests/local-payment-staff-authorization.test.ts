import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { hasStorePermission, parseStoreMember } from '../src/utils/storeSecurity';
import { canCreateLocalStorePayment } from '../server/attendance/localPaymentAuthorization';

const authorization = readFileSync('server/attendance/localPaymentAuthorization.ts', 'utf8');
const intent = readFileSync('server/attendance/localPaymentIntentService.ts', 'utf8');
const pix = readFileSync('server/attendance/localStoreOwnedPixService.ts', 'utf8');

test('local payment authorization is canonical, live, and fail closed', () => {
  assert.match(authorization, /if \(!actorUserId \|\| !legacyStoreId \|\| !canonicalStoreId\) return false/);
  assert.match(authorization, /actorUserId === legacyStoreId/);
  assert.match(authorization, /stores\/\$\{canonicalStoreId\}\/members\/\$\{actorUserId\}/);
  assert.match(authorization, /parseStoreMember\(memberData\)/);
  assert.match(authorization, /member\.storeId === canonicalStoreId/);
  assert.match(authorization, /member\.userId === actorUserId/);
  assert.match(authorization, /member\.status === 'active'/);
  assert.match(authorization, /hasStorePermission\(member\.role, 'payments\.create'\)/);
});

test('both payment entrypoints enforce the shared authorization before writes or provider operations', () => {
  for (const service of [intent, pix]) {
    assert.match(service, /await canCreateLocalStorePayment\(/);
    assert.match(service, /actorUserId, legacyStoreId: request\.storeId, canonicalStoreId: storeContext\.canonicalStoreId/);
  }
  assert.ok(intent.indexOf('await canCreateLocalStorePayment(') < intent.indexOf('adminDb.runTransaction('));
  const pixAttach = pix.slice(pix.indexOf('export const attachStoreOwnedPixToLocalIntent'));
  assert.ok(pixAttach.indexOf('await canCreateLocalStorePayment(') < pixAttach.indexOf('adminDb.runTransaction('));
});


test('payment permission matrix rejects suspended, removed, cross-store and production membership', () => {
  const eligibleRoles = ['owner', 'manager', 'cashier', 'seller'] as const;
  for (const role of eligibleRoles) {
    const member = parseStoreMember({ storeId: 'canonical-a', userId: 'staff-a', role, status: 'active' });
    assert.ok(member && member.status === 'active' && hasStorePermission(member.role, 'payments.create'));
  }
  const production = parseStoreMember({ storeId: 'canonical-a', userId: 'staff-a', role: 'production', status: 'active' });
  assert.ok(production && !hasStorePermission(production.role, 'payments.create'));
  for (const status of ['invited', 'suspended', 'removed'] as const) {
    const member = parseStoreMember({ storeId: 'canonical-a', userId: 'staff-a', role: 'cashier', status });
    assert.ok(member && member.status !== 'active');
  }
  const crossStore = parseStoreMember({ storeId: 'canonical-b', userId: 'staff-a', role: 'cashier', status: 'active' });
  assert.ok(crossStore && crossStore.storeId !== 'canonical-a');
  const crossUser = parseStoreMember({ storeId: 'canonical-a', userId: 'staff-b', role: 'cashier', status: 'active' });
  assert.ok(crossUser && crossUser.userId !== 'staff-a');
  assert.equal(parseStoreMember({ storeId: 'canonical-a', userId: 'staff-a', role: 'administrator', status: 'active' }), null);
});


test('live payment authorization reads each staff membership and fails closed after revocation', async () => {
  const input = { actorUserId: 'staff-a', legacyStoreId: 'owner-a', canonicalStoreId: 'canonical-a' };
  let current: unknown = { storeId: 'canonical-a', userId: 'staff-a', role: 'cashier', status: 'active' };
  let reads = 0;
  const check = () => canCreateLocalStorePayment({ ...input, readMember: async (storeId, actorId) => {
    reads++;
    assert.equal(storeId, 'canonical-a');
    assert.equal(actorId, 'staff-a');
    return current;
  } });
  assert.equal(await check(), true);
  current = { storeId: 'canonical-a', userId: 'staff-a', role: 'cashier', status: 'suspended' };
  assert.equal(await check(), false);
  current = undefined;
  assert.equal(await check(), false);
  current = { storeId: 'canonical-b', userId: 'staff-a', role: 'cashier', status: 'active' };
  assert.equal(await check(), false);
  current = { storeId: 'canonical-a', userId: 'staff-b', role: 'cashier', status: 'active' };
  assert.equal(await check(), false);
  current = { storeId: 'canonical-a', userId: 'staff-a', role: 'production', status: 'active' };
  assert.equal(await check(), false);
  assert.equal(reads, 6);
  assert.equal(await canCreateLocalStorePayment({ ...input, actorUserId: 'owner-a', readMember: async () => { throw new Error('owner should not require member'); } }), true);
  assert.equal(await canCreateLocalStorePayment({ ...input, actorUserId: '', readMember: async () => current }), false);
});
