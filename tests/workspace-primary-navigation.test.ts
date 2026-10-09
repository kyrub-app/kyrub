import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const main = readFileSync('src/main.tsx', 'utf8');
const legacy = readFileSync('src/LegacyApp.tsx', 'utf8');
const header = readFileSync('src/components/AppHeader.tsx', 'utf8');
const bottomNav = readFileSync('src/components/WorkspacePrimaryNavigationBridge.tsx', 'utf8');
const navStyles = readFileSync('src/styles/workspace-navigation.css', 'utf8');
const socialHub = readFileSync('src/components/ProfileSocialHubNative.tsx', 'utf8');

test('Renda stays the default and the native header owns all shortcuts', () => {
  assert.match(legacy, /useState<'perfil' \| 'renda' \| 'kyrub'>\('renda'\)/);
  assert.match(legacy, /<AppHeader/);
  assert.match(header, /id="header-marketplace-trigger"/);
  assert.match(header, /id="header-notes-trigger"/);
  assert.match(header, /id="header-wallet-balance"/);
  assert.match(header, /<UserNotificationCenter/);
  assert.doesNotMatch(bottomNav, /createPortal|header-marketplace-trigger|header-notes-trigger/);
});

test('Marketplace targets Ofertas directly and Notas targets the existing productivity page', () => {
  assert.match(legacy, /setSocialSubTab\('lojas'\);[\s\S]*setActiveTab\('kyrub'\);/);
  assert.match(legacy, /onNotes=\{\(\) => \{[\s\S]*setActiveTab\('perfil'\);/);
  assert.match(legacy, /activeTab === 'perfil'/);
  assert.match(legacy, /<PerfilTab/);
  assert.doesNotMatch(bottomNav, /pendingKyrubDestination|requestAnimationFrame\(\(\) => activatePendingKyrubDestination/);
});

test('the bottom entry continues to open Praça without a second header owner', () => {
  assert.match(main, /<WorkspacePrimaryNavigationBridge \/>/);
  assert.match(bottomNav, /data-kyrub-social-entry/);
  assert.match(bottomNav, /label\.textContent = 'Praça'/);
  assert.match(bottomNav, /new CustomEvent/);
  assert.match(bottomNav, /section: 'square'/);
  assert.doesNotMatch(bottomNav, /activateProfileSquare|requestAnimationFrame|squareButton\.click/);
  assert.match(bottomNav, /kyrub-personal-page-open-requested/);
  assert.match(socialHub, /requestedSection === 'square'/);
  assert.match(bottomNav, /closeSocialHub\(\)/);
  assert.match(navStyles, /#profile-social-hub-modal/);
  assert.match(navStyles, /--kyrub-workspace-header-height/);
  assert.match(navStyles, /--kyrub-workspace-nav-height/);
});

test('bottom nav layout and profile surface stay separate from header control styling', () => {
  assert.match(navStyles, /data-kyrub-primary-workspace-nav/);
  assert.match(navStyles, /data-kyrub-social-entry/);
  assert.doesNotMatch(navStyles, /#app-header|header-wallet-balance|header-marketplace-trigger/);
  assert.doesNotMatch(bottomNav, /header\.appendChild|setDiscoveryHost|setNotesHost/);
});
