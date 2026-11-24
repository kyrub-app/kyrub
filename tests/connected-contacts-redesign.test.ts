import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const panelSource = readFileSync(
  'src/components/ConnectedContactsPanel.tsx',
  'utf8'
);
const wrapperSource = readFileSync(
  'src/components/tabs/KyrubTab.tsx',
  'utf8'
);
const globalCss = readFileSync('src/index.css', 'utf8');

test('connected cards use status backgrounds and mobile-safe top navigation', () => {
  assert.match(panelSource, /grid grid-cols-3/);
  assert.match(panelSource, />Conectados</);
  assert.match(panelSource, />Sugestões</);
  assert.match(panelSource, />Solicitações</);
  assert.match(panelSource, /data-contact-card=/);
  assert.match(panelSource, /activeStatus\?\.mediaUrls\?\.\[0\]/);
  assert.match(panelSource, /Status anterior de/);
  assert.match(panelSource, /Próximo status de/);
});

test('contact identity opens a public profile without private Clips controls', () => {
  const presentationSource=readFileSync('src/components/ContactPresentationModal.tsx','utf8');
  assert.match(panelSource, /<ContactPresentationModal/);
  assert.match(presentationSource, /id="public-user-profile-modal"/);
  assert.match(panelSource, /Abrir perfil público de/);
  assert.match(presentationSource, /Cartão de apresentação/);
  assert.match(presentationSource, /Somente informações e conteúdos públicos/);
  assert.doesNotMatch(presentationSource,/MediaCarousel|feedPosts|statusPosts/);
  assert.doesNotMatch(panelSource, /<Copy/);
  assert.doesNotMatch(panelSource, /Informações e configurações do perfil/);
});

test('contact card actions are positioned as favorite, chat and overflow menu', () => {
  assert.match(panelSource, /handleToggleFavoriteFriend\(friend\.id\)/);
  assert.match(panelSource, /setShowChatModal\(true\)/);
  assert.match(panelSource, /<EllipsisVertical/);
  assert.match(panelSource, />\s*Desconectar\s*</);
  assert.match(panelSource, />\s*Bloquear\s*</);
  assert.match(panelSource, />\s*Denunciar\s*</);
  assert.doesNotMatch(panelSource, />\s*Registro\s*</);
});

test('suggestions and requests are modal lists with suggestion dismissal', () => {
  assert.match(panelSource, /activeListModal === 'suggestions'/);
  assert.match(panelSource, /activeListModal === 'requests'/);
  assert.match(panelSource, /Remover usuário das sugestões/);
  assert.match(panelSource, /kyrub_hidden_suggestions_/);
  assert.match(panelSource, /handleAcceptRequest\(request\)/);
  assert.match(panelSource, /handleDeclineRequest\(request\.id, request\.name\)/);
});

test('wrapper replaces only the legacy connected body', () => {
  assert.match(wrapperSource, /<ConnectedContactsPanel/);
  assert.match(wrapperSource, /connected-contacts-redesign-active/);
  assert.match(
    wrapperSource,
    /props\.socialSubTab === 'usuarios'[\s\S]*props\.pracaFilter === 'conectados'/
  );
  assert.match(globalCss, /connected-contacts-redesign-active/);
  assert.match(globalCss, /> \.space-y-6/);
});

 test('shared presentation is visual only and wrappers retain context actions',()=>{
 const shared=readFileSync('src/components/PresentationCard.tsx','utf8');
 const contact=readFileSync('src/components/ContactPresentationModal.tsx','utf8');
 const tag=readFileSync('src/components/PublicKyrubTagPage.tsx','utf8');
 assert.match(contact,/<PresentationCard/);assert.match(tag,/<PresentationCard/);
 assert.match(contact,/Abrir chat/);assert.doesNotMatch(contact,/SOS · Informações de emergência/);
 assert.match(tag,/SOS · Informações de emergência/);assert.doesNotMatch(tag,/Abrir chat/);
 assert.doesNotMatch(shared,/SOS|Abrir chat|firebase|fetch\(/);
 });
