import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertKyrubChallengeDefinition,
  assertKyrubRewardDefinition,
  kyrubKCoinBalance,
  kyrubXpTotal,
  type KyrubRewardLedgerEntry,
} from '../shared/gamification';

const entry = (overrides: Partial<KyrubRewardLedgerEntry>): KyrubRewardLedgerEntry => ({
  id: 'entry-1',
  userId: 'user-1',
  type: 'earn',
  deltaKCoins: 1000,
  sourceType: 'challenge',
  sourceId: 'challenge-1',
  correlationId: 'corr-1',
  idempotencyKey: 'reward:challenge-1:user-1',
  occurredAt: '2026-08-22T00:00:00.000Z',
  ...overrides,
});

test('K-Coins derive from an auditable signed ledger rather than a mutable balance field', () => {
  assert.equal(kyrubKCoinBalance([
    entry({}),
    entry({ id: 'entry-2', type: 'redeem', deltaKCoins: -400, sourceType: 'reward_redemption', sourceId: 'reward-1', idempotencyKey: 'redeem:reward-1:user-1' }),
  ]), 600);
});

test('Reward Ledger rejects duplicate idempotency keys and negative balances', () => {
  assert.throws(() => kyrubKCoinBalance([
    entry({}),
    entry({ id: 'entry-2' }),
  ]), /Lançamento duplicado/);
  assert.throws(() => kyrubKCoinBalance([
    entry({ type: 'redeem', deltaKCoins: -1, sourceType: 'reward_redemption', sourceId: 'reward-1' }),
  ]), /saldo negativo/);
});

test('XP remains a separate progression ledger from redeemable K-Coins', () => {
  const xp = kyrubXpTotal([{
    id: 'xp-1',
    userId: 'user-1',
    deltaXp: 250,
    sourceType: 'achievement',
    sourceId: 'achievement-1',
    correlationId: 'corr-xp',
    idempotencyKey: 'xp:achievement-1:user-1',
    occurredAt: '2026-08-22T00:00:00.000Z',
  }]);
  assert.equal(xp, 250);
  assert.equal(kyrubKCoinBalance([entry({})]), 1000);
});

test('challenge contracts support multiple evidence modes without treating rewards as cash', () => {
  const challenge = assertKyrubChallengeDefinition({
    id: 'study-intermediate-week',
    title: 'Avance seus estudos em uma semana',
    description: 'Comprove a evolução conforme as regras do desafio.',
    status: 'draft',
    validationMode: 'feed_post',
    rewardKCoins: 1000,
    rewardXp: 300,
    maxCompletionsPerUser: 1,
    sponsorType: 'kyrub',
  });
  assert.equal(challenge.rewardKCoins, 1000);
  assert.equal(challenge.rewardXp, 300);
});

test('reward catalog spends K-Coins on benefits rather than declaring a cash balance', () => {
  const reward = assertKyrubRewardDefinition({
    id: 'voucher-city-10',
    title: 'Voucher da loja',
    description: 'Benefício promocional sujeito às condições da campanha.',
    costKCoins: 1000,
    inventoryLimit: 100,
    fundingType: 'store',
    storeId: 'store-1',
    benefit: { type: 'voucher', voucherTemplateId: 'voucher-template-1' },
  });
  assert.equal(reward.costKCoins, 1000);
  assert.equal(reward.benefit.type, 'voucher');
});