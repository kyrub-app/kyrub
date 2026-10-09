import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const legacy = readFileSync('src/LegacyApp.tsx', 'utf8');
const entry = readFileSync('src/main.tsx', 'utf8');
const workspace = readFileSync('src/components/WorkspacePrimaryNavigationBridge.tsx', 'utf8');
const activation = readFileSync('src/components/HeaderDiscoveryShortcutActivationBridge.tsx', 'utf8');

test('the app header has one base owner and one workspace shortcut owner', () => {
  assert.equal((legacy.match(/id="app-header"/g) ?? []).length, 1);
  assert.equal((entry.match(/<WorkspacePrimaryNavigationBridge \/>/g) ?? []).length, 1);
  assert.equal((entry.match(/<HeaderDiscoveryShortcutActivationBridge \/>/g) ?? []).length, 1);
});

test('workspace shortcuts do not duplicate IDs in the legacy header', () => {
  for (const id of ['header-marketplace-trigger', 'header-notes-trigger']) {
    assert.ok(workspace.includes(`id="${id}"`), `Workspace must own ${id}`);
    assert.ok(!legacy.includes(`id="${id}"`), `Legacy header duplicates ${id}`);
  }
});

test('activation bridge recognizes the same workspace shortcut destinations', () => {
  assert.ok(activation.includes("target.closest('#header-praca-trigger')"));
  assert.ok(!activation.includes("'#header-praca-trigger, #header-marketplace-trigger'"));
  assert.ok(workspace.includes("openKyrubDestination('marketplace')"));
  assert.ok(workspace.includes("id=\"header-marketplace-trigger\""));
});

test('legacy header retains its account controls', () => {
  for (const id of ['header-user-profile-trigger', 'header-wallet-balance']) {
    assert.ok(legacy.includes(`id="${id}"`), `Missing account control ${id}`);
  }
});
