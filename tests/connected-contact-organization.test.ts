import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const appSource = readFileSync('src/App.tsx', 'utf8');
const profileSource = readFileSync(
  'src/components/ProfileSocialHubNative.tsx',
  'utf8'
);

test('connected organization is owned by the native React profile hub', () => {
  assert.match(appSource, /<ProfileSocialHubNative\s*\/?>/);
  assert.doesNotMatch(appSource, /ProfileConnectionSubtabsBridge/);
  assert.doesNotMatch(appSource, /ProfileConnectedGroupsBridge/);
  assert.doesNotMatch(appSource, /ProfileConnectedCardOrganizationBridge/);
  assert.doesNotMatch(profileSource, /MutationObserver/);
});

test('connected tabs use the simplified approved order', () => {
  const generalIndex = profileSource.indexOf("label: 'Geral'");
  const frequentIndex = profileSource.indexOf("label: 'Frequentes'");
  const groupsIndex = profileSource.indexOf("label: 'Grupos'");
  const newButtonIndex = profileSource.indexOf('aria-label="Abrir novas conexões"');

  assert.ok(generalIndex >= 0);
  assert.ok(generalIndex < frequentIndex);
  assert.ok(frequentIndex < groupsIndex);
  assert.ok(groupsIndex < newButtonIndex);
  assert.match(profileSource, /grid grid-cols-4 gap-2/);
  assert.match(profileSource, />\s*Novos\s*</);
  assert.doesNotMatch(profileSource, /label: 'Sugestões'/);
  assert.doesNotMatch(profileSource, /label: 'Solicitações'/);
});

test('Novos opens a native modal with requests before suggestions', () => {
  const requestsIndex = profileSource.indexOf('Solicitações {requestCount}');
  const suggestionsIndex = profileSource.indexOf('Sugestões {suggestionCount}');

  assert.match(profileSource, /type NewConnectionsTab = 'requests' \| 'suggestions'/);
  assert.match(profileSource, /newConnectionsOpen/);
  assert.match(profileSource, /openNewConnections/);
  assert.match(profileSource, /aria-label="Tipos de novos contatos"/);
  assert.ok(requestsIndex >= 0);
  assert.ok(requestsIndex < suggestionsIndex);
  assert.match(profileSource, /newConnectionsTab === 'requests'/);
  assert.match(profileSource, /newConnectionsTab === 'suggestions'/);
  assert.doesNotMatch(profileSource, /connectionSection === 'requests'/);
  assert.doesNotMatch(profileSource, /connectionSection === 'suggestions'/);
});

test('frequent contacts are filtered in React and receive an empty state', () => {
  assert.match(profileSource, /friend\.favorited/);
  assert.match(
    profileSource,
    /directory\.friends[\s\S]*\.filter\(friend => friend\.favorited\)/
  );
  assert.match(profileSource, /Nenhum favorito/);
  assert.match(profileSource, /Use a estrela nos contatos/);
});

test('contact cards keep compact favorite, chat and remove actions', () => {
  assert.match(profileSource, /function ContactCard/);
  assert.match(profileSource, /aria-label=\{[\s\S]*Favoritar contato/);
  assert.match(profileSource, /<MessageCircle className="h-4 w-4"/);
  assert.match(profileSource, /aria-label=\{`Remover \$\{friend\.name\}`\}/);
  assert.match(profileSource, /grid-cols-\[1fr_42px\]/);
  assert.match(profileSource, /aspect-\[4\/3\]/);
});

test('group management reuses private groups and updates membership natively', () => {
  assert.match(profileSource, /users\/\$\{user\.uid\}\/contact_groups/);
  assert.match(profileSource, /toggleGroupMember/);
  assert.match(profileSource, /group\.memberIds\.includes\(friendId\)/);
  assert.match(profileSource, /group\.memberIds\.filter\(id => id !== friendId\)/);
  assert.match(profileSource, /deleteGroup/);
});
