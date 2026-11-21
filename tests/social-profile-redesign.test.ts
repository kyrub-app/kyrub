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
const communityMetricsSource = readFileSync(
  'src/utils/communityOrganicMetrics.ts',
  'utf8'
);
const kyrubWrapperSource = readFileSync(
  'src/components/tabs/KyrubTab.tsx',
  'utf8'
);
const globalCss = readFileSync('src/index.css', 'utf8');

test('Meu perfil is a private financial and identity center instead of a publishing surface', () => {
  assert.match(profileSource, /Central Pessoal/);
  assert.match(profileSource, /Carteira Kairube/);
  for (const title of ['Movimentações', 'Controle financeiro', 'Pitangas', 'XP e conquistas']) {
    assert.ok(profileSource.includes(title));
  }
  assert.match(profileSource, /Editar perfil/);
  assert.doesNotMatch(profileSource, />\s*Conta e segurança\s*</);
  assert.match(profileSource, /id="personal-profile-visibility"/);
  assert.match(profileSource, /label="Alternar visibilidade do perfil"/);
  assert.match(profileSource, /profile-saved-library/);
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
  assert.match(profileSource, /Visibilidade do perfil/);
  assert.match(profileSource, /Perfil visível na Praça|Visível na Praça/);
});

test('Praça and Comunidades save canonical publications into the private library', () => {
  assert.match(savedLibrarySource, /users', user\.uid, 'savedItems'/);
  assert.match(savedLibrarySource, /sourceKind: SavedSourceKind/);
  assert.match(savedLibrarySource, /path = item\.sourceKind === 'community' \? 'community_posts' : 'social_posts'/);
  assert.match(savedLibrarySource, /setSavedPublicationSelections/);
  assert.match(profileSource, /subscribeSavedPublications/);
  assert.match(profileSource, /subscribeSelections/);
  assert.match(publicFeedSource, /savePublication\('praca', post\.id\)/);
  assert.match(communitiesSource, /toggleCommunityPostSaveWithMetrics\(post, savedPostIds\.has\(post\.id\)\)/);
  assert.match(communityMetricsSource, /users', actorId, 'savedItems'/);
  assert.match(communityMetricsSource, /sourceKind: 'community'/);
  assert.match(communityMetricsSource, /runTransaction\(db/);
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
