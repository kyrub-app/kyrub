import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertKyrubIssuanceAllowed,
  attachFeedEvidence,
  buildKyrubEconomicGovernanceSnapshot,
} from '../shared/gamificationGovernance';
import { buildKyrubRedemptionPlan } from '../shared/gamificationRedemption';
import type {
  KyrubChallengeClaim,
  KyrubRewardDefinition,
  KyrubRewardLedgerEntry,
} from '../shared/gamification';

const ledger: KyrubRewardLedgerEntry[] = [
  { id: 'e1', userId: 'u1', type: 'earn', deltaKCoins: 1000, sourceType: 'challenge', sourceId: 'c1', correlationId: 'c1', idempotencyKey: 'e1', occurredAt: '2026-08-23T10:00:00.000Z' },
  { id: 'e2', userId: 'u1', type: 'redeem', deltaKCoins: -250, sourceType: 'reward_redemption', sourceId: 'r1', correlationId: 'c2', idempotencyKey: 'e2', occurredAt: '2026-08-23T11:00:00.000Z' },
  { id: 'e3', userId: 'u1', type: 'expire', deltaKCoins: -50, sourceType: 'campaign', sourceId: 'cp1', correlationId: 'c3', idempotencyKey: 'e3', occurredAt: '2026-08-23T12:00:00.000Z' },
];

test('economic governance exposes emitted circulating redeemed and expired K-Coins', () => {
  assert.deepEqual(buildKyrubEconomicGovernanceSnapshot(ledger), {
    issuedKCoins: 1000,
    circulatingKCoins: 700,
    redeemedKCoins: 250,
    expiredKCoins: 50,
  });
});

test('issuance cap and kill switch fail closed', () => {
  assert.throws(() => assertKyrubIssuanceAllowed({ budget: { issuanceCapKCoins: 1000, issuedKCoins: 950, killSwitch: false }, requestedKCoins: 100 }), /CAP_EXCEEDED/);
  assert.throws(() => assertKyrubIssuanceAllowed({ budget: { issuanceCapKCoins: 1000, issuedKCoins: 0, killSwitch: true }, requestedKCoins: 1 }), /KILL_SWITCH/);
});

test('feed post becomes evidence submission, never automatic challenge completion', () => {
  const claim: KyrubChallengeClaim = {
    id: 'claim1', challengeId: 'challenge1', userId: 'u1', status: 'started', evidenceRefs: [], idempotencyKey: 'claim1', startedAt: '2026-08-23T09:00:00.000Z',
  };
  const next = attachFeedEvidence({ claim, evidence: { claimId: 'claim1', postId: 'post1', submittedByUserId: 'u1', submittedAt: '2026-08-23T10:00:00.000Z' } });
  assert.equal(next.status, 'submitted');
  assert.deepEqual(next.evidenceRefs, ['feed:post1']);
  assert.notEqual(next.status, 'approved');
  assert.notEqual(next.status, 'rewarded');
});

test('redemption plan produces deterministic debit voucher validity and audit identity', () => {
  const reward: KyrubRewardDefinition = {
    id: 'coffee', title: 'Café', description: 'Voucher', costKCoins: 500, fundingType: 'store', storeId: 'store1', benefit: { type: 'voucher', voucherTemplateId: 'v1' },
  };
  const input = { userId: 'u1', reward, currentBalanceKCoins: 700, idempotencyKey: 'idem-1', correlationId: 'corr-1', occurredAt: '2026-08-23T10:00:00.000Z', validUntil: '2026-09-23T10:00:00.000Z' };
  const first = buildKyrubRedemptionPlan(input);
  const second = buildKyrubRedemptionPlan(input);
  assert.deepEqual(first, second);
  assert.equal(first.debitEntry.deltaKCoins, -500);
  assert.equal(first.auditEvent.type, 'reward_redemption_planned');
  assert.ok(first.voucherCode.startsWith('KRB-COFFEE-'));
});

test('redemption cannot overdraw K-Coins', () => {
  const reward: KyrubRewardDefinition = {
    id: 'coffee', title: 'Café', description: 'Voucher', costKCoins: 500, fundingType: 'store', storeId: 'store1', benefit: { type: 'voucher', voucherTemplateId: 'v1' },
  };
  assert.throws(() => buildKyrubRedemptionPlan({ userId: 'u1', reward, currentBalanceKCoins: 499, idempotencyKey: 'idem-2', correlationId: 'corr-2', occurredAt: '2026-08-23T10:00:00.000Z', validUntil: '2026-09-23T10:00:00.000Z' }), /INSUFFICIENT_KCOINS/);
});
