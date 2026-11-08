import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panel = readFileSync('src/components/admin/AdminOfficialPlanRenewalAction.tsx', 'utf8');

test('official mapping assignment omits rewards and uses existing authenticated endpoint', () => {
  assert.match(panel, /admin\.official-plan-product\.assign/);
  assert.match(panel, /JSON\.stringify\(\{ planId: plan\.planId, productId: plan\.productId \}\)/);
  assert.match(panel, /user\.getIdToken\(true\)/);
});
test('requires confirmation and a fresh exact canonical mapping audit', () => {
  assert.match(panel, /!mappingConfirmed/);
  assert.match(panel, /mappingCount !== 0/);
  assert.match(panel, /safeToConsiderMissingMapping/);
  assert.match(panel, /canonicalStoreId !== 'store-ae53dc42e57eb9d5c3f7151c1431'/);
});
