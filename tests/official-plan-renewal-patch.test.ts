import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const patch = readFileSync('server/admin/officialPlanRenewalPatch.ts', 'utf8');
const route = readFileSync('api/plan-control.ts', 'utf8');

test('renewal repair requires super admin and active official plan mapping', () => {
  assert.match(patch, /admin\.role !== 'super_admin'/);
  assert.match(patch, /map\?\.status !== 'active'/);
  assert.match(patch, /map\?\.planId !== input\.planId/);
  assert.match(patch, /map\?\.canonicalStoreId !== official\.canonicalStoreId/);
});
test('renewal repair only patches description and renewal field', () => {
  assert.match(patch, /transaction\.update\(productRef, \{\s*'saleModality\.subscription\.autoRenew': false,\s*description: input\.nextDescription,/);
  assert.doesNotMatch(patch, /transaction\.set\(productRef/);
  assert.match(patch, /data\?\.description !== input\.expectedDescription/);
  assert.match(patch, /data\?\.price !== prices\[input\.planId\]/);
});
test('admin route supports dry run and does not expose public GET write', () => {
  assert.match(route, /case 'admin\.official-plan-product\.renewal-patch'/);
  assert.match(route, /if \(method !== 'POST'\)/);
  assert.match(route, /apply: body\.apply === true/);
});

test('only simulation exposes a sanitized failing guard', () => {
  assert.match(patch, /input\.apply \? code : `\$\{code\}_\$\{reason\}`/);
  assert.match(patch, /!product\.exists\) conflict\('CANONICAL_PRODUCT_MISSING'\)/);
  assert.match(patch, /!mapping\.exists\) conflict\('OFFICIAL_MAPPING_MISSING'\)/);
  assert.match(patch, /data\?\.description !== input\.expectedDescription\) conflict\('DESCRIPTION_MISMATCH'\)/);
});

test('Pro-only simulation sends one dry run and exits before enabling apply', () => {
  const action = readFileSync('src/components/admin/AdminOfficialPlanRenewalAction.tsx', 'utf8');
  assert.match(action, /onClick=\{\(\) => void simulate\('pro'\)\}/);
  assert.match(action, /const PLANS = \[\s*\{ planId: 'pro'/);
  assert.match(action, /if \(scope === 'pro'\) \{\s*await patch\(user, PLANS\[0\], false\);\s*setMessage\([^\n]+\);\s*return;\s*\}/);
  assert.match(action, /setBusy\(true\); setSimulated\(false\); setConfirmed\(false\)/);
  assert.match(action, /disabled=\{busy \|\| !simulated \|\| !confirmed\}/);
});
