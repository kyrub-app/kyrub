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
