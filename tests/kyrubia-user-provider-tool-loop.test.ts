import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  resolveKyrubiaOfferedIntentSelection,
  selectKyrubiaOfferedIntentContext,
  type KyrubiaTurnContext,
} from '../shared/kyrubiaContext';

const loop = readFileSync('server/ai/kyrubiaUserProviderToolLoop.ts', 'utf8');
const runtime = readFileSync('server/ai/kyrubiaUserProviderRuntime.ts', 'utf8');
const chatService = readFileSync('server/ai/kyrubiaUserProviderChatService.ts', 'utf8');
const mercadoLivrePrepare = readFileSync(
  'server/ai/kyrubiaMercadoLivrePrepareTool.ts',
  'utf8'
);
const mercadoLivreRequirements = readFileSync(
  'server/integrations/mercadoLivreOutboundRequirementsService.ts',
  'utf8'
);
const systemInstruction = readFileSync(
  'server/ai/kyrubiaSystemInstruction.ts',
  'utf8'
);

const mercadoLivreCategoryContext = (): KyrubiaTurnContext => ({
  version: 1,
  id: 'turn-ml-1',
  source: 'kyrub_runtime',
  sourceAction: 'mercado_livre_publication_preparation',
  generatedAt: '2026-09-04T23:40:00.000Z',
  scope: { kind: 'own_store', storeId: 'owner-1' },
  entities: [{
    entityType: 'product',
    entityId: 'product-1',
    label: 'Violão usado',
    position: 1,
  }],
  offeredIntents: [
    ['intent-1', 'MLB123', 'Violões'],
    ['intent-2', 'MLB456', 'Instrumentos de cordas'],
    ['intent-3', 'MLB789', 'Outros instrumentos'],
  ].map(([id, categoryId, categoryName], index) => ({
    id,
    intent: 'mercado_livre.category_select' as const,
    label: categoryName,
    payload: {
      proposalId: 'proposal-1',
      categoryId,
      categoryName,
      providerAuthority: 'provider_api_refetch' as const,
    },
    authorization: 'intent_only' as const,
    primary: index === 0,
  })),
});

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

test('prepared Mercado Livre draft inspects official provider category suggestions without selecting one', () => {
  assert.match(mercadoLivrePrepare, /inspectMercadoLivreOutboundRequirements/);
  assert.match(mercadoLivrePrepare, /requirementInspection/);
  assert.match(mercadoLivrePrepare, /authority: inspection\.authority/);
  assert.match(mercadoLivreRequirements, /authority: 'provider_api_refetch'/);
  assert.match(mercadoLivreRequirements, /domain_discovery\/search\?limit=3/);
  assert.match(mercadoLivreRequirements, /mercadoLivreGetJson/);
  assert.doesNotMatch(mercadoLivrePrepare, /configureMercadoLivreOutboundRequirements/);
  assert.doesNotMatch(mercadoLivrePrepare, /categoryId:\s*inspection\.categorySuggestions\[0\]/);
  assert.doesNotMatch(mercadoLivrePrepare, /mercadoLivrePostJson|mercadoLivrePutJson/);
});

test('Mercado Livre preparation returns up to three exact category chips bound to proposal and provider evidence', () => {
  assert.match(loop, /sourceAction: 'mercado_livre_publication_preparation'/);
  assert.match(loop, /intent: 'mercado_livre\.category_select'/);
  assert.match(loop, /proposalId: input\.result\.proposalId/);
  assert.match(loop, /categoryId: suggestion\.categoryId/);
  assert.match(loop, /providerAuthority: input\.result\.requirementInspection\.authority/);
  assert.match(loop, /authorization: 'intent_only'/);
  assert.match(loop, /categorySuggestions\.slice\(0, 3\)/);
});

test('structured category chip id resolves only against the current offered intents', () => {
  const context = mercadoLivreCategoryContext();
  const selected = resolveKyrubiaOfferedIntentSelection({
    selectedOfferedIntentId: 'intent-2',
    message: 'Instrumentos de cordas',
    context,
  });
  assert.equal(selected?.resolution, 'structured_id');
  assert.equal(selected?.offeredIntent.id, 'intent-2');
  assert.equal(selected?.authorization, 'intent_only');

  assert.equal(resolveKyrubiaOfferedIntentSelection({
    selectedOfferedIntentId: 'forged-intent',
    message: 'a primeira',
    context,
  }), null);
});

