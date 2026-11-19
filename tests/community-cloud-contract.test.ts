import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('main activates the cloud community bridges instead of the local preview', () => {
  const main = read('src/main.tsx');
  assert.match(main, /ProfileCommunitiesCloudBridge/);
  assert.match(main, /ProfilePublishingDestinationsCloudBridge/);
  assert.doesNotMatch(main, /ProfileCommunitiesPreviewBridge/);
  assert.doesNotMatch(main, /ProfilePublishingDestinationsPreviewBridge/);
});

test('community UI exposes debates and real comment continuation', () => {
  const component = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  assert.match(component, /label: 'Debates'/);
  assert.match(component, /Iniciar debate/);
  assert.match(component, /Escreva seu comentário neste debate/);
  assert.match(component, /Responder/);
  assert.match(component, /Editar/);
  assert.match(component, /deleteDebateComment/);
  assert.match(component, /approveCommunityMember/);
});

test('cloud data layer persists shared community resources in Firestore', () => {
  const cloud = read('src/utils/communityCloud.ts');
  for (const collectionName of [
    'communities',
    'community_members',
    'community_posts',
    'community_debates',
    'community_debate_comments',
  ]) {
    assert.match(cloud, new RegExp(`['\"]${collectionName}['\"]`));
  }
  assert.match(cloud, /runTransaction/);
  assert.match(cloud, /uploadCommunityCover/);
  assert.match(cloud, /importLocalCommunityPrototype/);
});

test('debate comment subscription scopes the query to community and debate', () => {
  const querySafe = read('src/utils/communityCloudQuerySafe.ts');
  const vite = read('vite.config.ts');

  assert.match(querySafe, /community_debates/);
  assert.match(querySafe, /where\('communityId', '==', communityId\)/);
  assert.match(querySafe, /where\('debateId', '==', debateId\)/);
  assert.match(vite, /communityCloudQuerySafe\.ts/);
});

test('Firestore and Storage compose dedicated community authorization', () => {
  const fragment = read('firestore.communities.fragment.rules');
  const compose = read('scripts/compose-firestore-rules.mjs');
  const storage = read('storage.rules');
  assert.match(fragment, /match \/communities\/\{communityId\}/);
  assert.match(fragment, /match \/community_debates\/\{debateId\}/);
  assert.match(
    fragment,
    /match \/community_debate_comments\/\{commentId\}/
  );
  assert.match(compose, /firestore\.communities\.fragment\.rules/);
  assert.match(storage, /match \/community-covers\/\{communityId\}/);
});

