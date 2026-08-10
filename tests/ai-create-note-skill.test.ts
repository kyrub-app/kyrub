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
  assert.ok(payload.capabilities.enabledActions.includes('create_note'));
  assert.equal(requests.length, 2);
});

test('confirmed create-note crosses the authenticated safe executor instead of DOM or client Firestore automation', async () => {
  const [
    appSource,
    bridgeSource,
    clientSource,
    sharedSource,
    actionProtocolSource,
    actionServiceSource,
    actionExecutionServiceSource,
    policyEngineSource,
    actionExecutionRouteSource,
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
    readFile(new URL('../shared/kyrubActions.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/actions/kyrubActionService.ts', import.meta.url), 'utf8'),
    readFile(
      new URL('../server/actions/actionExecutionService.ts', import.meta.url),
      'utf8'
    ),
    readFile(
      new URL('../server/actions/kyrubiaPolicyEngine.ts', import.meta.url),
      'utf8'
    ),
    readFile(new URL('../api/action-execute.ts', import.meta.url), 'utf8'),
    readFile(new URL('../api/consultor-kyrub.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/tabs/PerfilTab.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../server.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(appSource, /<KyrubAiNoteActionBridge \/>/);
  assert.match(clientSource, /emitKyrubAiActionProposal/);
  assert.match(sharedSource, /from '\.\/kyrubActions'/);
  assert.match(actionProtocolSource, /CREATE_NOTE: 'create_note'/);
  assert.match(actionProtocolSource, /CREATE_PRODUCT: 'create_product'/);
  assert.match(actionProtocolSource, /UPDATE_PRODUCT_DRAFT: 'update_product_draft'/);
  assert.match(actionProtocolSource, /ANALYZE_CATALOG: 'analyze_catalog'/);
  assert.match(actionProtocolSource, /IMPORT_CATALOG_DRAFT: 'import_catalog_draft'/);
  assert.match(actionProtocolSource, /KyrubActionOrigin/);
  assert.match(actionProtocolSource, /KyrubInputProvenance/);
  assert.match(actionProtocolSource, /KyrubExecutionEnvelope/);
  assert.match(actionProtocolSource, /idempotencyKey/);

  assert.match(routeSource, /name: 'create_note'/);
  assert.match(routeSource, /functionDeclarations/);
  assert.doesNotMatch(routeSource, /firebase\/firestore/);

  assert.match(bridgeSource, /executeKyrubAction\(user, pending\.proposal, true\)/);
  assert.match(bridgeSource, /auth\.currentUser/);
  assert.match(bridgeSource, /Nada será salvo antes da confirmação/);
  assert.match(bridgeSource, /Nenhuma nota duplicada foi criada/);
  assert.doesNotMatch(bridgeSource, /querySelector/);
  assert.doesNotMatch(bridgeSource, /requestSubmit/);
  assert.doesNotMatch(bridgeSource, /Título da nota/);

  assert.match(actionServiceSource, /\/api\/action-execute/);
  assert.match(actionServiceSource, /user\.getIdToken\(true\)/);
  assert.match(actionServiceSource, /JSON\.stringify\(\{ confirmed, proposal \}\)/);
  assert.match(actionServiceSource, /HTTP \$\{response\.status\}/);
  assert.match(actionServiceSource, /endpoint do executor seguro não foi encontrado/);
  assert.doesNotMatch(actionServiceSource, /firebase\/firestore/);
  assert.doesNotMatch(actionServiceSource, /runTransaction/);
  assert.doesNotMatch(actionServiceSource, /transaction\.set/);

  assert.match(actionExecutionServiceSource, /verifyFirebaseIdToken\(token\)/);
  assert.doesNotMatch(actionExecutionServiceSource, /adminAuth\.verifyIdToken/);
  assert.doesNotMatch(actionExecutionServiceSource, /firebase-admin\/auth/);
  assert.match(actionExecutionServiceSource, /evaluateKyrubActionPolicy/);
  assert.match(actionExecutionServiceSource, /adminDb\.runTransaction/);
  assert.match(actionExecutionServiceSource, /users\/\$\{actor\.uid\}\/tasks/);
  assert.match(actionExecutionServiceSource, /kyrub_action_receipts/);
  assert.match(actionExecutionServiceSource, /actionProposalHash/);
  assert.match(actionExecutionServiceSource, /IDEMPOTENCY_CONFLICT/);
  assert.match(actionExecutionServiceSource, /already_applied/);
  assert.match(policyEngineSource, /UNTRUSTED_INPUT_REQUIRES_CONFIRMATION/);
  assert.match(policyEngineSource, /BLAST_RADIUS_EXCEEDED/);
  assert.match(
    actionExecutionRouteSource,
    /from '\.\.\/server\/actions\/actionExecutionService\.js'/
  );
  assert.doesNotMatch(actionExecutionRouteSource, /await import\(/);
  assert.doesNotMatch(actionExecutionRouteSource, /EXECUTOR_BOOT_FAILED/);

  assert.match(manualNotesSource, /onSubmit=\{handleCreateNote\}/);
  assert.match(manualNotesSource, /placeholder="Título da nota"/);
  assert.match(serverSource, /"\/api\/consultor-kyrub"/);
  assert.match(serverSource, /handleKyrubAiConsultant/);
  assert.match(serverSource, /"\/api\/actions"/);
  assert.match(serverSource, /createKyrubActionExecutionRouter/);
});
