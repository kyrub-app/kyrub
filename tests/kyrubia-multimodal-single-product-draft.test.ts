import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import type { KyrubAiConversationMessage } from '../shared/aiConsultant';
import { resolveKyrubiaSingleProductMultimodalDraft } from '../server/ai/kyrubiaSingleProductMultimodalDraft';

const attachment = (id: string) => ({
  id,
  name: `${id}.png`,
  mimeType: 'image/png',
  size: 1_024,
  storagePath: `kyrubia-attachments/owner/conversation/${id}`,
}) as NonNullable<KyrubAiConversationMessage['attachments']>[number];

const anchor = (): KyrubAiConversationMessage => ({
  role: 'user',
  content:
    'Kyrubia, estas 3 imagens são referências visuais do MESMO produto, não são 3 produtos diferentes. ' +
    'Quero criar um único produto chamado Chaveiro Kyrub na minha Loja Kyrub e depois prepará-lo para vender também no Mercado Livre.',
  attachments: [attachment('img-1'), attachment('img-2'), attachment('img-3')],
});

test('three references of one product route to product collection instead of create_note', () => {
  const result = resolveKyrubiaSingleProductMultimodalDraft([anchor()]);
  assert.ok(result);
  assert.equal(result.provider, 'kyrub');
  assert.equal(result.mode, 'deterministic');
  assert.equal(result.actionProposal, undefined);
  assert.deepEqual(result.capabilities.enabledActions, ['create_product']);
  assert.match(result.reply, /3 anexos são referências visuais/i);
  assert.match(result.reply, /preço de “Chaveiro Kyrub”/i);
  assert.doesNotMatch(result.reply, /create_note|nota privada/i);
});

test('multimodal product collector gathers price category and stock one field at a time', () => {
  const afterPrice: KyrubAiConversationMessage[] = [
    anchor(),
    { role: 'assistant', content: 'Qual será o preço de “Chaveiro Kyrub”?', attachments: [] },
    { role: 'user', content: 'R$ 29,90', attachments: [] },
  ];
  const category = resolveKyrubiaSingleProductMultimodalDraft(afterPrice);
  assert.ok(category);
  assert.match(category.reply, /categoria.*Chaveiro Kyrub/i);
  assert.equal(category.actionProposal, undefined);

  const afterCategory: KyrubAiConversationMessage[] = [
    ...afterPrice,
    { role: 'assistant', content: category.reply, attachments: [] },
    { role: 'user', content: 'Acessórios', attachments: [] },
  ];
  const stock = resolveKyrubiaSingleProductMultimodalDraft(afterCategory);
  assert.ok(stock);
  assert.match(stock.reply, /quantas unidades.*Chaveiro Kyrub/i);
  assert.equal(stock.actionProposal, undefined);

  const complete: KyrubAiConversationMessage[] = [
    ...afterCategory,
    { role: 'assistant', content: stock.reply, attachments: [] },
    { role: 'user', content: '10', attachments: [] },
  ];
  const review = resolveKyrubiaSingleProductMultimodalDraft(complete);
  assert.ok(review);
  assert.equal(review.actionProposal?.type, 'create_product');
  if (review.actionProposal?.type !== 'create_product') assert.fail('Expected create_product.');
  assert.equal(review.actionProposal.name, 'Chaveiro Kyrub');
  assert.equal(review.actionProposal.price, 29.9);
  assert.equal(review.actionProposal.category, 'Acessórios');
  assert.equal(review.actionProposal.stock, 10);
  assert.equal(review.actionProposal.image, '');
  assert.equal(review.actionProposal.requiresConfirmation, true);
  assert.match(review.reply, /nada será publicado no Mercado Livre/i);
});

