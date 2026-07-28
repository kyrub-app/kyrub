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

  test('turns the profile counters into the approved social tabs', () => {
    assert.match(profileSource, /label: 'Publicações'/);
    assert.match(profileSource, /label: 'Status'/);
    assert.match(profileSource, /label: 'Marcados'/);
    assert.match(profileSource, /label: 'Conectados'/);
    assert.match(profileSource, /label: 'Praça'/);
    assert.match(profileSource, /Seções do perfil/);
  });

  test('moves Offers to the shopping icon and preserves storefront consumption', () => {
    assert.match(profileSource, /ShoppingBag/);
    assert.match(profileSource, /Abrir Ofertas/);
    assert.match(profileSource, /Lojas para descobrir e consumir/);
    assert.match(profileSource, /buildPublicStorefrontPath/);
    assert.match(profileSource, /Entrar na loja/);
  });

  test('limits status management and keeps marked content private to the owner', () => {
    assert.match(profileSource, /const MAX_ACTIVE_STATUSES = 9/);
    assert.match(profileSource, /const STATUS_TTL_MS = 24 \* 60 \* 60 \* 1000/);
    assert.match(profileSource, /Você já possui 9 status ativos/);
    assert.match(profileSource, /Esta seção é privada e visível somente para você/);
    assert.match(profileSource, /users\/\$\{user\.uid\}\/favorites/);
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
    assert.match(composeSource, /firestore\.profile-social-hub\.fragment\.rules/);
    assert.match(profileRules, /public_profile/);
    assert.match(profileRules, /request\.auth\.uid == userId/);
    assert.match(profileRules, /data\.bio\.size\(\) <= 280/);
    assert.match(storageRules, /profile-images\/\{userId\}/);
    assert.match(storageRules, /request\.auth\.uid == userId/);
  });
});
