import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const authorization = readFileSync('server/attendance/localPaymentAuthorization.ts', 'utf8');
const intent = readFileSync('server/attendance/localPaymentIntentService.ts', 'utf8');
const pix = readFileSync('server/attendance/localStoreOwnedPixService.ts', 'utf8');

test('local payment authorization is canonical, live, and fail closed', () => {
  assert.match(authorization, /if \(!actorUserId \|\| !legacyStoreId \|\| !canonicalStoreId\) return false/);
  assert.match(authorization, /actorUserId === legacyStoreId/);
  assert.match(authorization, /stores\/\$\{canonicalStoreId\}\/members\/\$\{actorUserId\}/);
  assert.match(authorization, /parseStoreMember\(snapshot\.data\(\)\)/);
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
