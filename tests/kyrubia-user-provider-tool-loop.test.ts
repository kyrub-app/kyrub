import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const loop = readFileSync('server/ai/kyrubiaUserProviderToolLoop.ts', 'utf8');
const runtime = readFileSync('server/ai/kyrubiaUserProviderRuntime.ts', 'utf8');
const mercadoLivrePrepare = readFileSync(
  'server/ai/kyrubiaMercadoLivrePrepareTool.ts',
  'utf8'
);
const systemInstruction = readFileSync(
  'server/ai/kyrubiaSystemInstruction.ts',
  'utf8'
);

test('BYO-AI loop consumes the shared Kyrubia tool authority instead of duplicating ERP semantics', () => {
  assert.match(loop, /executeKyrubiaSharedReadTool/);
  assert.match(loop, /isKyrubiaErpReadTool/);
  assert.match(loop, /KYRUBIA_ALL_TOOLS/);
  assert.match(loop, /KYRUBIA_MUTATION_TOOL/);
  assert.doesNotMatch(loop, /createKyrubiaProductQuery|executeKyrubiaProductQuery/);
});

test('ERP tool results are returned to the same user provider as normalized tool_result turns', () => {
  assert.match(loop, /type: 'tool_result'/);
  assert.match(loop, /turnsWithReadResult/);
  assert.match(loop, /turns,/);
  assert.match(runtime, /input\.turns \?\? messagesToKyrubiaProviderTurns/);
});

test('create_note remains proposal-only and never executes persistence in the provider loop', () => {
  assert.match(loop, /kyrubiaCreateNoteProposalFromCall/);
  assert.match(loop, /actionProposal/);
  assert.doesNotMatch(loop, /setDoc|addDoc|updateDoc|deleteDoc|firebase\/firestore/);
});

test('Mercado Livre preparation is exposed only after ERP read and binds to a product returned by query_products', () => {
  assert.match(loop, /prepare_mercado_livre_publication/);
  assert.match(loop, /tools: declarations\(KYRUBIA_ALL_TOOLS\)/);
  assert.match(loop, /tools: postReadDeclarations\(\)/);
  assert.match(loop, /readCall\.name !== KYRUBIA_QUERY_PRODUCTS_TOOL_NAME/);
  assert.match(loop, /productIdsFromReadResult\(readResult\)/);
  assert.match(loop, /!observedProductIds\.has\(requestedProductId\)/);
  assert.match(loop, /requestedProductId\.includes\('\/'\)/);
});

test('Mercado Livre preparation creates an internal proposal without provider publication or authorization', () => {
  assert.match(mercadoLivrePrepare, /proposeMercadoLivreExternalPublication/);
  assert.match(mercadoLivrePrepare, /externalWritePerformed: false/);
  assert.match(mercadoLivrePrepare, /authorizationCreated: false/);
  assert.doesNotMatch(mercadoLivrePrepare, /executeMercadoLivreExternalPublication/);
  assert.doesNotMatch(mercadoLivrePrepare, /authorizeMercadoLivre/);
  assert.doesNotMatch(mercadoLivrePrepare, /mercadoLivrePostJson/);
});

test('Mercado Livre preparation response is authoritative Kyrub text, never an unverified provider claim', () => {
  assert.match(loop, /reply: mercadoLivrePrepareReply\(prepared\)/);
  assert.match(loop, /Nenhuma publicação foi enviada ao Mercado Livre/);
  assert.match(loop, /nenhuma autorização de publicação foi criada/i);
});

test('Kyrubia instruction requires catalog resolution before Mercado Livre preparation and forbids publication claims', () => {
  assert.match(systemInstruction, /primeiro consulte query_products/);
  assert.match(systemInstruction, /Nunca invente productId/);
  assert.match(systemInstruction, /Só use prepare_mercado_livre_publication depois que query_products retornar/);
  assert.match(systemInstruction, /NÃO publica no Mercado Livre/);
  assert.match(systemInstruction, /autorização explícita do proprietário/);
});

test('unknown provider tools fail closed rather than executing or falling back silently', () => {
  assert.match(loop, /AI_PROVIDER_UNSUPPORTED_TOOL/);
  assert.match(loop, /combinação de ferramentas que o Kyrub não permite executar/);
  assert.doesNotMatch(loop, /GEMINI_API_KEY|kyrubia_credits|platform_legacy/);
});

test('the tool loop allows at most one ERP read follow-up before returning a response', () => {
  const calls = loop.match(/runKyrubiaUserProviderText\(/g) ?? [];
  assert.equal(calls.length, 2);
  assert.match(loop, /calls: 1/);
  assert.match(loop, /calls: 2/);
});
