import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { scopeCommunityRecords, scopeDebateComments } from '../src/utils/communityViewScope';

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


test('community navigation never renders posts, debates, members or groups from another community', () => {
  const records = [
    { id: 'alpha-first', communityId: 'alpha' },
    { id: 'beta-first', communityId: 'beta' },
    { id: 'alpha-second', communityId: 'alpha' },
  ];
  assert.deepEqual(scopeCommunityRecords(records, 'beta').map(record => record.id), ['beta-first']);
  assert.deepEqual(scopeCommunityRecords(records, 'alpha').map(record => record.id), ['alpha-first', 'alpha-second']);
  assert.deepEqual(scopeCommunityRecords(records, ''), []);
  assert.equal(records.length, 3, 'live subscription values cannot be mutated by view selection');

  const component = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  assert.match(component, /scopeCommunityRecords\(posts, selectedCommunityId\)/);
  assert.match(component, /scopeCommunityRecords\(debates, selectedCommunityId\)/);
  assert.match(component, /scopeCommunityRecords\(members, selectedCommunityId\)/);
  assert.match(component, /scopeCommunityRecords\(myCommunityGroups, selectedCommunityId\)/);
  assert.match(component, /visiblePosts\.map\(/);
  assert.match(component, /visibleDebates\.map\(/);
  assert.match(component, /visibleMembers\.filter\(/);
  assert.match(component, /visibleGroups\.map\(/);
});

test('debate comments and reply context are isolated when changing debates', () => {
  const comments = [
    { id: 'alpha-one', communityId: 'alpha', debateId: 'one' },
    { id: 'alpha-two', communityId: 'alpha', debateId: 'two' },
    { id: 'beta-one', communityId: 'beta', debateId: 'one' },
  ];
  assert.deepEqual(scopeDebateComments(comments, 'alpha', 'one').map(item => item.id), ['alpha-one']);
  assert.deepEqual(scopeDebateComments(comments, 'alpha', 'two').map(item => item.id), ['alpha-two']);
  assert.deepEqual(scopeDebateComments(comments, 'beta', 'one').map(item => item.id), ['beta-one']);
  assert.deepEqual(scopeDebateComments(comments, 'alpha', ''), []);
  assert.deepEqual(scopeDebateComments(comments, '', 'one'), []);

  const component = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  assert.match(component, /scopeDebateComments\(comments, selectedCommunityId, selectedDebateId\)/);
  assert.match(component, /visibleComments\.map\(/);
  assert.match(component, /visibleComments\.find\(/);
  assert.match(component, /setSelectedDebateId\(debate\.id\)/);
  assert.match(component, /setCommentDraft\(''\)/);
  assert.match(component, /setReplyTo\(null\)/);
});
