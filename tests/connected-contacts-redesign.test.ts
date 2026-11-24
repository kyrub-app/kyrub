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
 const relationship=readFileSync('src/components/PresentationRelationship.tsx','utf8');
 assert.match(contact,/<PresentationRelationship/);assert.match(relationship,/Abrir chat/);assert.match(relationship,/result.state==='accepted'/);assert.doesNotMatch(contact,/SOS · Informações de emergência/);
 assert.match(tag,/SOS · Informações de emergência/);assert.doesNotMatch(tag,/Abrir chat/);
 assert.doesNotMatch(shared,/SOS|Abrir chat|firebase|fetch\(/);
 });

test('blocking uses server authority and both directions are checked for chat and connections',()=>{
 const service=readFileSync('server/identity/presentationRelationshipService.ts','utf8');
 const rules=readFileSync('firestore.rules','utf8');
 const shared=readFileSync('server/identity/reservedTribeService.ts','utf8');
 const boundary=shared.slice(shared.indexOf('export async function ordinaryPresentationPeerAllowed'),shared.indexOf('export async function authorizeOrdinaryForward'));
 assert.match(service,/if\(!await ordinaryPresentationPeerAllowed\(tx,actor,targetId\)\)return \{state:'unavailable'\}/);
 assert.ok(service.indexOf('ordinaryPresentationPeerAllowed(tx,actor,targetId)')<service.indexOf("tx.create(ref,"));
 assert.match(boundary,/tx.get\(adminDb.doc\('social_contact_blocks\/'\+actor\+'\/blocked\/'\+peer\)\)/);
 assert.match(boundary,/tx.get\(adminDb.doc\('social_contact_blocks\/'\+peer\+'\/blocked\/'\+actor\)\)/);
 assert.match(boundary,/return !marker.exists&&!ownBlock.exists&&!otherBlock.exists/);
 assert.match(service,/await setOrdinarySocialContactBlock\(actor,target,blocked\)/);
 assert.match(service,/invalidateSocialPair\(tx,actor,targetId\)/);
 assert.match(service,/export async function setSocialContactBlock/);assert.match(rules,/match \/social_contact_blocks/);
 assert.match(rules,/noSocialContactBlock\(incoming\(\).senderId, incoming\(\).receiverId\)/);
 assert.match(rules,/noSocialContactBlock\(connectionData\(\).senderId, connectionData\(\).receiverId\)/);
 assert.match(panelSource,/changeSocialBlock\(friend.id,true,viewerId\)/);
});
