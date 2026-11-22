import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  canReadStaffNotice,
  validateStaffNoticeInput,
  STAFF_NOTICE_MAX_AUDIENCE,
  STAFF_NOTICE_MAX_BODY,
} from '../shared/staffNotices';

const repoFile = (path: string) => readFileSync(path, 'utf8');

test('staff notices are validated and bounded before any server write', () => {
  const input = {
    requestId: 'notice_1234567890',
    title: ' Abertura da loja ',
    body: ' Conferir vitrines e extintores ',
    audienceRoles: ['seller'],
  };
  assert.deepEqual(validateStaffNoticeInput(input), {
    id: 'notice_1234567890',
    title: 'Abertura da loja',
    body: 'Conferir vitrines e extintores',
    audienceRoles: ['seller'],
  });
  assert.throws(() => validateStaffNoticeInput({ ...input, body: 'a'.repeat(STAFF_NOTICE_MAX_BODY + 1) }));
  assert.throws(() => validateStaffNoticeInput({ ...input, requestId: '../leak' }));
  assert.throws(() => validateStaffNoticeInput({ ...input, title: '' }));
  assert.throws(() => validateStaffNoticeInput({ ...input, audienceRoles: ['seller', 'seller'] }));
  assert.throws(() => validateStaffNoticeInput({ ...input, audienceRoles: ['owner'] }));
  assert.throws(() => validateStaffNoticeInput({ ...input, audienceRoles: ['cashier', 'manager', 'seller', 'production', 'owner'] }));
  assert.equal(STAFF_NOTICE_MAX_AUDIENCE, 4);
});

test('employee notice audience does not grant unauthorized roles', () => {
  const notice = { status: 'published' as const, audienceRoles: ['cashier' as const] };
  assert.equal(canReadStaffNotice('cashier', notice), true);
  assert.equal(canReadStaffNotice('production', notice), false);
  assert.equal(canReadStaffNotice('seller', notice), false);
  assert.equal(canReadStaffNotice('owner', notice), true);
  assert.equal(canReadStaffNotice('seller', { ...notice, audienceRoles: [] }), true);
  assert.equal(canReadStaffNotice('cashier', { ...notice, status: 'draft' as never }), false);
});

test('store-scoped notices use canonical active membership, no direct Firestore browser writes', () => {
  const service = repoFile('server/staff/staffNoticeService.ts');
  const transport = repoFile('server/staff/staffNoticeTransport.ts');
  const ui = repoFile('src/utils/staffNotices.ts');
  const editor = repoFile('src/components/store/StoreStaffNoticeManager.tsx');
  const inbox = repoFile('src/components/store/StoreStaffNoticeInbox.tsx');
  const point = repoFile('src/components/LegacyRetailerPanel.tsx');
  const health = repoFile('api/health.ts');
  const server = repoFile('server.ts');
  const vercel = repoFile('vercel.json');
  assert.match(service, /verifyFirebaseIdToken/);
  assert.match(service, /parseStoreMember/);
  assert.match(service, /member\.status !== 'active'/);
  assert.match(service, /clean\(store\.get\('ownerId'\)\) !== legacyStoreId/);
  assert.match(service, /actor\.role !== 'owner' && actor\.role !== 'manager'/);
  assert.match(service, /tx\.get\(doc\.ref\)/);
  assert.match(service, /tx\.create\(noticeRef, notice\)/);
  assert.match(service, /buildUserNotification/);
  assert.match(service, /STAFF_NOTICE_IDEMPOTENCY_CONFLICT/);
  assert.match(transport, /status: 403/);
  assert.match(health, /transport === 'staff-notices'/);
  assert.match(server, /createStaffNoticeRouter\(\)/);
  assert.match(vercel, /"transport=staff-notices"/);
  assert.match(ui, /user\.getIdToken\(\)/);
  assert.match(editor, /publishStaffNotice/);
  assert.match(inbox, /confirmStaffNoticeRead/);
  assert.match(point, /<StoreStaffNoticeInbox storeId=\{activeRetailerId\} \/>/);
  assert.doesNotMatch(ui + editor + inbox, /collection\(db|setDoc\(|updateDoc\(/);
});
