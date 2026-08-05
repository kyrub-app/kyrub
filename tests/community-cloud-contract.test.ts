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
