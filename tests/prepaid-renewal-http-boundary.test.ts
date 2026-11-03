import assert from 'node:assert/strict';
import test from 'node:test';
import { handlePrepaidRenewalReconciliation } from '../server/payments/prepaidRenewalHttpBoundary.js';

const proposalId = 'a'.repeat(64);
const valid = { storeId: 'store-a', proposalId, paymentId: '123456' };
const response = () => {
  const state: { code: number; body: unknown; headers: Record<string, string> } = {
    code: 0, body: null, headers: {},
  };
  return {
    state,
    setHeader(name: string, value: string) { state.headers[name] = value; },
    status(code: number) { state.code = code; return this; },
    json(body: unknown) { state.body = body; },
  };
};

test('HTTP: rejects GET without calling reconciliation', async () => {
  const res = response();
  let calls = 0;
  await handlePrepaidRenewalReconciliation(
    { method: 'GET', body: valid, authorization: 'Bearer test' }, res,
    async () => { calls++; return 'created'; },
  );
  assert.equal(res.state.code, 405);
  assert.equal(calls, 0);
});

test('HTTP: rejects extra client-controlled financial fields', async () => {
  for (const field of ['amountMinor', 'collector_id', 'acceptedTotalMinor', 'accessToken']) {
    const res = response();
    await handlePrepaidRenewalReconciliation(
      { method: 'POST', body: { ...valid, [field]: 100 }, authorization: 'Bearer test' }, res,
      async () => { throw new Error('SHOULD_NOT_CALL_PROVIDER'); },
    );
    assert.equal(res.state.code, 400);
    assert.deepEqual(res.state.body, {
      error: 'Informe loja, proposta aceita e identificador do pagamento.',
      code: 'INVALID_RENEWAL_RECONCILIATION_REQUEST',
    });
  }
});

test('HTTP: rejects malformed payment and proposal identifiers', async () => {
  for (const body of [
    { ...valid, paymentId: 'abc' },
    { ...valid, paymentId: '-1' },
    { ...valid, proposalId: 'not-a-digest' },
    { ...valid, storeId: '../other-store' },
  ]) {
    const res = response();
    await handlePrepaidRenewalReconciliation(
      { method: 'POST', body, authorization: 'Bearer test' }, res,
      async () => { throw new Error('SHOULD_NOT_CALL_PROVIDER'); },
    );
    assert.equal(res.state.code, 400);
  }
});

test('HTTP: valid request forwards only authenticated reconciliation fields', async () => {
  const res = response();
  let received: unknown;
  await handlePrepaidRenewalReconciliation(
    { method: 'POST', body: valid, authorization: 'Bearer test-user' }, res,
    async input => { received = input; return 'already_recorded'; },
  );
  assert.deepEqual(received, { ...valid, authorization: 'Bearer test-user' });
  assert.equal(res.state.code, 200);
  assert.deepEqual(res.state.body, { status: 'already_recorded' });
  assert.equal(res.state.headers['cache-control'], 'no-store, max-age=0');
});
