import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const profileSource = readFileSync(
  'src/components/modals/UserProfileModal.tsx',
  'utf8'
);
const kyrubWrapperSource = readFileSync(
  'src/components/tabs/KyrubTab.tsx',
  'utf8'
);
const globalCss = readFileSync('src/index.css', 'utf8');

test('Meu perfil is the primary social publishing surface', () => {
  assert.match(profileSource, /id="profile-publication-composer"/);
  assert.match(profileSource, /Nova publicação/);
  assert.match(profileSource, /Minhas publicações/);
  assert.match(profileSource, /id="profile-publication-register"/);
  assert.match(profileSource, /Visível na Praça/);
  assert.match(profileSource, /Publicações/);
  assert.match(profileSource, /Status/);
});

test('the Clips action opens account, data, security and verification settings', () => {
  assert.match(profileSource, /<Copy className="h-4 w-4"/);
  assert.match(
    profileSource,
    /aria-label="Abrir informações e configurações do perfil"/
  );
  assert.match(profileSource, /Informações e configurações/);
  assert.match(profileSource, /label: 'Conta'/);
  assert.match(profileSource, /label: 'Dados'/);
  assert.match(profileSource, /label: 'Segurança'/);
  assert.match(profileSource, /label: 'Verificação'/);
  assert.match(profileSource, /Perfil visível na Praça/);
});

test('profile publications remain connected to the Praça feed', () => {
  assert.match(profileSource, /getUserPostsKey/);
  assert.match(profileSource, /kyrub-social-posts-updated/);
  assert.match(profileSource, /publicationType: 'feed' \| 'status'/);
  assert.match(profileSource, /Publicação enviada para o feed da Praça/);

  assert.match(kyrubWrapperSource, /kyrub-social-posts-updated/);
  assert.match(kyrubWrapperSource, /handleProfilePostsUpdated/);
  assert.match(kyrubWrapperSource, /getUserPostsKey\(activePostsUserId\)/);
});

test('Praça Recentes no longer displays the old publication composer', () => {
  assert.match(globalCss, /#kyrub-tab-container section:has\(/);
  assert.match(
    globalCss,
    /textarea\[placeholder="O que está acontecendo no seu negócio ou região\?"\]/
  );
  assert.match(globalCss, /display: none/);
});
