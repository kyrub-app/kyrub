import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const audit = readFileSync('server/admin/officialPlanMappingAudit.ts', 'utf8');
const route = readFileSync('api/plan-control.ts', 'utf8');
const panel = readFileSync('src/components/admin/AdminOfficialPlanRenewalAction.tsx', 'utf8');

test('mapping audit requires Super Admin and only reads Firestore', () => {
  assert.match(audit, /admin\.role !== 'super_admin'/);
  assert.match(audit, /adminDb\.collection\(ROOT\)\.get\(\)/);
  assert.match(audit, /adminDb\.collection\(`stores\/\$\{storeId\}\/products`\)\.get\(\)/);
  assert.doesNotMatch(audit, /transaction\.(set|update|delete)|adminDb\.runTransaction|\.set\(|\.update\(|\.delete\(/);
});
test('audit checks all mappings including other active and orphaned records', () => {
  assert.match(audit, /mappingSnapshot\.docs\.map/);
  assert.match(audit, /productExists: products\.has\(doc\.id\)/);
  assert.match(audit, /OTHER_ACTIVE_MAPPING_FOR_PLAN/);
  assert.match(audit, /OFFICIAL_MAPPING_MISSING/);
});
test('audit is a protected GET and exposed in existing Super Admin panel', () => {
  assert.match(route, /case 'admin\.official-plan-product\.mapping-audit'/);
  assert.match(route, /auditOfficialPlanMappings\(authorization\)/);
  assert.match(panel, /Auditar vínculos oficiais \(somente leitura\)/);
  assert.match(panel, /method: 'POST'/); // Existing repair stays separate.
});
