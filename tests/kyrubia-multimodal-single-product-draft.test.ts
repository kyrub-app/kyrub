import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('consultor routes bulk catalog then single-product collector then guarded generic fallback', () => {
  const router = readFileSync(new URL('../api/consultor-kyrub.ts', import.meta.url), 'utf8');
  const bulk = router.indexOf('if (!analysisContext && importRequested && hasAttachmentHistory(messages))');
  const single = router.indexOf('resolveKyrubiaSingleProductMultimodalDraft(messages)');
  const generic = router.lastIndexOf('await runGenericWithCapabilityGuard');
  assert.ok(bulk >= 0);
  assert.ok(single > bulk);
  assert.ok(generic > single);
  assert.match(router, /Blocked action outside classified intent/);
  assert.match(router, /INTENT_ACTION_MISMATCH/);
});

test('create_product uses a dedicated endpoint instead of the broad generic action bootstrap', () => {
  const client = readFileSync(new URL('../src/actions/kyrubActionService.ts', import.meta.url), 'utf8');
  assert.match(client, /CREATE_PRODUCT_ACTION_ENDPOINT = '\/api\/action-execute-product'/);
  assert.match(client, /proposal\.type === 'create_product'[\s\S]*CREATE_PRODUCT_ACTION_ENDPOINT/);
});

test('dedicated create-product endpoint reuses canonical execution and preserves entitlement gates', () => {
  const endpoint = readFileSync(new URL('../api/action-execute-product.ts', import.meta.url), 'utf8');
  assert.match(endpoint, /proposal as Record<string, unknown>\)\.type === 'create_product'/);
  assert.match(endpoint, /actionService\.mapKyrubActionExecutionError/);
  assert.match(endpoint, /reconcileStoreEntitlementFromAuthorization/);
  assert.match(endpoint, /hydrateExecutablePlanCatalog/);
  assert.match(endpoint, /actionService\.executeAuthorizedKyrubAction/);
  assert.doesNotMatch(endpoint, /actionExecutionFacade/);
  assert.doesNotMatch(endpoint, /catalogProductLifecycleService/);
  assert.doesNotMatch(endpoint, /catalogImportExecutionService/);
});
