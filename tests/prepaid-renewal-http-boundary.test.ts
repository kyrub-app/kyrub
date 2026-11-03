import assert from 'node:assert/strict';
import test from 'node:test';
import { handlePrepaidRenewalReconciliation } from '../server/payments/prepaidRenewalHttpBoundary.js';
import { mapPrepaidRenewalHttpError } from '../server/payments/prepaidRenewalHttpErrors.js';
import { ConsultantHttpError } from '../server/ai/types.js';

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

test('HTTP: provider and authentication errors propagate without successful response', async () => {
  for (const code of [
    'RENEWAL_PAYMENT_NOT_CONFIRMED',
    'RENEWAL_PROVIDER_PAYMENT_MISMATCH',
    'RENEWAL_SELLER_ACCOUNT_NOT_VERIFIED',
    'RENEWAL_SELLER_NOT_AUTHORIZED',
    'RENEWAL_ACCEPTANCE_CHANGED',
  ]) {
    const res = response();
    await assert.rejects(
      handlePrepaidRenewalReconciliation(
        { method: 'POST', body: valid, authorization: 'Bearer test-user' },
        res,
        async () => { throw new Error(code); },
      ),
      new RegExp(code),
    );
    assert.equal(res.state.code, 0);
    assert.equal(res.state.body, null);
  }
});

test('HTTP: reconciliation preserves missing authorization for server-side authentication', async () => {
  const res = response();
  let received: unknown;
  await handlePrepaidRenewalReconciliation(
    { method: 'POST', body: valid, authorization: '' },
    res,
    async input => { received = input; return 'created'; },
  );
  assert.deepEqual(received, { ...valid, authorization: '' });
});

test('HTTP: financial, authorization and contract errors map to correct status codes', () => {
  const cases: Array<[string, number]> = [
    ['RENEWAL_SELLER_NOT_AUTHORIZED', 403],
    ['RENEWAL_PROPOSAL_NOT_FOUND', 404],
    ['RENEWAL_PREVIOUS_CONTRACT_NOT_FOUND', 404],
    ['RENEWAL_PROVIDER_PAYMENT_MISMATCH', 422],
    ['RENEWAL_PAYMENT_NOT_CONFIRMED', 422],
    ['RENEWAL_SELLER_ACCOUNT_NOT_VERIFIED', 422],
    ['INVALID_RENEWAL_PROPOSAL_INPUT', 400],
    ['RENEWAL_ACCEPTANCE_CHANGED', 409],
    ['RENEWAL_PAYMENT_ALREADY_USED', 409],
  ];
  for (const [code, expected] of cases) {
    const mapped = mapPrepaidRenewalHttpError(new Error(code));
    assert.equal(mapped?.status, expected, code);
    assert.equal(mapped?.body.code, code);
  }
  assert.equal(mapPrepaidRenewalHttpError(new Error('UNEXPECTED_ERROR')), null);
  assert.equal(mapPrepaidRenewalHttpError('RENEWAL_PAYMENT_NOT_CONFIRMED'), null);
});

test('HTTP: unauthenticated buyer and unavailable Firebase auth preserve 401/503', () => {
  for (const [status, code] of [[401, 'AUTH_REQUIRED'], [503, 'AUTH_UNAVAILABLE']] as const) {
    const mapped = mapPrepaidRenewalHttpError(
      new ConsultantHttpError(status, code, 'Falha na validação da sessão.'),
    );
    assert.equal(mapped?.status, status);
    assert.equal(mapped?.body.code, code);
  }
});
