import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import consultantHandler from '../api/consultor-kyrub';

test('Gemini create_note function returns a proposal without executing data writes', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.GEMINI_API_KEY;
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];

  process.env.GEMINI_API_KEY = 'gemini-test-key';
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = typeof init?.body === 'string'
      ? JSON.parse(init.body) as Record<string, unknown>
      : {};
    requests.push({ url, body });

    if (url.includes('identitytoolkit.googleapis.com')) {
      return Response.json({
        users: [{
          localId: 'user-1',
          email: 'kyrub@example.com',
          displayName: 'Kyrub',
        }],
      });
    }

    assert.match(url, /generativelanguage\.googleapis\.com/);
    assert.ok(Array.isArray(body.tools));
    return Response.json({
      candidates: [{
        content: {
          role: 'model',
          parts: [{
            functionCall: {
              id: 'call-create-note-1',
              name: 'create_note',
              args: {
                title: 'Comprar embalagens',
                content: 'Pesquisar e comprar embalagens para os próximos pedidos.',
                checklist: ['Pesquisar fornecedores', 'Comparar preços'],
              },
            },
          }],
        },
      }],
    });
  };

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

  try {
    await consultantHandler(
      {
        method: 'POST',
        headers: { authorization: 'Bearer firebase-token' },
        body: {
          conversationId: 'conversation-1',
          topic: 'Trabalho e organização',
          messages: [{
            role: 'user',
            content: 'Crie uma nota para comprar embalagens e inclua um checklist.',
          }],
        },
      },
      response
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalApiKey;
  }

  assert.equal(statusCode, 200);
  const payload = responseBody as Record<string, any>;
  assert.equal(payload.actionProposal.type, 'create_note');
  assert.equal(payload.actionProposal.requiresConfirmation, true);
  assert.equal(payload.actionProposal.title, 'Comprar embalagens');
  assert.deepEqual(payload.actionProposal.checklist, [
    'Pesquisar fornecedores',
    'Comparar preços',
  ]);
  assert.equal(payload.capabilities.actionsEnabled, true);
  assert.deepEqual(payload.capabilities.enabledActions, ['create_note']);
  assert.equal(requests.length, 2);
});

test('create-note confirmation reuses the existing manual notes form', async () => {
  const [
    appSource,
    bridgeSource,
    clientSource,
    sharedSource,
    routeSource,
    manualNotesSource,
    serverSource,
  ] = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(
      new URL('../src/components/KyrubAiNoteActionBridge.tsx', import.meta.url),
      'utf8'
    ),
    readFile(new URL('../src/ai/consultantClient.ts', import.meta.url), 'utf8'),
    readFile(new URL('../shared/aiConsultant.ts', import.meta.url), 'utf8'),
    readFile(new URL('../api/consultor-kyrub.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/tabs/PerfilTab.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../server.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(appSource, /<KyrubAiNoteActionBridge \/>/);
  assert.match(clientSource, /emitKyrubAiActionProposal/);
  assert.match(sharedSource, /type: 'create_note'/);
  assert.match(sharedSource, /requiresConfirmation: true/);
  assert.match(routeSource, /name: 'create_note'/);
  assert.match(routeSource, /functionDeclarations/);
  assert.match(routeSource, /enabledActions: \['create_note'\]/);
  assert.doesNotMatch(routeSource, /firebase\/firestore/);

  assert.match(bridgeSource, /normalizeLabel\(.*\) === 'NOTAS'/s);
  assert.match(bridgeSource, /Título da nota/);
  assert.match(bridgeSource, /Conteúdo descritivo/);
  assert.match(bridgeSource, /Checklist \(separe os itens por vírgula\)/);
  assert.match(bridgeSource, /requestSubmit\(\)/);
  assert.match(bridgeSource, /Nada será salvo antes da confirmação/);
  assert.doesNotMatch(bridgeSource, /firebase\/firestore/);

  assert.match(manualNotesSource, /onSubmit=\{handleCreateNote\}/);
  assert.match(manualNotesSource, /placeholder="Título da nota"/);
  assert.match(serverSource, /"\/api\/consultor-kyrub"/);
  assert.match(serverSource, /handleKyrubAiConsultant/);
});
