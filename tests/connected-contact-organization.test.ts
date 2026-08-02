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

test('connected subtabs are rendered directly in the approved order', () => {
  const listIndex = profileSource.indexOf("label: 'Minha lista'");
  const favoritesIndex = profileSource.indexOf("label: 'Favoritos'");
  const suggestionsIndex = profileSource.indexOf("label: 'Sugestões'");
  const groupsIndex = profileSource.indexOf("label: 'Grupos'");
  const requestsIndex = profileSource.indexOf("label: 'Solicitações'");

  assert.ok(listIndex >= 0);
  assert.ok(listIndex < favoritesIndex);
  assert.ok(favoritesIndex < suggestionsIndex);
  assert.ok(suggestionsIndex < groupsIndex);
  assert.ok(groupsIndex < requestsIndex);
  assert.match(profileSource, /aria-label="Seções de conectados"/);
  assert.match(profileSource, /overflow-x-auto/);
});

test('favorite contacts are filtered in React and receive an empty state', () => {
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
