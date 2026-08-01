import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import handler from '../api/kyrubia';

type TestResponse = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  setHeader(name: string, value: string): void;
  status(code: number): TestResponse;
  json(body: unknown): void;
};

const createResponse = (): TestResponse => ({
  statusCode: 200,
  body: undefined,
  headers: {},
  setHeader(name, value) {
    this.headers[name.toLowerCase()] = value;
  },
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
  },
});

test('Kyrubia is the named AI persona and uses a restrained opportunity lens', () => {
  const routeSource = readFileSync('api/kyrubia.ts', 'utf8');
  const sharedSource = readFileSync('shared/aiConsultant.ts', 'utf8');
  const namingSource = readFileSync(
    'src/components/KyrubiaNamingBridge.tsx',
    'utf8'
  );
  const appSource = readFileSync('src/App.tsx', 'utf8');
  const constitution = readFileSync('docs/KYRUBIA.md', 'utf8');

  assert.match(sharedSource, /KYRUB_AI_CONSULTANT_ENDPOINT = '\/api\/kyrubia'/);
  assert.match(sharedSource, /KYRUB_AI_CONSULTANT_LEGACY_ENDPOINT = '\/api\/ai\/consultant'/);
  assert.match(routeSource, /Você é Kyrubia, a inteligência artificial de Kyrub/);
  assert.match(routeSource, /Resolva primeiro o pedido real do usuário/);
  assert.match(routeSource, /encerre com UMA pergunta curta oferecendo aprofundamento/);
  assert.match(routeSource, /Não despeje uma árvore inteira/);
  assert.match(routeSource, /Não force monetização em conversas de luto/);
  assert.match(routeSource, /Nunca garanta lucro, resultado, demanda, retorno ou sucesso/);
  assert.match(routeSource, /ingredientes, utensílios quando úteis, preparo, tempos, cuidados, conservação e o momento de servir/);
  assert.match(routeSource, /functionCallingConfig:\s*{\s*mode: 'AUTO',\s*}/);
  assert.doesNotMatch(routeSource, /allowedFunctionNames/);
  assert.doesNotMatch(routeSource, /firebase\/firestore|firebase-admin|@google\/genai/);

  assert.match(namingSource, /\['Consultor Kyrub', 'Kyrubia'\]/);
  assert.match(namingSource, /Notas com confirmação/);
  assert.match(appSource, /<KyrubiaNamingBridge \/>/);
  assert.match(constitution, /Lente de Oportunidades/);
  assert.match(constitution, /pedir permissão/i);
});

test('Kyrubia health response exposes persona, note skill and opportunity lens', async () => {
  const response = createResponse();

  await handler(
    { method: 'GET', headers: {} },
    response
  );

  assert.equal(response.statusCode, 200);
  const body = response.body as Record<string, unknown>;
  assert.equal(body.service, 'kyrubia');
  assert.equal(body.persona, 'Kyrubia');
  assert.equal(body.actionsEnabled, true);
  assert.deepEqual(body.enabledActions, ['create_note']);
  assert.equal(body.opportunityLensEnabled, true);
});

test('Kyrubia can prepare a complete recipe note without saving it directly', async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-gemini-key';

  let callCount = 0;
  globalThis.fetch = async (input, init) => {
    callCount += 1;
    const url = String(input);

    if (url.includes('identitytoolkit.googleapis.com')) {
      return new Response(JSON.stringify({
        users: [{
          localId: 'user-1',
          email: 'user@example.com',
          displayName: 'Mauricio',
        }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    assert.match(url, /generativelanguage\.googleapis\.com/);
    const requestPayload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const instruction = JSON.stringify(requestPayload.systemInstruction);
    const toolConfig = requestPayload.toolConfig as Record<string, unknown>;
    const functionCallingConfig = toolConfig.functionCallingConfig as Record<string, unknown>;
    assert.match(instruction, /Kyrubia/);
    assert.match(instruction, /oportunidade/i);
    assert.match(JSON.stringify(requestPayload.tools), /create_note/);
    assert.equal(functionCallingConfig.mode, 'AUTO');
    assert.equal('allowedFunctionNames' in functionCallingConfig, false);

    return new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            functionCall: {
              id: 'recipe-call-1',
              name: 'create_note',
              args: {
                title: 'Bolo de chocolate do início ao servir',
                content:
                  'Ingredientes: farinha, ovos, açúcar e chocolate. Preparo: misture, asse, deixe amornar, finalize e sirva.',
                checklist: [
                  'Separar os ingredientes',
                  'Preparar a massa',
                  'Assar o bolo',
                  'Finalizar e servir',
                ],
              },
            },
          }],
        },
      }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const response = createResponse();
    await handler(
      {
        method: 'POST',
        headers: { authorization: 'Bearer valid-test-token' },
        body: {
          conversationId: 'conversation-1',
          topic: 'Receita de bolo',
          messages: [{
            role: 'user',
            content:
              'Crie uma receita completa de bolo e adicione às minhas notas, da lista de ingredientes ao momento de servir.',
          }],
        },
      },
      response
    );

    assert.equal(callCount, 2);
    assert.equal(response.statusCode, 200);
    const body = response.body as Record<string, unknown>;
    const proposal = body.actionProposal as Record<string, unknown>;
    assert.equal(proposal.type, 'create_note');
    assert.equal(proposal.requiresConfirmation, true);
    assert.match(String(proposal.content), /Ingredientes/);
    assert.deepEqual(proposal.checklist, [
      'Separar os ingredientes',
      'Preparar a massa',
      'Assar o bolo',
      'Finalizar e servir',
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});
