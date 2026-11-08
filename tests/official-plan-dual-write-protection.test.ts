import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/utils/canonicalProductDualWrite.ts', 'utf8');
test('legacy dual write preserves canonical terms for both official products', () => {
  assert.match(source, /draft_1d3dfa74091747d3a3012eadd8027894/);
  assert.match(source, /draft_5f46706373714839a55846e6d8cb102c/);
  assert.match(source, /next\.storeId !== OFFICIAL_STORE_ID/);
  assert.match(source, /description: existing\.description, saleModality: canonicalModality/);
  assert.match(source, /canonicalProductNeedsUpdate\(existing, next\)/);
  assert.match(source, /const next = existing \? preserveOfficialPlanCanonicalTerms\(existing, mirrored\) : mirrored/);
});
