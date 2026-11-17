import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handlePitangaAccount } from '../server/gamification/pitangaAccountHandler.js';

async function call(method: string, body?: unknown, token = 'Bearer signed', failure?: string) {
  let status = 0; let result: any; const calls: unknown[] = [];
  const headers: Record<string, string> = {};
  const response = { setHeader: (k: string, v: string) => { headers[k] = v; },
    status: (code: number) => { status = code; return response; }, json: (data: unknown) => { result = data; } };
  await handlePitangaAccount({ method, body, headers: { authorization: token } }, response, {
    verify: async () => { if (token === 'Bearer invalid') throw Error(); return { uid: 'signed_user' }; },
    read: async uid => { calls.push(uid); return { pitangas: 100, xp: 2 }; },
    convert: async (uid, input) => { calls.push({ uid, ...input }); if (failure) throw Error(failure); return { replay: true }; },
  });
  return { status, result, calls, headers };
}

test('statement is authenticated, private, scoped to token identity', async () => {
  assert.equal((await call('GET', undefined, '')).status, 401);
  assert.equal((await call('GET', undefined, 'Bearer invalid')).status, 401);
  const result = await call('GET', { userId: 'other' });
  assert.equal(result.status, 200); assert.deepEqual(result.calls, ['signed_user']);
  assert.match(result.headers['Cache-Control'], /no-store/);
});

test('conversion rejects caller identity, paths, timestamps and malformed amounts before writing', async () => {
  for (const body of [null, [], {}, { requestId: '../a', requestedXp: 1 },
    { requestId: 'a', requestedXp: 0 }, { requestId: 'a', requestedXp: 1.2 },
    { requestId: 'a', requestedXp: Number.MAX_SAFE_INTEGER },
    { requestId: 'a', requestedXp: 1, userId: 'victim' },
    { requestId: 'a', requestedXp: 1, balanceRef: 'users/victim' },
    { requestId: 'a', requestedXp: 1, occurredAt: '2020-01-01' }]) {
    const result = await call('POST', body);
    assert.equal(result.status, 400); assert.deepEqual(result.calls, []);
  }
});

test('conversion preserves idempotency key and maps insufficient balance, conflict and closed gates', async () => {
  const input = { requestId: 'stable_request', requestedXp: 1 };
  const success = await call('POST', input);
  assert.equal(success.status, 200); assert.deepEqual(success.calls, [{ uid: 'signed_user', ...input }]);
  for (const code of ['PITANGA_BALANCE_INSUFFICIENT', 'CONVERSION_IDEMPOTENCY_CONFLICT']) assert.equal((await call('POST', input, 'Bearer signed', code)).status, 409);
  assert.equal((await call('POST', input, 'Bearer signed', 'PITANGA_CONVERSION_DISABLED')).status, 503);
  assert.equal((await call('DELETE')).status, 405);
});
