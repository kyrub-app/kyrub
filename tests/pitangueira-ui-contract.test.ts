import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file: string) => readFileSync(file, 'utf8');

test('Semear replaces the legacy like only behind BOTH deployment guards', () => {
  const button = read('src/components/SemearButton.tsx');
  const handler = read('server/gamification/semeaduraHandler.ts');
  assert.match(button, /import\.meta\.env\?\.VITE_SEMEADURA_UI_ENABLED === 'true'/);
  assert.match(handler, /process\.env\.KYRUB_SEMEADURA_SERVER_ENABLED !== 'true'/);
  assert.match(handler, /SEMEADURA_NOT_ENABLED/);
  assert.match(button, /requestSemeadura\('status', \{ kind, postId \}/);
  assert.match(button, /requestSemeadura\('semear', \{ kind, postId \}/);
  assert.match(button, /!state\.canSemear/);
  assert.match(button, /state\?\.closed/);
  assert.match(button, /kyrub-semeadura-updated/);
  assert.doesNotMatch(button, /setDoc\(|addDoc\(|runTransaction\(/);
});

test('community Semear is a single reused card in Mural and Praça', () => {
  const card = read('src/components/CommunityPostCard.tsx');
  const square = read('src/components/CommunitySquareFeedCard.tsx');
  const mural = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  assert.match(card, /SEMEADURA_UI_ENABLED \? \(\s*<SemearButton kind="community" postId=\{post\.id\} viewerId=\{viewerId\} compact/);
  assert.match(square, /<CommunityPostCard/);
  assert.match(mural, /<CommunityPostCard/);
  assert.match(card, /onToggleLike\(isLiked\)/);
  assert.match(card, /Curtir/); // legacy mode stays available for rollback
});

test('Praça and personal profile Semear refer to the SAME canonical personal post', () => {
  const square = read('src/components/PublicSocialFeedPanel.tsx');
  const profile = read('src/components/ProfilePostInteractionsBridge.tsx');
  assert.match(square, /SEMEADURA_UI_ENABLED && post\.visibility === 'public' && post\.publicationType !== 'status'/);
  assert.match(square, /<SemearButton kind="personal" postId=\{post\.id\} viewerId=\{currentUserId\}/);
  assert.match(profile, /SEMEADURA_UI_ENABLED && item\.post\.visibility === 'public' && item\.post\.publicationType !== 'status'/);
  assert.match(profile, /<SemearButton kind="personal" postId=\{item\.post\.id\}/);
  assert.match(square, /onToggleLike\(post\.id\)/);
  assert.match(profile, /socialFeed\.toggleLike\(item\.post\.id\)/);
});

test('Pitangueira remains personal and separated from community pages and economic balances', () => {
  const account = read('src/components/tabs/PitangaAccount.tsx');
  const community = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  const panel = read('src/components/SemeaduraJourneyPanel.tsx');
  const rules = read('firestore.rules');
  assert.match(account, /<SemeaduraJourneyPanel/);
  assert.match(account, /viewerId=\{auth\.currentUser\?\.uid \|\| ''\}/);
  assert.match(account, /xp=\{mode === 'xp' \? \(account\?\.xp \?\? null\) : undefined\}/);
  assert.match(panel, /function CocarXpIcon\(\)/);
  assert.match(panel, /const showCanonicalXp = !communityId && xp !== undefined/);
  assert.match(panel, /showCanonicalXp && \(/);
  assert.match(panel, /Cocar · XP/);
  assert.match(panel, /aria-label="Cocar, XP da conta de recompensas"/);
  assert.match(panel, /xp\.toLocaleString\('pt-BR'\)/);
  assert.doesNotMatch(community, /SemeaduraJourneyPanel|community-journey/);
  assert.match(panel, /Esta jornada é visual\. As recompensas pertencem aos autores, não à comunidade\./);
  assert.match(panel, /Pitangas equivalentes/);
  assert.match(panel, /ainda não creditadas/);
  // All new server-only counter/receipt paths remain inaccessible to clients.
  assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
  assert.doesNotMatch(rules, /match \/semeadura_post_stats\//);
  assert.doesNotMatch(rules, /match \/semeaduraProgress\//);
});
