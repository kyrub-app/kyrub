import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const appSource = readFileSync('src/App.tsx', 'utf8');
const profileSource = readFileSync(
  'src/components/ProfileSocialHubBridge.tsx',
  'utf8'
);
const polishSource = readFileSync(
  'src/components/ProfileSocialPolishBridge.tsx',
  'utf8'
);
const mobileSource = readFileSync(
  'src/components/ProfileSocialMobileFirstBridge.tsx',
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

describe('profile social hub navigation', () => {
  test('mounts the profile hub, polish layers and Kyrub AI workspace around the legacy app', () => {
    assert.match(appSource, /ProfileSocialHubBridge/);
    assert.match(appSource, /ProfileSocialPolishBridge/);
    assert.match(appSource, /ProfileSocialMobileFirstBridge/);
    assert.match(appSource, /KyrubAiWorkspaceBridge/);
    assert.ok(
      appSource.indexOf('<ProfileSocialHubBridge') <
        appSource.indexOf('<LegacyApp')
    );
    assert.ok(
      appSource.indexOf('<ProfileSocialPolishBridge') <
        appSource.indexOf('<ProfileSocialMobileFirstBridge')
    );
    assert.ok(
      appSource.indexOf('<ProfileSocialMobileFirstBridge') <
        appSource.indexOf('<LegacyApp')
    );
    assert.ok(
      appSource.indexOf('<KyrubAiWorkspaceBridge') <
        appSource.indexOf('<LegacyApp')
    );
  });

  test('keeps the approved profile tabs and saved posts in a private modal', () => {
    assert.match(profileSource, /label: 'Publicações'/);
    assert.match(profileSource, /label: 'Status'/);
    assert.match(profileSource, /label: 'Conectados'/);
    assert.match(profileSource, /label: 'Praça'/);
    assert.match(profileSource, /Publicações salvas/);
    assert.match(profileSource, /Salvos \{savedPosts\.length\}/);
    assert.match(profileSource, /users\/\$\{user\.uid\}\/favorites/);
  });

  test('restores Marcados between Status and Conectados for user mentions', () => {
    assert.match(polishSource, /data-kyrub-marked-tab/);
    assert.match(polishSource, /findButtonByText\(navigation, 'Status'\)/);
    assert.match(
      polishSource,
      /navigation\.insertBefore\(nextTabHost, statusButton\.nextSibling\)/
    );
    assert.match(polishSource, /Marcados \{visibleMarkedPosts\.length\}/);
    assert.match(
      polishSource,
      /where\('audienceIds', 'array-contains', user\.uid\)/
    );
    assert.match(polishSource, /taggedUserIds\.includes\(currentUserId\)/);
    assert.match(polishSource, /Marcaram você/);
  });

  test('uses a larger 4x5 profile portrait and concentrates editing on its pencil icon', () => {
    assert.match(mobileSource, /data-kyrub-profile-portrait-4x5/);
    assert.match(mobileSource, /width: 88px !important/);
    assert.match(mobileSource, /height: 110px !important/);
    assert.match(mobileSource, /width: 104px !important/);
    assert.match(mobileSource, /height: 130px !important/);
    assert.match(mobileSource, /data-kyrub-profile-edit-trigger/);
    assert.match(mobileSource, /originalEditButton\.style\.display = 'none'/);
    assert.match(mobileSource, /originalEditButtonRef\.current\?\.click\(\)/);
    assert.match(mobileSource, /content: "✎"/);
  });

  test('places the saved icon immediately before Offers and removes the large header actions', () => {
    assert.match(mobileSource, /data-kyrub-saved-action-host/);
    assert.match(mobileSource, /insertBefore\(host, offersButton\)/);
    assert.match(mobileSource, /originalSavedButton\.style\.display = 'none'/);
    assert.match(mobileSource, /data-kyrub-original-profile-actions/);
    assert.match(mobileSource, /aria-label="Abrir publicações salvas"/);
    assert.match(mobileSource, /<Bookmark className="h-5 w-5"/);
  });

  test('renders connected contacts as a two-column mobile grid with compact actions', () => {
    assert.match(mobileSource, /data-kyrub-connected-grid/);
    assert.match(
      mobileSource,
      /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/
    );
    assert.match(mobileSource, /data-kyrub-contact-card/);
    assert.match(mobileSource, /aspect-ratio: 4 \/ 3/);
    assert.match(mobileSource, /data-kyrub-contact-chat/);
    assert.match(mobileSource, /data-kyrub-contact-remove/);
    assert.match(
      mobileSource,
      /grid-template-columns: minmax\(0, 1fr\) 42px/
    );
  });

  test('opens the real Firestore chat in a full-screen mobile conversation', () => {
    assert.match(mobileSource, /<ChatModal/);
    assert.match(mobileSource, /setSelectedChatUser\(selected\)/);
    assert.match(chatSource, /useChatMessages/);
    assert.match(chatSource, /selectedChatUser\.connectionStatus === 'accepted'/);
    assert.match(chatSource, /connectionId: selectedChatUser\?\.connectionId/);
    assert.match(chatSource, /h-\[100dvh\]/);
    assert.match(chatSource, /messagesEndRef/);
    assert.match(chatSource, /sendMessage\(chatMessageText\)/);
    assert.doesNotMatch(
      mobileSource,
      /A conversa segura continua disponível pelo chat social/
    );
  });

  test('makes Praça sharing explicit and supports connected-user tagging', () => {
    assert.match(profileSource, /Enviar para a Praça/);
    assert.match(profileSource, /type="checkbox"/);
    assert.match(profileSource, /Marcar conectados/);
    assert.match(profileSource, /Marcar usuários conectados/);
    assert.match(profileSource, /selectedTaggedUserIds/);
    assert.match(profileSource, /taggedUsers: selectedTaggedFriends/);
    assert.match(profileSource, /taggedUserIds: selectedTaggedFriends/);
    assert.match(publishingSource, /post\.visibility === 'private'/);
    assert.match(publishingSource, /post\.visibility === 'public'/);
    assert.match(publishingSource, /taggedUserIds/);
    assert.match(feedHookSource, /where\('authorId', '==', user\.uid\)/);
  });

  test('reports failed publication sync and retries the pending local post', () => {
    assert.match(publishingSource, /kyrub-social-publish-result/);
    assert.match(publishingSource, /kyrub-social-publish-retry/);
    assert.match(publishingSource, /failedCloudPostIds/);
    assert.match(publishingSource, /permission-denied/);
    assert.match(publishingSource, /Firebase Storage ainda não está ativo/);
    assert.match(polishSource, /Publicação pendente/);
    assert.match(polishSource, /Tentar sincronizar/);
    assert.match(polishSource, /retryPendingPublication/);
  });

  test('adds save and report actions without allowing status saves', () => {
    assert.match(profileSource, /Salvar publicação/);
    assert.match(profileSource, /EllipsisVertical/);
    assert.match(profileSource, /Denunciar publicação/);
    assert.match(profileSource, /social_post_reports/);
    assert.match(profileSource, /post\.publicationType === 'status'/);
    assert.match(profileSource, /onToggleSave=\{/);
    assert.match(socialRules, /match \/social_post_reports\/\{reportId\}/);
    assert.match(socialRules, /incoming\(\)\.reporterId == request\.auth\.uid/);
  });

  test('moves Offers to the shopping icon and restores the store card hierarchy', () => {
    assert.match(profileSource, /ShoppingBag/);
    assert.match(profileSource, /Abrir Ofertas/);
    assert.match(profileSource, /Lojas para descobrir e consumir/);
    assert.match(profileSource, /buildPublicStorefrontPath/);
    assert.match(profileSource, /className="absolute left-3 top-3/);
    assert.match(profileSource, /className=\{`absolute right-3 top-3/);
    assert.match(profileSource, /Momentos da loja e dos produtos/);
    assert.match(profileSource, /Publicar meu Momento/);
    assert.match(profileSource, /collection\(db, 'reviews'\)/);
  });

  test('keeps status duration and lets the author opt a status into Praça', () => {
    assert.match(profileSource, /const MAX_ACTIVE_STATUSES = 9/);
    assert.match(profileSource, /const STATUS_TTL_MS = 24 \* 60 \* 60 \* 1000/);
    assert.match(profileSource, /Você já possui 9 status ativos/);
    assert.match(
      profileSource,
      /publicationType === 'status'[\s\S]{0,180}\? sendToSquare[\s\S]{0,80}\? 'public'[\s\S]{0,80}: 'connections'/
    );
    assert.match(publishingSource, /visibility = isStatus/);
    assert.match(feedHookSource, /where\('visibility', '==', 'public'\)/);
    assert.match(
      feedHookSource,
      /where\('audienceIds', 'array-contains', user\.uid\)/
    );
    assert.match(socialRules, /data\.visibility in \['connections', 'public'\]/);
  });

  test('runs the former Kyrub tab as an authenticated AI conversation workspace', () => {
    assert.match(aiSource, /Kyrub I\.A/);
    assert.match(aiSource, /Criar minha loja/);
    assert.match(aiSource, /Cadastrar produtos/);
    assert.match(aiSource, /Conteúdo e imagens/);
    assert.match(aiSource, /Treino e hábitos/);
    assert.match(aiSource, /Bem-estar/);
    assert.match(aiSource, /Em que posso ajudar hoje\?/);
    assert.match(aiSource, /requestKyrubAiConsultant/);
    assert.match(aiSource, /Histórico salvo somente neste dispositivo/);
    assert.match(aiSource, /Ações no aplicativo ainda exigem o modo manual/);
    assert.match(aiClientSource, /currentUser\.getIdToken\(\)/);
    assert.match(aiClientSource, /authorization: `Bearer \$\{token\}`/);
    assert.match(aiSource, /kyrub-tab-container/);
  });

  test('secures profile biography and owner image storage', () => {
    assert.match(
      composeSource,
      /firestore\.profile-social-hub\.fragment\.rules/
    );
    assert.match(profileRules, /public_profile/);
    assert.match(profileRules, /request\.auth\.uid == userId/);
    assert.match(profileRules, /data\.bio\.size\(\) <= 280/);
    assert.match(storageRules, /profile-images\/\{userId\}/);
    assert.match(storageRules, /request\.auth\.uid == userId/);
  });
});