test('switching communities clears the previous wall and rejects late snapshots', () => {
  const component = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  assert.match(component, /const communitySubscriptionVersion = useRef\(0\)/);
  assert.match(component, /const version = \+\+communitySubscriptionVersion\.current/);
  assert.match(component, /const isCurrent = \(\) => communitySubscriptionVersion\.current === version/);
  assert.match(component, /values => \{ if \(isCurrent\(\)\) setPosts\(values\); \}/);
  assert.match(component, /values => \{ if \(isCurrent\(\)\) setDebates\(values\); \}/);
  assert.match(component, /values => \{ if \(isCurrent\(\)\) setMembers\(values\); \}/);
  assert.match(component, /\+\+communitySubscriptionVersion\.current;\s+setPosts\(\[\]\);\s+setDebates\(\[\]\);\s+setMembers\(\[\]\);\s+closeDebate\(\);/);
  assert.match(component, /const closeDebate = \(\) => \{\s+\+\+debateSubscriptionVersion\.current;\s+setComments\(\[\]\);/);
});

test('switching debates resets the comment composer and ignores late debate snapshots', () => {
  const component = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  assert.match(component, /const debateSubscriptionVersion = useRef\(0\)/);
  assert.match(component, /const version = \+\+debateSubscriptionVersion\.current/);
  assert.match(component, /setComments\(\[\]\);\s+if \(!selectedCommunityId \|\| !selectedDebateId\) return/);
  assert.match(component, /const isCurrent = \(\) => debateSubscriptionVersion\.current === version/);
  assert.match(component, /values => \{ if \(isCurrent\(\)\) setComments\(values\); \}/);
  assert.match(component, /\[selectedCommunityId, selectedDebateId\]/);
  assert.match(component, /const closeDebate = \(\) => \{\s+\+\+debateSubscriptionVersion\.current;\s+setComments\(\[\]\);\s+setReplyTo\(null\);\s+setCommentDraft\(''\);\s+setEditingCommentId\(''\);\s+setEditingCommentText\(''\);\s+setSelectedDebateId\(''\);/);
  assert.match(component, /const openDebate = \(debateId: string\) => \{\s+closeDebate\(\);\s+setSelectedDebateId\(debateId\);/);
  assert.match(component, /openDebate\(debate\.id\)/);
  assert.match(component, /onClick=\{closeDebate\}/);
});

test('private group navigation rejects stale messages and cross-community membership snapshots', () => {
  const component = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  assert.match(component, /const groupDirectorySubscriptionVersion = useRef\(0\)/);
  assert.match(component, /const groupMessageSubscriptionVersion = useRef\(0\)/);
  assert.match(component, /group\.communityId === selectedCommunityId/);
  assert.match(component, /group\.memberIds\.includes\(user\.uid\)/);
  assert.match(component, /const isCurrent = \(\) => groupMessageSubscriptionVersion\.current === version/);
  assert.match(component, /values => \{ if \(isCurrent\(\)\) setGroupMessages\(values\); \}/);
  assert.match(component, /const isCurrent = \(\) => groupDirectorySubscriptionVersion\.current === version/);
  assert.match(component, /setMyCommunityGroups\(values\.filter\(group => group\.communityId === selectedCommunityId\)\)/);
  assert.match(component, /const closeGroupsModal = \(\) => \{[\s\S]*?setActiveGroupChatId\(''\);[\s\S]*?setGroupMessages\(\[\]\);/);
  assert.match(component, /const toggleGroupConversation = \(groupId: string\) => \{[\s\S]*?setGroupMessages\(\[\]\);[\s\S]*?setGroupMessageDraft\(''\);/);
  assert.match(component, /onClick=\{\(\) => toggleGroupConversation\(group\.id\)\}/);
  assert.match(component, /const openCommunity = \(community: CloudCommunity\) => \{[\s\S]*?closeGroupsModal\(\);/);
});


test('Taba shows Lojas before a single Comunidades panel without device-test imports', () => {
  const tab = read('src/components/tabs/KyrubTab.tsx');
  const stores = read('src/components/tabs/SquareStoresSection.tsx');
  const communities = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  assert.ok(tab.indexOf('<SquareStoresSection') >= 0);
  assert.ok(tab.indexOf('<SquareStoresSection') < tab.indexOf('<LegacyKyrubTab'));
  assert.match(tab, /props\.setSocialSubTab\('lojas'\)/);
  assert.equal((communities.match(/id="square-communities"/g) || []).length, 1);
  assert.doesNotMatch(communities, /Importar teste deste aparelho|showLocalImport|importLocalCommunityPrototype/);
  assert.match(communities, /Criar comunidade/);
  assert.match(stores, /id="square-stores"/);
  assert.doesNotMatch(stores, /square-stores-view-all|Ver todas/);
  assert.match(stores, /id === 'discover' \? onViewAll\(\)/);
  for (const name of ["'Favoritas'", "'Descobrir'", "'Em alta'"]) {
    assert.ok(stores.includes(name));
  }
  assert.ok(stores.includes("fetch('/api/marketplace-discovery/public/kyrub-oficial'"));
  assert.match(stores, /href=\{OFFICIAL_STORE_PATH\}/);
  assert.ok(stores.includes("const OFFICIAL_STORE_PATH = '/@kyrub-oficial';"));
  assert.doesNotMatch(stores, /Criar comunidade|Importar teste deste aparelho/);
});

test('Taba community discovery separates favorites, new communities and recent activity', () => {
  const communities = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  assert.match(communities, /\['mine', 'Favoritas'\]/);
  assert.match(communities, /favoriteCommunityIds\.includes\(community\.id\)/);
  assert.match(communities, /toggleFavoriteCommunity\(community\.id\)/);
  assert.match(communities, /Date\.parse\(right\.createdAt\) - Date\.parse\(left\.createdAt\)/);
  assert.match(communities, /Date\.parse\(right\.activityAt \|\| right\.createdAt\)/);
  assert.match(communities, /Criar comunidade/);
  assert.doesNotMatch(communities, /className="flex min-h-9 items-center gap-1\.5 rounded-xl bg-sky-500 px-3 text-\[8px\] font-black uppercase text-slate-950"/);
});
