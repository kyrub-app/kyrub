import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rules = readFileSync('firestore.store-security.rules', 'utf8');
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

test('canonical rules do not reopen the legacy artifacts wildcard', () => {
  assert.doesNotMatch(rules, /match \/artifacts\/\{[^}]+\}/);
  assert.match(rules, /match \/\{document=\*\*\}[\s\S]*allow read, write: if false/);
});

test('seller payment reads are constrained to the authenticated actor', () => {
  assert.match(
    rules,
    /activeRole\(storeId, \['seller'\]\)[\s\S]*resource\.data\.actorUserId == request\.auth\.uid/
  );
});

test('manager hierarchy excludes manager and owner targets', () => {
  assert.match(
    rules,
    /managerCanManageRole\(role\)[\s\S]*\['cashier', 'seller', 'production'\]/
  );
  assert.doesNotMatch(
    rules,
    /managerCanManageRole\(role\)[\s\S]{0,120}\['owner'/
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
