import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const profileSource = readFileSync(
  'src/components/modals/UserProfileModal.tsx',
  'utf8'
);
const savedLibrarySource = readFileSync(
  'src/utils/savedLibrary.ts',
  'utf8'
);
const publicFeedSource = readFileSync(
  'src/components/PublicSocialFeedPanel.tsx',
  'utf8'
);
const communitiesSource = readFileSync(
  'src/components/ProfileCommunitiesCloudBridge.tsx',
  'utf8'
);
const kyrubWrapperSource = readFileSync(
  'src/components/tabs/KyrubTab.tsx',
  'utf8'
);
const globalCss = readFileSync('src/index.css', 'utf8');

test('Meu perfil is a private personal center instead of a publishing surface', () => {
  assert.match(profileSource, /Seu centro pessoal é privado/);
  assert.match(profileSource, />Comunidades<\/strong>/);
  assert.match(profileSource, /Salvos/);
  assert.match(profileSource, /Conta/);
  assert.doesNotMatch(profileSource, /id="profile-publication-composer"/);
  assert.doesNotMatch(profileSource, /id="profile-publication-register"/);
  assert.doesNotMatch(profileSource, /publicationType: 'feed' \| 'status'/);
});

test('Conta keeps account, data, security and verification settings', () => {
  assert.match(profileSource, /setIsSettingsOpen\(true\)/);
  assert.match(profileSource, /ProfileSettingsPanel/);
  assert.match(profileSource, /label: 'Conta'/);
  assert.match(profileSource, /label: 'Dados'/);
  assert.match(profileSource, /label: 'Segurança'/);
  assert.match(profileSource, /label: 'Verificação'/);
  assert.match(profileSource, /Perfil visível na Praça/);
});

test('Praça and Comunidades save canonical publications into the private library', () => {
  assert.match(savedLibrarySource, /users', user\.uid, 'savedItems'/);
  assert.match(savedLibrarySource, /sourceKind: SavedSourceKind/);
  assert.match(savedLibrarySource, /path = item\.sourceKind === 'community' \? 'community_posts' : 'social_posts'/);
  assert.match(savedLibrarySource, /setSavedPublicationSelections/);
  assert.match(profileSource, /subscribeSavedPublications/);
  assert.match(profileSource, /subscribeSelections/);
  assert.match(publicFeedSource, /savePublication\('praca', post\.id\)/);
  assert.match(communitiesSource, /savePublication\('community', post\.id\)/);
  assert.match(kyrubWrapperSource, /usePublicSocialFeed/);
  assert.match(kyrubWrapperSource, /<PublicSocialFeedPanel/);
});

test('Praça Recentes no longer displays the old publication composer', () => {
  assert.match(globalCss, /#kyrub-tab-container section:has\(/);
  assert.match(
    globalCss,
    /textarea\[placeholder="O que está acontecendo no seu negócio ou região\?"\]/
  );
  assert.match(globalCss, /display: none/);
});
