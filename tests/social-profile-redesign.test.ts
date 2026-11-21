import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const profileSource = readFileSync(
  'src/components/modals/UserProfileModal.tsx',
  'utf8'
);
const unifiedEditorSource = readFileSync('src/components/ProfileVerificationBridge.tsx', 'utf8');
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
  const walletCards = profileSource.slice(profileSource.indexOf('const financeCards = ['), profileSource.indexOf('] as const;', profileSource.indexOf('const financeCards = [')));
  assert.deepEqual([...walletCards.matchAll(/\{ id: '(\w+)'/g)].map(match => match[1]), ['movements', 'finance', 'xp']);
  for (const title of ['Movimentações', 'Controle financeiro', 'XP e conquistas']) {
    assert.ok(walletCards.includes(title));
  }
  assert.doesNotMatch(walletCards, /id: 'pitangas'/);
  assert.match(profileSource, /Editar perfil/);
  assert.doesNotMatch(profileSource, />\s*Conta e segurança\s*</);
  assert.match(profileSource, /id="personal-profile-visibility"/);
  assert.match(profileSource, /aria-pressed=\{isProfileVisible\}/);
  assert.match(profileSource, /id="personal-profile-settings-trigger"/);
  assert.match(profileSource, /className="absolute -bottom-3 -right-3 z-10/);
  assert.doesNotMatch(profileSource, /id="personal-profile-auth-trigger"|onAuthAction|isAuthBusy/);
  assert.match(profileSource, /id="personal-profile-settings-trigger"/);
  assert.doesNotMatch(profileSource, /<Toggle|<h3[^>]*>Meu perfil<\/h3>/);
  assert.match(profileSource, /profile-saved-library/);
  assert.doesNotMatch(profileSource, /id="profile-publication-composer"/);
  assert.doesNotMatch(profileSource, /id="profile-publication-register"/);
  assert.doesNotMatch(profileSource, /publicationType: 'feed' \| 'status'/);
});

test('one unified editor keeps account, data, documents and security with Central privacy', () => {
  assert.doesNotMatch(profileSource, /ProfileSettingsPanel|setIsSettingsOpen/);
  assert.match(unifiedEditorSource, /<ProfilePublicIdentityEditor user=\{user\}/);
  assert.match(unifiedEditorSource, /'conta', label: 'Conta'/);
  assert.match(unifiedEditorSource, /'dados', label: 'Dados'/);
  assert.match(unifiedEditorSource, /'seguranca', label: 'Segurança'/);
  assert.match(unifiedEditorSource, /'documentos', label: 'Documentos'/);
  assert.match(unifiedEditorSource, /'validacao', label: 'Validação'/);
  assert.match(profileSource, /id="personal-profile-visibility"/);
  assert.match(profileSource, /aria-pressed=\{isProfileVisible\}/);
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
