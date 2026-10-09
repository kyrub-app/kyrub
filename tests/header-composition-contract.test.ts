import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const legacy = readFileSync('src/LegacyApp.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const main = readFileSync('src/main.tsx', 'utf8');
const header = readFileSync('src/components/AppHeader.tsx', 'utf8');
const bottomNav = readFileSync('src/components/WorkspacePrimaryNavigationBridge.tsx', 'utf8');
const notifications = readFileSync('src/components/UserNotificationCenter.tsx', 'utf8');
const profile = readFileSync('src/components/ProfileSocialHubNative.tsx', 'utf8');

test('exactly one authenticated header belongs to AppHeader (not a legacy DOM injection)', () => {
  assert.equal((header.match(/id="app-header"/g) ?? []).length, 1);
  assert.match(legacy, /<AppHeader/);
  assert.doesNotMatch(legacy, /id="app-header"/);
  assert.equal((main.match(/<WorkspacePrimaryNavigationBridge \/>/g) ?? []).length, 1);
  assert.doesNotMatch(main, /HeaderDiscoveryShortcutActivationBridge/);
  assert.doesNotMatch(app, /UserNotificationCenterBridge/);
  assert.doesNotMatch(header, /MutationObserver|createPortal|appendChild|document\.createElement/);
});

test('every header shortcut belongs to the same React header', () => {
  const ids = [
    'header-user-profile-trigger',
    'header-marketplace-trigger',
    'header-notes-trigger',
    'header-wallet-balance',
  ];
  for (const id of ids) {
    assert.match(header, new RegExp('id="' + id + '"'));
    assert.doesNotMatch(legacy, new RegExp('id="' + id + '"'));
    assert.doesNotMatch(bottomNav, new RegExp('id="' + id + '"'));
  }
  assert.match(header, /aria-label="Sair"/);
  assert.match(header, /<UserNotificationCenter/);
  assert.match(notifications, /id="canonical-notification-trigger"/);
  assert.doesNotMatch(notifications, /setHost|currentHost|header\.appendChild|MutationObserver/);
});

test('Marketplace and Notas navigate using application state, not hidden nav clicks', () => {
  assert.match(header, /onClick=\{\(\) => navigate\(onMarketplace\)\}/);
  assert.match(header, /onClick=\{\(\) => navigate\(onNotes\)\}/);
  assert.match(legacy, /onMarketplace=\{\(\) => \{[\s\S]*?setSocialSubTab\('lojas'\);[\s\S]*?setActiveTab\('kyrub'\);/);
  assert.match(legacy, /onNotes=\{\(\) => \{[\s\S]*?setActiveTab\('perfil'\);/);
  assert.doesNotMatch(bottomNav, /openKyrubDestination|pendingKyrubDestination|header-marketplace-trigger|header-notes-trigger/);
});

test('notification trigger lives in the header, but its panel remains a controlled modal', () => {
  assert.match(notifications, /open: boolean/);
  assert.match(notifications, /onOpenChange: \(value: boolean\) => void/);
  assert.match(notifications, /onClick=\{\(\) => onOpenChange\(!open\)\}/);
  assert.match(notifications, /id="canonical-notification-center"/);
  assert.match(notifications, /createPortal\(/);
  assert.doesNotMatch(notifications, /createPortal\(\s*<button/);
  assert.match(header, /if \(value\) onNotificationsOpen\(\)/);
});

test('profile ownership is explicit instead of capturing header clicks', () => {
  assert.match(header, /onClick=\{\(\) => navigate\(onProfile\)\}/);
  assert.match(legacy, /kyrub-personal-page-open-requested/);
  assert.match(profile, /window\.addEventListener\('kyrub-personal-page-open-requested'/);
  assert.match(profile, /window\.addEventListener\('kyrub-personal-page-close-requested'/);
  assert.doesNotMatch(profile, /closest\('#header-user-profile-trigger'\)/);
  assert.match(profile, /requestedSection === 'square' \? 'square' : 'publications'/);
});

test('the bottom navigation stays functional but cannot own header elements or styles', () => {
  assert.match(bottomNav, /data-kyrub-primary-workspace-nav/);
  assert.match(bottomNav, /new CustomEvent\('kyrub-personal-page-open-requested'/);
  assert.match(bottomNav, /detail: \{ section: 'square' \}/);
  assert.doesNotMatch(bottomNav, /activateProfileSquare|requestAnimationFrame|squareButton\.click/);
  assert.match(bottomNav, /observer\.disconnect\(\)/);
  assert.match(bottomNav, /document\.removeEventListener\('click', handleBottomNavigationClick, true\)/);
  assert.doesNotMatch(bottomNav, /createPortal|workspace-discovery-shortcuts-host|workspace-notes-shortcut-host/);
  assert.doesNotMatch(bottomNav, /#app-header|style>\{/);
  assert.match(main, /workspace-navigation\.css/);
});
