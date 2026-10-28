import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rules = readFileSync('firestore.store-security.fragment.rules', 'utf8');
const productDualWriteRules = readFileSync(
  'firestore.product-dual-write.fragment.rules',
  'utf8'
);

test('canonical security rules cover every protected store resource', () => {
  [
    'match /stores/{storeId}',
    'match /members/{userId}',
    'match /orders/{orderId}',
    'match /payments/{paymentId}',
    'match /cashSessions/{sessionId}',
    'match /auditLogs/{logId}',
  ].forEach(fragment => assert.match(rules, new RegExp(fragment.replace(/[{}]/g, '\\$&'))));
});

test('canonical store fragment does not reopen the legacy artifacts wildcard', () => {
  assert.doesNotMatch(rules, /match \/artifacts\/\{[^}]+\}/);
});

test('seller payment reads are constrained to the authenticated actor', () => {
  assert.match(
    rules,
    /storeSecActiveRole\(storeId, \['seller'\]\)[\s\S]*resource\.data\.actorUserId == request\.auth\.uid/
  );
});

test('manager hierarchy excludes manager and owner targets', () => {
  assert.match(
    rules,
    /storeSecManagerCanManageRole\(role\)[\s\S]*\['cashier', 'seller', 'production'\]/
  );
  assert.doesNotMatch(
    rules,
    /storeSecManagerCanManageRole\(role\)[\s\S]{0,120}\['owner'/
  );
});

test('audit records are append-only and bind actor identity to auth', () => {
  assert.match(
    rules,
    /match \/auditLogs\/\{logId\}[\s\S]*incoming\(\)\.actorUserId == request\.auth\.uid/
  );
  assert.match(
    rules,
    /match \/auditLogs\/\{logId\}[\s\S]*allow update, delete: if false/
  );
});

test('canonical product dual-write accepts current product shape without reopening server provenance', () => {
  [
    'isComplimentary',
    'storePointsPerUnit',
    'actionOrigin',
    'actionExecutionId',
  ].forEach(field => assert.match(productDualWriteRules, new RegExp(`'${field}'`)));

  assert.match(
    productDualWriteRules,
    /storePointsPerUnit is number[\s\S]*storePointsPerUnit >= 0/
  );
  assert.match(
    productDualWriteRules,
    /canonicalProductServerProvenanceIsImmutable\(\)[\s\S]*diff\(existing\(\)\)[\s\S]*affectedKeys\(\)[\s\S]*actionOrigin[\s\S]*actionExecutionId/
  );
  assert.match(
    productDualWriteRules,
    /allow create:[\s\S]*!incoming\(\)\.keys\(\)\.hasAny\(\['actionOrigin', 'actionExecutionId'\]\)/
  );
  assert.match(
    productDualWriteRules,
    /allow update:[\s\S]*canonicalProductServerProvenanceIsImmutable\(\)/
  );
});

test('external invitation tokens remain server-only in the canonical rules', () => {
  assert.match(rules, /match \/externalTeamInvitations\/\{invitationId\}\s*\{\s*allow read, write: if false;/);
});

test('production and emulator configurations share the composed rules artifact', () => {
  for (const config of ['firebase.json', 'firebase.security.json']) {
    const parsed = JSON.parse(readFileSync(config, 'utf8')) as { firestore?: { rules?: string } };
    assert.equal(parsed.firestore?.rules, '.firebase/firestore.combined.rules');
  }
  const composer = readFileSync('scripts/compose-firestore-rules.mjs', 'utf8');
  assert.match(composer, /firestore\.store-security\.fragment\.rules/);
  assert.doesNotMatch(composer, /resolve\(root, 'firestore\.store-security\.rules'\)/);
});
