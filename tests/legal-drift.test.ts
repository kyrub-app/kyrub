import assert from 'node:assert/strict';
import test from 'node:test';
import { detectLegalDrift } from '../shared/legalDrift';

test('material payment/AI changes identify impacted governance documents', () => {
  const result = detectLegalDrift({ domains: ['payments', 'ai'], material: true });
  assert.equal(result.material, true);
  assert.equal(result.requiresHumanReview, true);
  assert.ok(result.impactedDocuments.includes('payments'));
  assert.ok(result.impactedDocuments.includes('ai'));
  assert.ok(result.impactedDocuments.includes('privacy'));
});

test('legal drift detector never turns a non-material change into an approval gate', () => {
  assert.deepEqual(
    detectLegalDrift({ domains: ['payments'], material: false }),
    { material: false, impactedDocuments: [], requiresHumanReview: false }
  );
});

test('detector signals review rather than auto-publishing legal text', () => {
  const result = detectLegalDrift({ domains: ['store_connections'], material: true });
  assert.equal(result.requiresHumanReview, true);
  assert.match(result.message ?? '', /Revisão humana necessária/);
});
