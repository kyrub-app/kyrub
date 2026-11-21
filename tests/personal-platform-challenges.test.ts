import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { projectPlatformChallengeCatalog } from '../shared/platformChallengeCatalog';
import type { KyrubChallengeDefinition } from '../shared/gamification';

const current = '2026-11-21T15:00:00.000Z';
const challenge: KyrubChallengeDefinition = {
  id: 'first_store_created', title: 'Publique sua primeira loja',
  description: 'Publique a loja para participar.',
  sponsorType: 'kyrub', validationMode: 'deterministic', status: 'published',
  rewardXp: 2, rewardKCoins: 0, maxCompletionsPerUser: 1,
};
const read = (path: string) => readFileSync(path, 'utf8');

test('published, active and confirmed historical challenges without drafts or invented progress', () => {
  const result = projectPlatformChallengeCatalog([
    { ...challenge, status: 'draft', id: 'drafted' },
    { ...challenge, status: 'cancelled', id: 'cancelled' },
    { ...challenge, status: 'ended', id: 'ended' },
    { ...challenge, status: 'published', id: 'future', startsAt: '2026-12-01T00:00:00Z' },
    { ...challenge, status: 'published', id: 'expired', endsAt: '2026-11-20T00:00:00Z' },
    { ...challenge, status: 'active', id: 'live' },
    challenge,
  ], {}, current);
  assert.deepEqual(result.challenges.map(c => c.id), ['first_store_created', 'live']);
  assert.equal(result.availableCount, 2);
  assert.equal(result.completedCount, 0);
  assert.equal(result.challenges[0].status, 'available');
  assert.equal(result.challenges[0].rewardXp, 2);
  assert.equal(result.challenges[0].rewardPitangas, 0);
});

test('only authoritative receipt confirmations produce completed cards and history', () => {
  const result = projectPlatformChallengeCatalog([
    challenge, { ...challenge, id: 'old', status: 'ended', endsAt: '2026-11-01T00:00:00Z' },
  ], { first_store_created: 1, old: 2 }, current);
  assert.equal(result.availableCount, 0);
  assert.equal(result.completedCount, 2);
  assert.ok(result.challenges.every(c => c.status === 'completed'));
  assert.equal(result.challenges.find(c => c.id === 'first_store_created')?.completionsConfirmed, 1);
  assert.equal(result.challenges.find(c => c.id === 'old')?.completionsConfirmed, 1,
    'Clamp confirmation to maximum allowed per user');
});

test('legacy reward units are read-only and cannot be awarded from the profile', () => {
  const api = read('api/action-execute.ts');
  const service = read('server/gamification/userPlatformChallengeCatalogService.ts');
  const hook = read('src/hooks/usePlatformChallenges.ts');
  const component = read('src/components/PlatformChallengesPanel.tsx');
  const profile = read('src/components/modals/UserProfileModal.tsx');

  assert.match(api, /if \(transport === 'global-challenge-catalog'\)/);
  assert.match(api, /if \(method !== 'GET'\)/);
  assert.match(api, /verifyFirebaseIdToken\(token\)/);
  assert.match(service, /\.where\('status', 'in', \['published', 'active', 'ended'\]\)/);
  assert.match(service, /\.collection\('users'\)\.doc\(uid\)\.collection\('challengeRewards'\)/);
  assert.match(service, /data\?\.userId !== uid/);
  assert.match(service, /projectPlatformChallengeCatalog\(challenges, receiptCounts, now\)/);
  assert.doesNotMatch(service, /\b(?:tx|ref|doc|adminDb|db)\.(?:create|set|update|delete)\(/);
  assert.match(hook, /method: 'GET'/);
  assert.match(hook, /auth\.currentUser\?\.getIdToken\(\)/);
  assert.match(component, /Abrir desafios não concede recompensas/);
  assert.match(component, /Disponíveis/);
  assert.match(component, /Concluídos/);
  assert.match(profile, /id: 'challenges', label: 'Desafios da plataforma'/);
  assert.match(profile, /card\.id === 'challenges' \? 'col-span-2'/);
  assert.match(profile, /personalPanel === 'challenges' && <PlatformChallengesPanel/);
  assert.ok(profile.indexOf("id: 'challenges'") > profile.indexOf("id: 'xp'"),
    'Challenge card is below XP and conquistas');
});

test('personal panel includes loading, retry, empty state and no action claiming grants', () => {
  const ui = read('src/components/PlatformChallengesPanel.tsx');
  assert.match(ui, /Carregando desafios/);
  assert.match(ui, /Tentar novamente/);
  assert.match(ui, /Nenhum desafio disponível no momento/);
  assert.match(ui, /O progresso aparece após confirmação pelo sistema/);
  assert.doesNotMatch(ui, /fetch\(|setDoc\(|updateDoc\(|POST|onClaim|awardReward/);
});
