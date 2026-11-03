import assert from 'node:assert/strict';
import test from 'node:test';
import { authenticateConsultantRequest } from '../server/ai/consultantAuth.js';
import { ConsultantHttpError } from '../server/ai/types.js';

const expectUnauthorized = async (authorization: string | null | undefined) => {
  await assert.rejects(
    authenticateConsultantRequest(authorization),
    (error: unknown) => error instanceof ConsultantHttpError &&
      error.status === 401 && error.code === 'AUTH_REQUIRED',
  );
};

test('renewal authentication: missing or malformed Firebase bearer never authorizes', async () => {
  for (const authorization of [
    undefined, null, '', 'Basic abc', 'Bearer', 'Bearer invalid-token',
    'Bearer a.b', 'Bearer a.b.c',
  ]) {
    await expectUnauthorized(authorization);
  }
});

test('renewal authentication: rejects unsigned JWT without fetching Firebase certificates', async () => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', kid: 'test' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    aud: 'kyrub-b8d0e', iss: 'https://securetoken.google.com/kyrub-b8d0e',
    sub: 'test-user', exp: 9999999999, iat: 1, auth_time: 1,
  })).toString('base64url');
  await expectUnauthorized(`Bearer ${header}.${payload}.signature`);
});

test('renewal authentication: rejects malformed JSON token parts before certificate lookup', async () => {
  const invalidJson = Buffer.from('{invalid').toString('base64url');
  await expectUnauthorized(`Bearer ${invalidJson}.${invalidJson}.signature`);
});
