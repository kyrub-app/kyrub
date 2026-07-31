import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const appSource = readFileSync('src/App.tsx', 'utf8');
const bridgeSource = readFileSync(
  'src/components/ProfileConnectedCardOrganizationBridge.tsx',
  'utf8'
);

test('connected organization bridge is mounted after status and group decoration', () => {
  assert.match(
    appSource,
    /<ProfileConnectedGroupsBridge\s*\/>[\s\S]*<ProfileConnectedCardOrganizationBridge\s*\/>/
  );
});

test('favorites is inserted after Minha lista and groups moves after Sugestões', () => {
  assert.match(bridgeSource, /listButton\.insertAdjacentElement\('afterend', host\)/);
  assert.match(bridgeSource, /nav\.insertBefore\(groupsHost, requestsButton\)/);
  assert.match(bridgeSource, />\s*Favoritos\s*</);
  assert.match(bridgeSource, /data-kyrub-connection-organization-subnav/);
  assert.match(bridgeSource, /overflow-x: auto !important/);
});

test('favorite cards are filtered and receive an empty state', () => {
  assert.match(bridgeSource, /data-kyrub-contact-favorite-state/);
  assert.match(bridgeSource, /data-kyrub-favorites-mode/);
  assert.match(bridgeSource, /Nenhum contato favorito/);
  assert.match(bridgeSource, /Use a estrela no card/);
});

test('card actions use compact chat and a three-dot management menu', () => {
  assert.match(bridgeSource, /data-kyrub-contact-chat-proxy/);
  assert.match(bridgeSource, /data-kyrub-contact-menu-trigger/);
  assert.match(bridgeSource, /\[data-kyrub-contact-actions="true"\][\s\S]*display: none !important/);
  assert.match(bridgeSource, /\[data-kyrub-contact-favorite="true"\][\s\S]*right: 52px !important/);
  assert.match(bridgeSource, /Gerenciar grupos/);
  assert.match(bridgeSource, /Adicionar a grupo/);
  assert.match(bridgeSource, /Remover conexão/);
});

test('group management reuses private groups and cleans membership before disconnecting', () => {
  assert.match(bridgeSource, /users\/\$\{user\.uid\}\/contact_groups/);
  assert.match(bridgeSource, /memberIds: \[groupContact\.id\]/);
  assert.match(bridgeSource, /group\.memberIds\.filter\([\s\S]*removeContact\.id/);
  assert.match(bridgeSource, /removeButton\.click\(\)/);
});