test('explicit follow-up can bind the original three images to the already-created product', () => {
  const messages: KyrubAiConversationMessage[] = [
    anchor(),
    { role: 'assistant', content: 'Produto criado com sucesso.', attachments: [] },
    {
      role: 'user',
      content: 'Kyrubia, use as três imagens que enviei nesta conversa como imagens do produto Chaveiro Kyrub.',
      attachments: [],
    },
  ];

  const result = resolveKyrubiaSingleProductMultimodalDraft(messages);
  assert.ok(result);
  assert.equal(result.actionProposal?.type, 'update_product');
  assert.deepEqual(result.capabilities.enabledActions, ['update_product']);
  assert.match(result.reply, /3 imagens/i);
  assert.match(result.reply, /primeira será a imagem principal/i);
  assert.match(result.reply, /Nenhuma publicação no Mercado Livre/i);

  const proposal = result.actionProposal as Record<string, unknown>;
  assert.equal(proposal.productId, '__kyrubia_resolve_product_by_name__');
  assert.equal(proposal.expectedCurrentName, 'Chaveiro Kyrub');
  assert.deepEqual(proposal.sourceAttachmentPaths, [
    'kyrubia-attachments/owner/conversation/img-1',
    'kyrubia-attachments/owner/conversation/img-2',
    'kyrubia-attachments/owner/conversation/img-3',
  ]);
});

test('initial visual-reference request never silently publishes attachments as product media', () => {
  const result = resolveKyrubiaSingleProductMultimodalDraft([anchor()]);
  assert.ok(result);
  assert.equal(result.actionProposal, undefined);
  assert.doesNotMatch(result.reply, /promover essas imagens/i);
});

test('collector releases the conversation after its own collection prompts so Mercado Livre can continue', () => {
  const messages: KyrubAiConversationMessage[] = [
    anchor(),
    { role: 'assistant', content: 'Qual será o preço de “Chaveiro Kyrub”?', attachments: [] },
    { role: 'user', content: 'R$ 29,90', attachments: [] },
    { role: 'assistant', content: 'Em qual categoria da sua Loja Kyrub “Chaveiro Kyrub” deve ficar?', attachments: [] },
    { role: 'user', content: 'Acessórios', attachments: [] },
    { role: 'assistant', content: 'Quantas unidades de “Chaveiro Kyrub” estão disponíveis agora?', attachments: [] },
    { role: 'user', content: '10', attachments: [] },
    { role: 'assistant', content: 'Produto criado com sucesso.', attachments: [] },
    { role: 'user', content: 'Agora prepare esse produto para vender no Mercado Livre.', attachments: [] },
  ];

  assert.equal(resolveKyrubiaSingleProductMultimodalDraft(messages), null);
});

test('genuine bulk catalog request stays outside the single-product collector', () => {
  const messages: KyrubAiConversationMessage[] = [{
    role: 'user',
    content: 'Cadastre os produtos desta imagem na minha loja.',
    attachments: [attachment('catalog')],
  }];
  assert.equal(resolveKyrubiaSingleProductMultimodalDraft(messages), null);
});

test('consultor routes bulk catalog then single-product collector then Mercado Livre bridge then guarded generic fallback', () => {
  const router = readFileSync(new URL('../api/consultor-kyrub.ts', import.meta.url), 'utf8');
  const bulk = router.indexOf('if (!analysisContext && importRequested && hasAttachmentHistory(messages))');
  const single = router.indexOf('resolveKyrubiaSingleProductMultimodalDraft(messages)');
  const mercadoLivre = router.lastIndexOf('await handleMercadoLivrePlatformConversation');
  const generic = router.lastIndexOf('await runGenericWithCapabilityGuard');
  assert.ok(bulk >= 0);
  assert.ok(single > bulk);
  assert.ok(mercadoLivre > single);
  assert.ok(generic > mercadoLivre);
  assert.match(router, /prepareKyrubiaMercadoLivrePlatformConversation/);
  assert.match(router, /shouldRouteKyrubiaMercadoLivrePlatformContinuation/);
  assert.match(router, /executeAuthorizedKyrubiaUserProviderChat/);
  assert.match(router, /Blocked action outside classified intent/);
  assert.match(router, /INTENT_ACTION_MISMATCH/);
});

