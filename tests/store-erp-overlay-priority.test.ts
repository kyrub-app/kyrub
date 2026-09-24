import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync('src/main.tsx', 'utf8');
const overlayStyles = readFileSync('src/styles/store-erp-overlay.css', 'utf8');
const workspaceNavigation = readFileSync(
  'src/components/WorkspacePrimaryNavigationBridge.tsx',
  'utf8'
);

test('store ERP overlay styles are loaded by the application entrypoint', () => {
  assert.match(mainSource, /import '\.\/styles\/store-erp-overlay\.css';/);
});

test('store ERP overlay sits above the global workspace chrome without removing it', () => {
  assert.match(
    overlayStyles,
    /div\.fixed\.inset-0:has\(> #erp-main-header\)[\s\S]*z-index:\s*190\s*!important/
  );
  assert.match(workspaceNavigation, /#app-header[\s\S]*z-index:\s*160\s*!important/);
  assert.doesNotMatch(overlayStyles, /display:\s*none/);
});
