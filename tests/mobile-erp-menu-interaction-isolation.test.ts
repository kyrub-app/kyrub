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

  test('preserves the persistent known-good drawer stacking contract', () => {
    assert.match(source, /hidden=\{!isOpen\}/);
    assert.match(source, /className="pointer-events-auto fixed inset-0 z-\[200\]"/);
    assert.match(source, /data-kyrub-skip-top-overlay="true"/);
  });

  test('does not reintroduce competing touch handlers', () => {
    assert.doesNotMatch(source, /onTouchStart=/);
    assert.doesNotMatch(source, /onTouchEnd=/);
    assert.doesNotMatch(source, /event\.preventDefault\(\)/);
    assert.match(source, /onClick=\{\(\) => handleSelect\(item\.id\)\}/);
  });
});