test('normal Chaveiro preparation command is recognized by the deterministic Mercado Livre bridge without provider write authority', () => {
  const bridge = readFileSync(
    new URL('../server/ai/kyrubiaMercadoLivrePlatformConversation.ts', import.meta.url),
    'utf8'
  );
  const prepareTool = readFileSync(
    new URL('../server/ai/kyrubiaMercadoLivrePrepareTool.ts', import.meta.url),
    'utf8'
  );
  const providerChat = readFileSync(
    new URL('../server/ai/kyrubiaUserProviderChatService.ts', import.meta.url),
    'utf8'
  );

  assert.match(bridge, /(?:prepare|preparar)/);
  assert.match(bridge, /mercado\s\+livre/);
  assert.match(bridge, /prepareKyrubiaMercadoLivrePublication/);
  assert.match(bridge, /authorization: 'intent_only'/);
  assert.match(bridge, /Nenhuma publicação foi enviada ao Mercado Livre/);
  assert.doesNotMatch(bridge, /mercadoLivrePostJson|mercadoLivrePutJson/);
  assert.match(prepareTool, /externalWritePerformed:\s*false/);
  assert.match(prepareTool, /authorizationCreated:\s*false/);
  assert.match(providerChat, /Configurar draft/);
  assert.match(providerChat, /Validar draft/);
  assert.match(providerChat, /Autorizar publicação/);
  assert.match(providerChat, /Publicar agora/);
});

test('confirmed product media remains server-authoritative and private attachments are never reused directly', () => {
  const execution = readFileSync(
    new URL('../server/actions/productUpdateExecutionService.ts', import.meta.url),
    'utf8'
  );
  const promotion = readFileSync(
    new URL('../server/actions/productAttachmentPromotionService.ts', import.meta.url),
    'utf8'
  );

  assert.match(execution, /sourceAttachmentPaths:\s*proposal\.sourceAttachmentPaths \?\? \[\]/);
  assert.match(execution, /proposalHash/);
  assert.match(execution, /promoteKyrubiaProductAttachments/);
  assert.match(execution, /images:\s*promoted\.urls/);
  assert.match(execution, /cleanupNewProductAttachments/);
  assert.match(promotion, /kyrubia-attachments\/\$\{input\.actorUid\}\//);
  assert.match(promotion, /app-images\/\$\{input\.actorUid\}\//);
  assert.match(promotion, /image\/jpeg/);
  assert.match(promotion, /image\/png/);
  assert.match(promotion, /image\/webp/);
  assert.match(promotion, /firebaseStorageDownloadTokens/);
  assert.doesNotMatch(promotion, /makePublic\(/);
});

test('create_product stays on the existing action endpoint and uses a fast path before broad bootstrap', () => {
  const client = readFileSync(new URL('../src/actions/kyrubActionService.ts', import.meta.url), 'utf8');
  const endpoint = readFileSync(new URL('../api/action-execute.ts', import.meta.url), 'utf8');
  assert.match(client, /SAFE_ACTION_ENDPOINT = '\/api\/action-execute'/);
  assert.doesNotMatch(client, /action-execute-product/);

  const fastPath = endpoint.indexOf("if (rawProposal?.type === 'create_product')");
  const broadBootstrap = endpoint.indexOf('const [\n      actionFacade,');
  assert.ok(fastPath >= 0);
  assert.ok(broadBootstrap > fastPath);
  assert.match(endpoint.slice(fastPath, broadBootstrap), /mapKyrubActionExecutionError/);
  assert.match(endpoint.slice(fastPath, broadBootstrap), /reconcileStoreEntitlementFromAuthorization/);
  assert.match(endpoint.slice(fastPath, broadBootstrap), /hydrateExecutablePlanCatalog/);
  assert.match(endpoint.slice(fastPath, broadBootstrap), /executeAuthorizedKyrubAction/);
});

test('product media promotion does not spend an extra Vercel serverless function', () => {
  const dedicatedEndpoint = new URL('../api/action-execute-product.ts', import.meta.url);
  assert.equal(existsSync(dedicatedEndpoint), false);
  const mediaEndpoint = new URL('../api/product-media.ts', import.meta.url);
  assert.equal(existsSync(mediaEndpoint), false);
});
