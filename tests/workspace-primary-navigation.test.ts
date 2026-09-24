import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync('src/main.tsx', 'utf8');
const legacySource = readFileSync('src/LegacyApp.tsx', 'utf8');
const navigationSource = readFileSync(
  'src/components/WorkspacePrimaryNavigationBridge.tsx',
  'utf8'
);
const socialHubSource = readFileSync(
  'src/components/ProfileSocialHubNative.tsx',
  'utf8'
);

test('workspace mounts the primary navigation bridge without changing Renda as the default tab', () => {
  assert.match(mainSource, /WorkspacePrimaryNavigationBridge/);
  assert.match(mainSource, /<WorkspacePrimaryNavigationBridge \/>/);
  assert.match(
    legacySource,
    /useState<'perfil' \| 'renda' \| 'kyrub'>\('renda'\)/
  );
});

test('Notas stays in the header while preserving the existing notes tab authority', () => {
  assert.match(navigationSource, /CheckSquare/);
  assert.match(navigationSource, /id="header-notes-trigger"/);
  assert.match(navigationSource, /aria-label="Abrir Notas"/);
  assert.match(navigationSource, /notesButton\.click\(\)/);
  assert.match(legacySource, /activeTab === 'perfil'/);
  assert.match(legacySource, /<PerfilTab/);
  assert.match(
    navigationSource,
    /#app-header #header-user-profile-trigger[\s\S]*display: none !important/
  );
});

test('bottom Notes entry is renamed directly to Social without overlaying both labels', () => {
  assert.match(navigationSource, /data-kyrub-social-entry/);
  assert.match(navigationSource, /label\.textContent = 'Social'/);
  assert.doesNotMatch(navigationSource, /content: 'Social'/);
  assert.match(navigationSource, /aria-label', 'Social'/);
});

test('Social reuses the canonical hub as a persistent workspace surface between header and bottom navigation', () => {
  assert.match(navigationSource, /findProfileTrigger\(\)\?\.click\(\)/);
  assert.match(socialHubSource, /closest\('#header-user-profile-trigger'\)/);
  assert.match(socialHubSource, /setOpen\(true\)/);
  assert.match(navigationSource, /--kyrub-workspace-header-height/);
  assert.match(navigationSource, /--kyrub-workspace-nav-height/);
  assert.match(navigationSource, /#profile-social-hub-modal > section/);
  assert.match(
    navigationSource,
    /#profile-social-hub-modal button\[aria-label="Fechar meu perfil"\][\s\S]*display: none !important/
  );
  assert.match(navigationSource, /nav\[\$\{PRIMARY_NAV_ATTRIBUTE\}="true"\]/);
});

test('leaving Social through the fixed primary navigation closes the social surface', () => {
  assert.match(navigationSource, /const closeSocialHub =/);
  assert.match(navigationSource, /closeSocialHub\(\);/);
  assert.match(navigationSource, /setSocialActive\(false\)/);
});
