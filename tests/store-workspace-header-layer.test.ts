import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync('src/styles/store-workspace-header-layer.css', 'utf8');
const main = readFileSync('src/main.tsx', 'utf8');
const legacyApp = readFileSync('src/LegacyApp.tsx', 'utf8');
const primaryNavigation = readFileSync(
  'src/components/WorkspacePrimaryNavigationBridge.tsx',
  'utf8'
);

test('retailer workspace header can visually cover the global app header', () => {
  assert.match(legacyApp, /id="erp-main-header"/);
  assert.match(primaryNavigation, /#app-header\s*\{/);
  assert.match(primaryNavigation, /z-index:\s*160\s*!important/);
  assert.match(
    css,
    /body:has\(#erp-main-header\)\s+#app-header\s*\{[\s\S]*z-index:\s*30\s*!important/
  );
});

test('store header layering is loaded globally without unmounting either header', () => {
  assert.match(main, /store-workspace-header-layer\.css/);
  assert.doesNotMatch(css, /display:\s*none/);
  assert.doesNotMatch(css, /visibility:\s*hidden/);
});
