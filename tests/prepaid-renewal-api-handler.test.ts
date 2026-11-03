import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { ConsultantHttpError } from '../server/ai/types.js';

const source = readFileSync('api/plan-control.ts', 'utf8');
const imported = new Map<string, string[]>();
for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g)) {
  imported.set(match[2], match[1].split(',').map(s => s.trim()).filter(Boolean));
}

const calls: Array<{ name: string; input: unknown }> = [];
let simulatedFailure: Error | null = null;
const mock = (name: string, input: unknown) => {
  calls.push({ name, input });
  if (simulatedFailure) throw simulatedFailure;
  if (name === 'recordPrepaidRenewalWithVerifiedSources') return 'created';
  if (name === 'createOwnerAuthorizedPrepaidRenewalProposal') return { proposalId: 'mock-proposal' };
  if (name === 'acceptPrepaidRenewalWithFirebaseAuth') return 'accepted';
  throw new Error('UNEXPECTED_MOCK_CALL:' + name);
};

// Bundle the actual API handler and actual HTTP boundary/error mapper.
// Other services are replaced at module resolution: no database, network or payment access.
const bundled = await build({
  entryPoints: ['api/plan-control.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [{
    name: 'isolated-server-services',
    setup(plugin) {
      plugin.onResolve({ filter: /^\.\.\/server\// }, args => {
        if (args.path.includes('prepaidRenewalHttpBoundary') ||
            args.path.includes('prepaidRenewalHttpErrors') ||
            args.path.includes('consultantAuth')) return;
        return { path: args.path, namespace: 'isolated-services' };
      });
      plugin.onLoad({ filter: /.*/, namespace: 'isolated-services' }, args => {
        const names = imported.get(args.path) ?? [];
        return {
          contents: names.map(name =>
            name === 'OfficialPlanCheckoutRouteError' || name === 'StoreSubscriptionBenefitError'
              ? `export class ${name} extends Error {}`
              : `export const ${name} = (...args) => globalThis.__kyrubRenewalHttpMock(${JSON.stringify(name)}, args[0]);`
          ).join('\n'),
          loader: 'js',
        };
      });
    },
  }],
});
const encoded = Buffer.from(bundled.outputFiles[0].text).toString('base64');
const { default: handler } = await import('data:text/javascript;base64,' + encoded);
(globalThis as typeof globalThis & { __kyrubRenewalHttpMock?: typeof mock }).__kyrubRenewalHttpMock = mock;

const proposalId = 'a'.repeat(64);
const body = { storeId: 'store-a', proposalId, paymentId: '123456' };
const invoke = async (op: string, method: string, requestBody: unknown, authorization = 'Bearer test') => {
  const state: { status: number; body: unknown; headers: Record<string, string> } = {
    status: 0, body: null, headers: {},
  };
  const response = {
    setHeader(name: string, value: string) { state.headers[name] = value; },
    status(code: number) { state.status = code; return this; },
    json(value: unknown) { state.body = value; },
  };
  calls.length = 0;
  await handler({ method, query: { op }, headers: { authorization }, body: requestBody }, response);
  return state;
};

test('actual API route rejects malformed and client-controlled payment data before any service call', async () => {
  const result = await invoke('merchant.prepaid-renewal.reconcile', 'POST', { ...body, amountMinor: 100 });
  assert.equal(result.status, 400);
  assert.equal(calls.length, 0);
});

test('actual API route rejects GET reconciliation without calling provider', async () => {
  const result = await invoke('merchant.prepaid-renewal.reconcile', 'GET', body);
  assert.equal(result.status, 405);
  assert.equal(calls.length, 0);
});

test('actual API route forwards authenticated reconciliation request to server service', async () => {
  const result = await invoke('merchant.prepaid-renewal.reconcile', 'POST', body);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { status: 'created' });
  assert.deepEqual(calls, [{
    name: 'recordPrepaidRenewalWithVerifiedSources',
    input: { ...body, authorization: 'Bearer test' },
  }]);
});

test('actual API route validates owner proposal and buyer acceptance fields', async () => {
  const invalid = await invoke('merchant.prepaid-renewal.propose', 'POST', { storeId: 'store-a', previousContractId: 'contract-1', amountMinor: 1 });
  assert.equal(invalid.status, 400);
  assert.equal(calls.length, 0);
  const accepted = await invoke('merchant.prepaid-renewal.accept', 'POST', {
    storeId: 'store-a', proposalId, acceptedTotalMinor: 2000,
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(accepted.body, { status: 'accepted' });
  assert.equal(calls[0].name, 'acceptPrepaidRenewalWithFirebaseAuth');
});

test('actual API route maps simulated payment and contract errors without leaking a success response', async () => {
  for (const [code, expected] of [
    ['RENEWAL_PAYMENT_NOT_CONFIRMED', 422],
    ['RENEWAL_PROVIDER_PAYMENT_MISMATCH', 422],
    ['RENEWAL_SELLER_ACCOUNT_NOT_VERIFIED', 422],
    ['RENEWAL_SELLER_NOT_AUTHORIZED', 403],
    ['RENEWAL_ACCEPTANCE_CHANGED', 409],
    ['RENEWAL_PROPOSAL_NOT_FOUND', 404],
  ] as const) {
    simulatedFailure = new Error(code);
    try {
      const result = await invoke('merchant.prepaid-renewal.reconcile', 'POST', body);
      assert.equal(result.status, expected, code);
      assert.equal((result.body as { code: string }).code, code);
      assert.equal(calls.length, 1);
    } finally {
      simulatedFailure = null;
    }
  }
});

test('actual API route maps simulated invalid renewal input to 400', async () => {
  simulatedFailure = new Error('INVALID_RENEWAL_IDENTITY');
  try {
    const result = await invoke('merchant.prepaid-renewal.reconcile', 'POST', body);
    assert.equal(result.status, 400);
    assert.equal((result.body as { code: string }).code, 'INVALID_RENEWAL_IDENTITY');
  } finally {
    simulatedFailure = null;
  }
});

test('actual API route forwards missing authorization to the authentication-owning service without granting access locally', async () => {
  const result = await invoke('merchant.prepaid-renewal.reconcile', 'POST', body, '');
  assert.equal(result.status, 200);
  assert.deepEqual(calls, [{
    name: 'recordPrepaidRenewalWithVerifiedSources',
    input: { ...body, authorization: '' },
  }]);
  // The stub does not authenticate: this test asserts routing only.
  // The production reconciliation service must verify the Firebase token.
});

test('actual API route maps simulated Firebase authentication rejection and outage', async () => {
  for (const [status, code] of [[401, 'AUTH_REQUIRED'], [503, 'AUTH_UNAVAILABLE']] as const) {
    simulatedFailure = new ConsultantHttpError(
      status, code as ConstructorParameters<typeof ConsultantHttpError>[1], code,
    );
    try {
      const result = await invoke('merchant.prepaid-renewal.reconcile', 'POST', body, '');
      assert.equal(result.status, status);
      assert.equal((result.body as { code: string }).code, code);
      assert.equal(calls.length, 1);
    } finally {
      simulatedFailure = null;
    }
  }
});
