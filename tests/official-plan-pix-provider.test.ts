import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import { officialPlanPixAccount, officialPlanPixRequest, verifyOfficialPlanPixSignature } from '../server/payments/officialPlanPixProvider.js';
import { parseOfficialPlanRewards } from '../shared/officialPlanRewards.js';

test('platform transport never uses merchant credentials and never logs provider payloads', async () => {
  const originalFetch = globalThis.fetch;
  const old = { ...process.env };
  try {
    process.env.KYRUB_BILLING_MERCADO_PAGO_ACCESS_TOKEN = 'platform-test-token';
    process.env.KYRUB_BILLING_MERCADO_PAGO_WEBHOOK_SECRET = 'platform-test-secret';
    process.env.MERCADO_PAGO_ACCESS_TOKEN = 'unrelated-merchant-token';
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (async (url: any, init: any) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify({ id: 42 }), { status: 200 }); }) as typeof fetch;
    assert.equal(await officialPlanPixAccount(), '42');
    assert.equal(calls[0].url, 'https://api.mercadopago.com/users/me');
    assert.equal((calls[0].init.headers as Record<string, string>).authorization, 'Bearer platform-test-token');
    await assert.rejects(officialPlanPixRequest('https://other.example/v1/payments'), /PATH_INVALID/);
    assert.equal(calls.length, 1);
    delete process.env.KYRUB_BILLING_MERCADO_PAGO_ACCESS_TOKEN;
    await assert.rejects(officialPlanPixAccount(), /NOT_CONFIGURED/);
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = originalFetch; process.env = old; }
});

test('official notification accepts only the platform HMAC secret', () => {
  const old = process.env.KYRUB_BILLING_MERCADO_PAGO_WEBHOOK_SECRET;
  try {
    process.env.KYRUB_BILLING_MERCADO_PAGO_WEBHOOK_SECRET = 'platform-test-secret';
    const signature = createHmac('sha256', 'platform-test-secret').update('id:123;request-id:req;ts:1234;').digest('hex');
    verifyOfficialPlanPixSignature({ 'x-signature': `ts=1234,v1=${signature}`, 'x-request-id': 'req' }, '123');
    process.env.KYRUB_BILLING_MERCADO_PAGO_WEBHOOK_SECRET = 'other-secret';
    assert.throws(() => verifyOfficialPlanPixSignature({ 'x-signature': `ts=1234,v1=${signature}`, 'x-request-id': 'req' }, '123'), /SIGNATURE/);
  } finally {
    if (old === undefined) delete process.env.KYRUB_BILLING_MERCADO_PAGO_WEBHOOK_SECRET;
    else process.env.KYRUB_BILLING_MERCADO_PAGO_WEBHOOK_SECRET = old;
  }
});

test('reward config is explicit, bounded and cannot mint K-Coins or money', () => {
  assert.deepEqual(parseOfficialPlanRewards(undefined), { xp: 0 });
  assert.deepEqual(parseOfficialPlanRewards({ xp: 15 }), { xp: 15 });
  for (const input of [{ xp: -1 }, { xp: 1.5 }, { xp: 1000001 }, { xp: 0, rewardKCoins: 100 },
    { xp: 0, achievement: { id: '../other', title: 'Test', description: '' } },
    { xp: 0, achievement: { id: 'test', title: 'Test', description: '', rewardKCoins: 1 } }]) {
    assert.throws(() => parseOfficialPlanRewards(input), /REWARDS_INVALID/);
  }
});
