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
const profilePolish = readFileSync('src/components/ProfileNextPolishBridge.tsx', 'utf8');
const identityRecovery = readFileSync('src/components/ProfileIdentityRecoveryBridge.tsx', 'utf8');

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

test('pressed header states describe the selected destination, not merely the parent tab', () => {
  assert.match(header, /aria-pressed=\{marketplaceActive\}/);
  assert.match(header, /aria-pressed=\{notesActive\}/);
  assert.match(legacy, /marketplaceActive=\{activeTab === 'kyrub' && socialSubTab === 'lojas'\}/);
  assert.match(legacy, /notesActive=\{activeTab === 'perfil'\}/);
  assert.doesNotMatch(header, /aria-pressed=\{activeSection === 'kyrub'\}/);
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

test('remaining active profile bridges cannot inject a second header button', () => {
  assert.doesNotMatch(profilePolish, /personalPageHeaderTarget|personal-page-header-slot|header-user-profile-trigger/);
  assert.doesNotMatch(profilePolish, /getElementById\('app-header'\)/);
  assert.doesNotMatch(identityRecovery, /syncLegacyHeader|header-user-profile-trigger|\.src\s*=|\.textContent\s*=/);
  assert.match(identityRecovery, /kyrub-profile-identity-updated/);
  assert.match(legacy, /window\.addEventListener\('kyrub-profile-identity-updated'/);
  assert.match(legacy, /detail\.uid !== auth\.currentUser\?\.uid/);
});

test('production visual parity keeps native shortcut order and branded profile fallback', () => {
  const shortcutSequence = [
    'aria-label="Sair"',
    'id="header-user-profile-trigger"',
    'id="header-marketplace-trigger"',
    'id="header-notes-trigger"',
    'id="header-wallet-balance"',
    'data-header-notifications-slot="true"',
  ];
  const positions = shortcutSequence.map(needle => header.indexOf(needle));
  assert.ok(positions.every(position => position >= 0), 'every production shortcut exists');
  assert.ok(positions.every((position, index) => index === 0 || position > positions[index - 1]),
    'header shortcuts follow the production mobile order');
  assert.ok(header.includes('mr-auto hover:text-red-400'), 'logout is separated from primary shortcuts');
  assert.ok(header.includes('ml-auto shrink-0'), 'notification bell aligns independently at the far right');
  assert.ok(header.includes("'/kyrub-logo.svg'"), 'empty or failed profile photo uses the official Kyrub brand');
  assert.ok(header.includes('failedPhotoUrl !== profilePhotoUrl'), 'invalid profile photos fall back without a legacy DOM patch');
  const officialLogo = readFileSync('public/kyrub-logo.svg', 'utf8');
  assert.ok(officialLogo.includes('<title id="title">Kyrub</title>'));
  assert.doesNotMatch(header, /createPortal|MutationObserver|appendChild/);
  assert.doesNotMatch(bottomNav, /header-user-profile-trigger|header-marketplace-trigger|header-notes-trigger/);
  assert.ok(notifications.includes('max-[390px]:h-9 max-[390px]:w-9'));
});
