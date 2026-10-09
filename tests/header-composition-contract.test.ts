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


test('marketplace activation has exactly one click owner', () => {
  assert.ok(workspace.includes("onClick={() => openKyrubDestination('marketplace')}"));
  assert.ok(activation.includes("target.closest('#header-praca-trigger')"));
  assert.ok(!activation.includes("'#header-praca-trigger, #header-marketplace-trigger'"));
});

test('workspace header portals are mounted and cleaned up together', () => {
  for (const host of ['currentDiscoveryHost', 'currentNotesHost']) {
    assert.ok(workspace.includes(`${host} = document.createElement('div')`));
    assert.ok(workspace.includes(`${host}?.remove()`));
  }
  assert.ok(workspace.includes('observer.disconnect()'));
  assert.ok(workspace.includes("document.removeEventListener('click', handleDocumentClick, true)"));
  assert.ok(activation.includes("document.removeEventListener('click', handleHeaderShortcutClick, true)"));
});


test('canonical account header is compact and profile is not hidden by workspace CSS', () => {
  assert.ok(legacy.includes('id="header-user-profile-trigger"'));
  assert.ok(legacy.includes('aria-label="Abrir meu perfil"'));
  assert.ok(legacy.includes('aria-label="Abrir Carteira"'));
  assert.ok(workspace.includes('order: 1;'));
  assert.ok(!workspace.includes('#app-header #header-user-profile-trigger {\n          display: none !important;'));
  assert.ok(!legacy.includes('id="toggle-balance-visibility-btn"'));
});

test('marketplace shortcut uses a single cancellable pending navigation frame', () => {
  assert.ok(workspace.includes('const pendingKyrubActivationFrame = useRef<number | null>(null)'));
  assert.ok(workspace.includes('pendingKyrubActivationFrame.current !== null'));
  assert.ok(workspace.includes('window.cancelAnimationFrame(pendingKyrubActivationFrame.current)'));
  assert.ok(workspace.includes('pendingKyrubActivationAttempts.current >= 24'));
  assert.ok(workspace.includes('clearPendingKyrubActivation();\n      observer.disconnect();'));
  assert.ok(workspace.includes('schedulePendingKyrubActivation();'));
  assert.ok(!workspace.includes('activatePendingKyrubDestination(attempt + 1)'));
});
