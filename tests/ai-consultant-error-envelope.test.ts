import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import rootConsultantHandler from '../api/consultor-kyrub';
import { normalizeConsultantError } from '../src/ai/consultantError';

test('AI error normalization extracts nested Vercel envelopes', () => {
  assert.deepEqual(
    normalizeConsultantError({
      error: {
        code: 'FUNCTION_INVOCATION_FAILED',
        message: 'A função do Consultor não conseguiu iniciar.',
      },
    }),
    {
      code: 'FUNCTION_INVOCATION_FAILED',
      message: 'A função do Consultor não conseguiu iniciar.',
    }
  );

  assert.deepEqual(
    normalizeConsultantError({
      code: 'AI_NOT_CONFIGURED',
      error: 'A chave do Gemini ainda não foi configurada.',
    }),
    {
      code: 'AI_NOT_CONFIGURED',
      message: 'A chave do Gemini ainda não foi configurada.',
    }
  );
});

test('AI error normalization never renders object coercion as a message', () => {
  const result = normalizeConsultantError({ error: {} });
  assert.notEqual(result.message, '[object Object]');
  assert.match(result.message, /Consultor Kyrub/i);
  assert.equal(result.code, 'AI_UNAVAILABLE');
});

test('root Vercel handler returns authentication errors as JSON', async () => {
  let statusCode = 0;
  let responseBody: unknown = null;
  const response = {
    setHeader() {},
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(body: unknown) {
      responseBody = body;
    },
  };

  await rootConsultantHandler(
    { method: 'POST', headers: {}, body: {} },
    response
  );

  assert.equal(statusCode, 401);
  assert.equal(
    (responseBody as Record<string, unknown>).code,
    'AUTH_REQUIRED'
  );
  assert.equal(
    typeof (responseBody as Record<string, unknown>).error,
    'string'
  );
});

test('root Vercel handler statically bundles consultant modules', async () => {
  const source = await readFile(
    new URL('../api/consultor-kyrub.ts', import.meta.url),
    'utf8'
  );

  assert.match(
    source,
    /from '\.\.\/server\/ai\/consultantAuth'/
  );
  assert.match(
    source,
    /from '\.\.\/server\/ai\/consultantService'/
  );
  assert.doesNotMatch(source, /import\('\.\.\/server\/ai\//);
  assert.doesNotMatch(source, /\[object Object\]/);
});
