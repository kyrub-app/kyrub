import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const appSource = readFileSync('src/App.tsx', 'utf8');
const profileSource = readFileSync(
  'src/components/ProfileSocialHubNative.tsx',
  'utf8'
);
const chatSource = readFileSync(
  'src/components/modals/ChatModal.tsx',
  'utf8'
);
const aiSource = readFileSync(
  'src/components/KyrubAiWorkspaceBridge.tsx',
  'utf8'
);
const aiClientSource = readFileSync(
  'src/ai/consultantClient.ts',
  'utf8'
);
const publishingSource = readFileSync(
  'src/components/SocialPublishingBridge.tsx',
  'utf8'
);
const feedHookSource = readFileSync(
  'src/hooks/usePublicSocialFeed.ts',
  'utf8'
);
const socialRules = readFileSync(
  'firestore.social-feed.fragment.rules',
  'utf8'
);
const storageRules = readFileSync('storage.rules', 'utf8');
const composeSource = readFileSync(
  'scripts/compose-firestore-rules.mjs',
  'utf8'
);
const profileRules = readFileSync(
  'firestore.profile-social-hub.fragment.rules',
  'utf8'
);

describe('native React profile social hub', () => {
  test('mounts one React-owned profile hub before the legacy application', () => {
    assert.match(appSource, /ProfileSocialHubNative/);
    assert.match(appSource, /<ProfileSocialHubNative\s*\/?>/);
    assert.ok(
      appSource.indexOf('<ProfileSocialHubNative') <
        appSource.indexOf('<LegacyApp')
    );
    assert.doesNotMatch(appSource, /ProfileSocialPolishBridge/);
    assert.doesNotMatch(appSource, /ProfileMarkedNavigationRecoveryBridge/);
    assert.doesNotMatch(appSource, /ProfileStatusCheckboxBridge/);
    assert.doesNotMatch(appSource, /ProfileSocialMobileFirstBridge/);
    assert.doesNotMatch(appSource, /ProfileConnectionSubtabsBridge/);
    assert.doesNotMatch(appSource, /ProfileConnectedGroupsBridge/);
    assert.doesNotMatch(appSource, /profileDomEnhancementsEnabled/);
    assert.doesNotMatch(profileSource, /MutationObserver/);
  });

  test('restores the approved modern profile header without external DOM decoration', () => {
    assert.match(profileSource, /h-28 w-\[90px\]/);
    assert.match(profileSource, /sm:h-32 sm:w-\[104px\]/);
    assert.match(profileSource, /aria-label="Editar perfil"/);
    assert.match(profileSource, /aria-label="Abrir publicações salvas"/);
    assert.match(profileSource, /aria-label="Abrir Ofertas"/);
    assert.ok(
      profileSource.indexOf('aria-label="Abrir publicações salvas"') <
        profileSource.indexOf('aria-label="Abrir Ofertas"')
    );
    assert.match(profileSource, /Foto do Google/);
    assert.match(profileSource, /Publicações salvas/);
  });

  test('keeps Status inside Publications and creates a temporary copy', () => {
    assert.match(profileSource, /type ProfileTab = 'publications' \| 'marked' \| 'connected' \| 'square'/);
    assert.doesNotMatch(profileSource, /ProfileTab[^\n]*'status'/);
    assert.match(profileSource, /Publicar no Status/);
    assert.match(
      profileSource,
      /Esta publicação também ficará visível nos seus[\s\S]*Status por 24 horas/
    );
    assert.match(profileSource, /const MAX_ACTIVE_STATUSES = 9/);
    assert.match(profileSource, /publicationType: 'feed'/);
    assert.match(profileSource, /publicationType: 'status'/);
    assert.match(
      profileSource,
      /visibility: shareToSquare \? 'public' : 'connections'/
    );
    assert.match(profileSource, /Seus Status ativos/);
  });

  test('renders Marcados natively from tagged audience posts', () => {
    assert.match(profileSource, /id: 'marked', label: 'Marcados'/);
    assert.match(profileSource, /post\.taggedUserIds\?\.includes/);
    assert.match(profileSource, /Marcaram você/);
    assert.match(profileSource, /Nenhuma marcação/);
    assert.match(feedHookSource, /where\('audienceIds', 'array-contains', user\.uid\)/);
  });

  test('restores the simplified connected navigation and nested new contacts', () => {
    const generalIndex = profileSource.indexOf("label: 'Geral'");
    const frequentIndex = profileSource.indexOf("label: 'Frequentes'");
    const groupsIndex = profileSource.indexOf("label: 'Grupos'");
    const newButtonIndex = profileSource.indexOf(
      'aria-label="Abrir novas conexões"'
    );
    const requestsIndex = profileSource.indexOf(
      'Solicitações {requestCount}'
    );
    const suggestionsIndex = profileSource.indexOf(
      'Sugestões {suggestionCount}'
    );

    assert.ok(generalIndex >= 0);
    assert.ok(generalIndex < frequentIndex);
    assert.ok(frequentIndex < groupsIndex);
    assert.ok(groupsIndex < newButtonIndex);
    assert.ok(requestsIndex >= 0);
    assert.ok(requestsIndex < suggestionsIndex);
    assert.match(profileSource, /grid grid-cols-4 gap-2/);
    assert.match(profileSource, /aria-label="Tipos de novos contatos"/);
    assert.match(profileSource, /newConnectionsTab === 'requests'/);
    assert.match(profileSource, /newConnectionsTab === 'suggestions'/);
    assert.doesNotMatch(profileSource, /connectionSection === 'requests'/);
    assert.doesNotMatch(profileSource, /connectionSection === 'suggestions'/);
    assert.match(profileSource, /grid grid-cols-2 gap-3/);
    assert.match(profileSource, /aspect-\[4\/3\]/);
    assert.match(profileSource, /Favoritar contato/);
  });

  test('keeps chat and contact groups as real React functionality', () => {
    assert.match(profileSource, /<ChatModal/);
    assert.match(profileSource, /setChatTarget\(friend\)/);
    assert.match(chatSource, /useChatMessages/);
    assert.match(chatSource, /sendMessage\(chatMessageText\)/);
    assert.match(profileSource, /contact_groups/);
    assert.match(profileSource, /const MAX_GROUPS = 30/);
    assert.match(profileSource, /const MAX_GROUP_MEMBERS = 200/);
    assert.match(profileSource, /Criar grupo|Nome do novo grupo/);
    assert.match(profileSource, /toggleGroupMember/);
    assert.match(profileSource, /deleteGroup/);
  });

  test('publishes through the existing offline-to-cloud social pipeline', () => {
    assert.match(profileSource, /kyrub-social-posts-updated/);
    assert.match(profileSource, /source: 'local'/);
    assert.match(profileSource, /taggedUserIds/);
    assert.match(profileSource, /Enviar para a Praça/);
    assert.match(publishingSource, /kyrub-social-posts-updated/);
    assert.match(publishingSource, /writeCloudPost/);
    assert.match(publishingSource, /failedCloudPostIds/);
  });

  test('keeps private saves, reports and marketplace access', () => {
    assert.match(profileSource, /users\/\$\{user\.uid\}\/favorites/);
    assert.match(profileSource, /social_post_reports/);
    assert.match(profileSource, /Denunciar publicação/);
    assert.match(profileSource, /collection\(db, 'tenants'\)/);
    assert.match(profileSource, /buildPublicStorefrontPath/);
    assert.match(profileSource, /Lojas para descobrir e consumir/);
    assert.match(socialRules, /match \/social_post_reports\/\{reportId\}/);
  });

  test('keeps the authenticated Kyrub AI workspace unchanged', () => {
    assert.match(appSource, /KyrubAiWorkspaceBridge/);
    assert.match(aiSource, /Kyrub I\.A/);
    assert.match(aiSource, /Em que posso ajudar hoje\?/);
    assert.match(aiSource, /requestKyrubAiConsultant/);
    assert.match(aiClientSource, /currentUser\.getIdToken\(\)/);
    assert.match(aiClientSource, /authorization: `Bearer \$\{token\}`/);
  });

  test('keeps profile and social security contracts in place', () => {
    assert.match(
      composeSource,
      /firestore\.profile-social-hub\.fragment\.rules/
    );
    assert.match(profileRules, /public_profile/);
    assert.match(profileRules, /request\.auth\.uid == userId/);
    assert.match(profileRules, /data\.bio\.size\(\) <= 280/);
    assert.match(storageRules, /profile-images\/\{userId\}/);
    assert.match(storageRules, /request\.auth\.uid == userId/);
    assert.match(socialRules, /data\.visibility in \['connections', 'public'\]/);
  });
});
