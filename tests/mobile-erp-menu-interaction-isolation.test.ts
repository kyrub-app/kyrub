import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const source = readFileSync('src/components/MobileErpMenu.tsx', 'utf8');

describe('mobile ERP drawer interaction isolation', () => {
  test('keeps the drawer outside the app root and disables background hit testing while open', () => {
    assert.match(source, /createPortal\(/);
    assert.match(source, /document\.body/);
    assert.match(source, /const appRoot = document\.getElementById\('root'\)/);
    assert.match(source, /appRoot\.inert = true/);
    assert.match(source, /appRoot\.inert = previousRootInert/);
    assert.match(source, /data-kyrub-mobile-erp-portal="true"/);
  });

  test('keeps the persistent portal above independent Gerencial surfaces', () => {
    assert.match(source, /hidden=\{!isOpen\}/);
    assert.match(source, /z-\[2147483647\]/);
    assert.match(source, /data-kyrub-skip-top-overlay="true"/);
  });

  test('does not reintroduce competing touch handlers', () => {
    assert.doesNotMatch(source, /onTouchStart=/);
    assert.doesNotMatch(source, /onTouchEnd=/);
    assert.doesNotMatch(source, /event\.preventDefault\(\)/);
    assert.match(source, /onClick=\{\(\) => handleSelect\(item\.id\)\}/);
  });
});
