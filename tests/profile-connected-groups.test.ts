import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const appSource = readFileSync('src/App.tsx', 'utf8');
const bridgeSource = readFileSync(
  'src/components/ProfileConnectedGroupsBridge.tsx',
  'utf8'
);
const rulesSource = readFileSync(
  'firestore.contact-groups.fragment.rules',
  'utf8'
);
const composeSource = readFileSync(
  'scripts/compose-firestore-rules.mjs',
  'utf8'
);

describe('connected status covers and private groups', () => {
  test('mounts the connected experience bridge after the mobile-first cards', () => {
    assert.match(appSource, /ProfileConnectedGroupsBridge/);
    assert.ok(
      appSource.indexOf('<ProfileSocialMobileFirstBridge') <
        appSource.indexOf('<ProfileConnectedGroupsBridge')
    );
  });

  test('uses the latest active status as the connected card cover', () => {
    assert.match(bridgeSource, /const STATUS_TTL_MS = 24 \* 60 \* 60 \* 1000/);
    assert.match(bridgeSource, /latestStatusByAuthor/);
    assert.match(bridgeSource, /data-kyrub-connected-status-cover/);
    assert.match(bridgeSource, /status\?\.mediaUrls\?\.\[0\]/);
    assert.match(bridgeSource, /data-kyrub-connected-status-text/);
    assert.match(bridgeSource, /Status ·/);
  });

  test('keeps a clickable circular profile thumbnail for connected users', () => {
    assert.match(bridgeSource, /data-kyrub-connected-profile-trigger/);
    assert.match(bridgeSource, /Abrir perfil de/);
    assert.match(bridgeSource, /setSelectedProfile\(friend\)/);
    assert.match(bridgeSource, /Perfil conectado/);
    assert.match(bridgeSource, /post\.authorId === selectedProfile\?\.id/);
    assert.match(bridgeSource, /post\.publicationType !== 'status'/);
  });

  test('inserts Grupos between Minha lista and Sugestões', () => {
    assert.match(bridgeSource, /findButtonByText\(modal, 'Minha lista'\)/);
    assert.match(bridgeSource, /findButtonByText\(modal, 'Sugestões'\)/);
    assert.match(bridgeSource, /nav\.insertBefore\(buttonHost, suggestionsButton\)/);
    assert.match(bridgeSource, /data-kyrub-groups-subtab/);
    assert.match(bridgeSource, />\s*Grupos\s*</);
  });

  test('persists private contact groups and manages accepted members', () => {
    assert.match(bridgeSource, /users\/\$\{user\.uid\}\/contact_groups/);
    assert.match(bridgeSource, /MAX_GROUPS = 30/);
    assert.match(bridgeSource, /MAX_GROUP_MEMBERS = 200/);
    assert.match(bridgeSource, /toggleGroupMember/);
    assert.match(bridgeSource, /Confirmar exclusão/);
  });

  test('composes owner-only contact group rules', () => {
    assert.match(composeSource, /firestore\.contact-groups\.fragment\.rules/);
    assert.match(rulesSource, /match \/users\/\{userId\}\/contact_groups\/\{groupId\}/);
    assert.match(rulesSource, /request\.auth\.uid == userId/);
    assert.match(rulesSource, /data\.memberIds\.size\(\) <= 200/);
    assert.match(rulesSource, /allow delete/);
  });
});
