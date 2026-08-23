import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALL_GAMIFICATION_FRAUD_SIGNALS,
  assessGamificationFraud,
} from '../shared/gamificationAntifraud';

test('official antifraud matrix includes every phase-5 signal', () => {
  assert.deepEqual(ALL_GAMIFICATION_FRAUD_SIGNALS, [
    'multi_account',
    'self_referral',
    'reward_farming',
    'false_evidence',
    'duplicate_redemption',
    'replay',
    'rate_limit_exceeded',
  ]);
});

test('duplicate redemption, replay and self-referral fail closed', () => {
  for (const signal of ['duplicate_redemption', 'replay', 'self_referral'] as const) {
    const result = assessGamificationFraud([signal]);
    assert.equal(result.disposition, 'reject');
    assert.equal(result.rewardIssuanceAllowed, false);
    assert.equal(result.requiresAuditEvent, true);
  }
});

test('suspicious identity/evidence patterns require review before reward issuance', () => {
  for (const signal of ['multi_account', 'reward_farming', 'false_evidence'] as const) {
    const result = assessGamificationFraud([signal]);
    assert.equal(result.disposition, 'manual_review');
    assert.equal(result.rewardIssuanceAllowed, false);
  }
});

test('rate limit blocks issuance without turning suspicion into automatic guilt', () => {
  const result = assessGamificationFraud(['rate_limit_exceeded']);
  assert.equal(result.disposition, 'rate_limited');
  assert.equal(result.rewardIssuanceAllowed, false);
});
