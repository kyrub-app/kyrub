import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const legacyApp = readFileSync(new URL('../src/LegacyApp.tsx', import.meta.url), 'utf8');
const staffViewport = readFileSync(new URL('../src/components/StaffViewport.tsx', import.meta.url), 'utf8');

test('staff route has no shared demo credentials', () => {
  assert.doesNotMatch(legacyApp, /staff@kyrub\.com/);
  assert.doesNotMatch(legacyApp, /kyrub123/);
  assert.doesNotMatch(staffViewport, /staff@kyrub\.com/);
  assert.doesNotMatch(staffViewport, /kyrub123/);
});

test('staff route resolves canonical store memberships', () => {
  assert.match(legacyApp, /subscribeToUserStoreAccess/);
  assert.match(legacyApp, /access\.status === 'active'/);
  assert.match(staffViewport, /STORE_ROLE_LABELS/);
  assert.match(staffViewport, /Sem acesso operacional ativo/);
});

test('staff route does not create a second password login', () => {
  assert.doesNotMatch(staffViewport, /type="password"/);
  assert.doesNotMatch(legacyApp, /setIsStaffLoggedIn/);
});
