import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import rootConsultantHandler from '../api/consultor-kyrub';
import { normalizeConsultantError } from '../src/ai/consultantError';

const createResponseRecorder = () => {
  let statusCode = 0;
  let responseBody: unknown = null;
  const headers = new Map<string, string>();
  const response = {
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(body: unknown) {
      responseBody = body;
    },
  };

  return {
    response,
    result: () => ({ statusCode, responseBody, headers }),
  };
};

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
  const recorder = createResponseRecorder();

  await rootConsultantHandler(
    { method: 'POST', headers: {}, body: {} },
    recorder.response
  );

  const result = recorder.result();
  assert.equal(result.statusCode, 401);
  assert.equal(
    (result.responseBody as Record<string, unknown>).code,
    'AUTH_REQUIRED'
  );
  assert.equal(
    typeof (result.responseBody as Record<string, unknown>).error,
    'string'
  );
});

test('self-contained route validates Firebase and calls Gemini through REST', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.GEMINI_API_KEY;
  const requestedUrls: string[] = [];

  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    requestedUrls.push(url);

    if (url.includes('identitytoolkit.googleapis.com')) {
      assert.deepEqual(JSON.parse(String(init?.body)), { idToken: 'firebase-token' });
      return Response.json({
        users: [{
          localId: 'user-1',
          email: 'owner@kyrub.com',
          displayName: 'Kyrub',
        }],
      });
    }

    if (url.includes('generativelanguage.googleapis.com')) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.ok(Array.isArray(body.contents));
      assert.ok(body.systemInstruction);
      assert.equal(
        new Headers(init?.headers).get('x-goog-api-key'),
        'gemini-test-key'
      );
      return Response.json({
        candidates: [{
          content: {
            parts: [{ text: 'Vamos organizar sua loja por etapas.' }],
          },
        }],
      });
    }

    throw new Error(`Unexpected URL: ${url}`);
  };
  process.env.GEMINI_API_KEY = 'gemini-test-key';

  try {
    const recorder = createResponseRecorder();
    await rootConsultantHandler(
      {
        method: 'POST',
        headers: { authorization: 'Bearer firebase-token' },
        body: {
          conversationId: 'conversation-1',
          topic: 'Criar minha loja',
          messages: [{
            role: 'user',
            content: 'Quero criar uma loja de plantas.',
          }],
        },
      },
      recorder.response
    );

    const result = recorder.result();
    assert.equal(result.statusCode, 200);
    assert.equal(
      (result.responseBody as Record<string, unknown>).reply,
      'Vamos organizar sua loja por etapas.'
    );
    assert.equal(
      (result.responseBody as Record<string, unknown>).provider,
      'gemini'
    );
    assert.equal(requestedUrls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalApiKey;
  }
});

test('root Vercel route has no project or SDK runtime imports', async () => {
  const source = await readFile(
    new URL('../api/consultor-kyrub.ts', import.meta.url),
    'utf8'
  );

  assert.doesNotMatch(source, /^import\s/m);
  assert.doesNotMatch(source, /@google\/genai/);
  assert.doesNotMatch(source, /\.\.\/server\/ai/);
  assert.match(source, /identitytoolkit\.googleapis\.com/);
  assert.match(source, /generativelanguage\.googleapis\.com/);
  assert.match(source, /runtime: 'self-contained-rest'/);
  assert.doesNotMatch(source, /\[object Object\]/);
});