test('ordinal category replies resolve first, second and third but reject out-of-range or ambiguous text', () => {
  const context = mercadoLivreCategoryContext();
  assert.equal(resolveKyrubiaOfferedIntentSelection({ message: 'a primeira', context })?.offeredIntent.id, 'intent-1');
  assert.equal(resolveKyrubiaOfferedIntentSelection({ message: 'opção 2', context })?.offeredIntent.id, 'intent-2');
  assert.equal(resolveKyrubiaOfferedIntentSelection({ message: '3', context })?.offeredIntent.id, 'intent-3');
  assert.equal(resolveKyrubiaOfferedIntentSelection({ message: 'opção 4', context }), null);
  assert.equal(resolveKyrubiaOfferedIntentSelection({ message: 'acho que aquela', context }), null);
});

test('selected category becomes selectedIntent without gaining mutation authority', () => {
  const context = mercadoLivreCategoryContext();
  const selection = resolveKyrubiaOfferedIntentSelection({ message: 'segunda', context });
  assert.ok(selection);
  const selectedContext = selectKyrubiaOfferedIntentContext(context, selection);
  assert.equal(selectedContext.offeredIntents, undefined);
  assert.equal(selectedContext.selectedIntent?.id, 'intent-2');
  assert.equal(selectedContext.selectedIntent?.authorization, 'intent_only');
  if (selectedContext.selectedIntent?.intent === 'mercado_livre.category_select') {
    assert.equal(selectedContext.selectedIntent.payload.proposalId, 'proposal-1');
    assert.equal(selectedContext.selectedIntent.payload.categoryId, 'MLB456');
    assert.equal(selectedContext.selectedIntent.payload.providerAuthority, 'provider_api_refetch');
  } else {
    assert.fail('expected Mercado Livre category selected intent');
  }
});

test('category selection is deterministic Kyrub context and performs no requirement configuration or provider write', () => {
  assert.match(chatService, /resolveKyrubiaOfferedIntentSelection/);
  assert.match(chatService, /selectKyrubiaOfferedIntentContext/);
  assert.match(chatService, /status: 'deterministic'/);
  assert.match(chatService, /provider: 'kyrub'/);
  assert.match(chatService, /funding: 'none'/);
  assert.match(chatService, /Nenhum requisito foi configurado e nada foi publicado/);
  assert.doesNotMatch(chatService, /configureMercadoLivreOutboundRequirements/);
  assert.doesNotMatch(chatService, /mercadoLivrePostJson|mercadoLivrePutJson/);
});

test('Mercado Livre preparation response is authoritative Kyrub text and asks the owner to choose a provider category', () => {
  assert.match(loop, /reply: mercadoLivrePrepareReply\(prepared\)/);
  assert.match(loop, /categorySuggestions/);
  assert.match(loop, /Escolha a categoria correta antes de continuarmos/);
  assert.match(loop, /condição, tipo de anúncio e atributos obrigatórios/);
  assert.match(loop, /Nenhuma publicação foi enviada ao Mercado Livre/);
  assert.match(loop, /nenhuma autorização de publicação foi criada/i);
  assert.doesNotMatch(loop, /selectedCategoryId\s*=\s*inspection\.categorySuggestions\[0\]/);
});

test('Kyrubia instruction requires catalog resolution and explicit owner category choice before later Mercado Livre requirements', () => {
  assert.match(systemInstruction, /primeiro consulte query_products/);
  assert.match(systemInstruction, /Nunca invente productId/);
  assert.match(systemInstruction, /Só use prepare_mercado_livre_publication depois que query_products retornar/);
  assert.match(systemInstruction, /não escolha uma categoria em nome do usuário/i);
  assert.match(systemInstruction, /Mesmo se vier apenas uma sugestão, peça confirmação/);
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
