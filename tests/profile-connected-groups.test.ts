import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const appSource = readFileSync('src/App.tsx', 'utf8');
const profileSource = readFileSync(
  'src/components/ProfileSocialHubNative.tsx',
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
  test('mounts the connected experience inside the native profile hub', () => {
    assert.match(appSource, /ProfileSocialHubNative/);
    assert.doesNotMatch(appSource, /ProfileSocialMobileFirstBridge/);
    assert.doesNotMatch(appSource, /ProfileConnectedGroupsBridge/);
    assert.match(profileSource, /type ConnectionSection/);
    assert.match(profileSource, /id: 'groups'/);
  });

  test('uses the latest active status as the connected card cover', () => {
    assert.match(profileSource, /const STATUS_TTL_MS = 24 \* 60 \* 60 \* 1000/);
    assert.match(profileSource, /connectedStatusByAuthor/);
    assert.match(profileSource, /latestStatus\?\.mediaUrls\?\.\[0\] \|\| friend\.avatar/);
    assert.match(profileSource, /Status · \{remainingStatusLabel/);
  });

  test('keeps accepted contacts directly actionable without DOM proxies', () => {
    assert.match(profileSource, /function ContactCard/);
    assert.match(profileSource, /onChat/);
    assert.match(profileSource, /setChatTarget\(friend\)/);
    assert.match(profileSource, /onRemove/);
    assert.match(profileSource, /directory\.handleToggleFriend\(friend\.id\)/);
    assert.doesNotMatch(profileSource, /data-kyrub-connected-profile-trigger/);
  });

  test('renders Grupos after Frequentes and before Novos', () => {
    const frequentIndex = profileSource.indexOf("label: 'Frequentes'");
    const groupsIndex = profileSource.indexOf("label: 'Grupos'");
    const newButtonIndex = profileSource.indexOf('aria-label="Abrir novas conexões"');
    assert.ok(frequentIndex >= 0);
    assert.ok(frequentIndex < groupsIndex);
    assert.ok(groupsIndex < newButtonIndex);
    assert.match(profileSource, /connectionSection === 'groups'/);
  });

  test('persists private contact groups and manages accepted members', () => {
    assert.match(profileSource, /users\/\$\{user\.uid\}\/contact_groups/);
    assert.match(profileSource, /MAX_GROUPS = 30/);
    assert.match(profileSource, /MAX_GROUP_MEMBERS = 200/);
    assert.match(profileSource, /toggleGroupMember/);
    assert.match(profileSource, /deleteGroup/);
    assert.match(profileSource, /Nome do novo grupo/);
  });

  test('composes owner-only contact group rules', () => {
    assert.match(composeSource, /firestore\.contact-groups\.fragment\.rules/);
    assert.match(rulesSource, /match \/users\/\{userId\}\/contact_groups\/\{groupId\}/);
    assert.match(rulesSource, /request\.auth\.uid == userId/);
    assert.match(rulesSource, /data\.memberIds\.size\(\) <= 200/);
    assert.match(rulesSource, /allow delete/);
  });
});
