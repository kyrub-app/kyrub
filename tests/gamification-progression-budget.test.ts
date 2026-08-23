import assert from 'node:assert/strict';
import test from 'node:test';
import { PROGRESSION_ASSETS, assertRewardFundingAuthority, levelForXp } from '../shared/gamificationProgression';
import { canIssueCampaignReward } from '../shared/campaignBudgetGuard';

test('XP, Level, Achievement, Badge and K-Coin are distinct progression assets', () => {
  assert.deepEqual(PROGRESSION_ASSETS, ['xp', 'level', 'achievement', 'badge', 'k_coin']);
});

test('level derives from XP without converting XP into K-Coins', () => {
  const level = levelForXp(120, [
    { level: 1, minimumXp: 0, title: 'Início' },
    { level: 2, minimumXp: 100, title: 'Avançando' },
  ]);
  assert.equal(level?.level, 2);
});

test('reward funding declares the payer authority explicitly', () => {
  assert.doesNotThrow(() => assertRewardFundingAuthority({
    source: 'store', payerIds: ['store-1'], correlationId: 'corr-1',
  }));
  assert.throws(() => assertRewardFundingAuthority({
    source: 'mixed', payerIds: ['store-1'], correlationId: 'corr-2',
  }), /FUNDING_MIXED_REQUIRES_MULTIPLE_PAYERS/);
});

test('budget guard blocks kill switch, budget overflow and redemption cap', () => {
  const policy = {
    budgetKCoins: 1000,
    issuanceCap: 800,
    redemptionCap: 10,
    startsAt: '2026-08-01T00:00:00.000Z',
    endsAt: '2026-09-01T00:00:00.000Z',
    killSwitch: false,
  };
  assert.equal(canIssueCampaignReward({
    policy, usage: { issuedKCoins: 700, redeemedKCoins: 400, redemptions: 5 }, rewardKCoins: 50, now: '2026-08-20T00:00:00.000Z',
  }), true);
  assert.equal(canIssueCampaignReward({
    policy, usage: { issuedKCoins: 780, redeemedKCoins: 400, redemptions: 5 }, rewardKCoins: 50, now: '2026-08-20T00:00:00.000Z',
  }), false);
  assert.equal(canIssueCampaignReward({
    policy: { ...policy, killSwitch: true }, usage: { issuedKCoins: 0, redeemedKCoins: 0, redemptions: 0 }, rewardKCoins: 10, now: '2026-08-20T00:00:00.000Z',
  }), false);
});
