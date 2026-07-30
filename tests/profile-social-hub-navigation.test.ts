import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const appSource = readFileSync('src/App.tsx', 'utf8');
const profileSource = readFileSync(
  'src/components/ProfileSocialHubBridge.tsx',
  'utf8'
);
const aiSource = readFileSync(
  'src/components/KyrubAiWorkspaceBridge.tsx',
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
  test('mounts the profile hub and the Kyrub AI workspace around the legacy app', () => {
    assert.match(appSource, /ProfileSocialHubBridge/);
    assert.match(appSource, /KyrubAiWorkspaceBridge/);
    assert.ok(
      appSource.indexOf('<ProfileSocialHubBridge') <
        appSource.indexOf('<LegacyApp')
    );
    assert.ok(
      appSource.indexOf('<KyrubAiWorkspaceBridge') <
        appSource.indexOf('<LegacyApp')
    );
  });

  test('keeps the approved profile tabs and moves saved posts to a private modal', () => {
    assert.match(profileSource, /label: 'Publicações'/);
    assert.match(profileSource, /label: 'Status'/);
    assert.match(profileSource, /label: 'Conectados'/);
    assert.match(profileSource, /label: 'Praça'/);
    assert.doesNotMatch(profileSource, /label: 'Marcados'/);
    assert.match(profileSource, /Publicações salvas/);
    assert.match(profileSource, /Salvos \{savedPosts\.length\}/);
    assert.match(profileSource, /users\/\$\{user\.uid\}\/favorites/);
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
    assert.match(profileSource, /sendToSquare \? 'public' : 'connections'/);
    assert.match(publishingSource, /visibility = isStatus/);
    assert.match(feedHookSource, /where\('visibility', '==', 'public'\)/);
    assert.match(feedHookSource, /where\('audienceIds', 'array-contains', user\.uid\)/);
    assert.match(socialRules, /data\.visibility in \['connections', 'public'\]/);
  });

  test('prepares the former Kyrub tab as a transparent AI project workspace', () => {
    assert.match(aiSource, /Kyrub I\.A/);
    assert.match(aiSource, /Criar minha loja/);
    assert.match(aiSource, /Cadastrar produtos/);
    assert.match(aiSource, /Conteúdo e imagens/);
    assert.match(aiSource, /Treino e hábitos/);
    assert.match(aiSource, /Bem-estar/);
    assert.match(aiSource, /ainda não executa ações/);
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
