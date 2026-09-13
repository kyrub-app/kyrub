import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const runtimePath = new URL('../src/ai/operationalWorkflowRuntime.ts', import.meta.url);
const storePath = new URL('../src/ai/operationalWorkflowStore.ts', import.meta.url);
const attachmentPath = new URL('../src/ai/kyrubiaAttachmentService.ts', import.meta.url);
const multimodalPath = new URL('../src/ai/multimodalConsultantClient.ts', import.meta.url);

test('physical product workflow asks for a photo before exposing create_product confirmation', async () => {
  const [runtime, store] = await Promise.all([
    readFile(runtimePath, 'utf8'),
    readFile(storePath, 'utf8'),
  ]);
  assert.match(store, /'collecting_product_photo'/);
  assert.match(runtime, /productPhotoPrompt/);
  assert.match(runtime, /foto real do produto/i);
  assert.match(runtime, /stage: 'collecting_product_photo'/);
  assert.match(runtime, /actionProposal: undefined/);
  assert.match(runtime, /workflow\.productDraft\.isService !== true/);
  assert.match(runtime, /!workflow\.productDraft\.image\?\.trim\(\)/);
  assert.match(runtime, /wantsToSkipProductPhoto/);
});

test('a Mercado Livre category question is not persisted as the Kyrub internal category', async () => {
  const runtime = await readFile(runtimePath, 'utf8');
  assert.match(runtime, /asksForMercadoLivreCategorySuggestion/);
  assert.match(runtime, /workflow\.stage !== 'collecting_product_category'/);
  assert.match(runtime, /categoria interna da sua loja no Kyrub/i);
  assert.match(runtime, /categoria do Mercado Livre é separada/i);
  assert.match(runtime, /Não vou gravar sua pergunta como categoria/i);
  const categoryGuard = runtime.indexOf('resolveMercadoLivreCategoryDuringProductCreation(input)');
  const legacyRuntime = runtime.indexOf('const target = parseExplicitKyrubiaCreateTarget(input.message);');
  assert.ok(categoryGuard >= 0 && categoryGuard < legacyRuntime);
});

test('a Kairuba image attachment is promoted from private chat storage to stable canonical image storage', async () => {
  const source = await readFile(attachmentPath, 'utf8');
  assert.match(source, /getBytes/);
  assert.match(source, /kyrubia-attachments\/\$\{user\.uid\}\//);
  assert.match(source, /uploadCurrentUserImage/);
  assert.match(source, /isKyrubiaImageAttachment/);
  assert.match(source, /return uploaded\.url/);
});

test('multimodal routing keeps product-photo collection deterministic and does not hijack later Mercado Livre turns', async () => {
  const source = await readFile(multimodalPath, 'utf8');
  assert.match(source, /loadKyrubiaOperationalWorkflow/);
  assert.match(source, /resolveKyrubiaOperationalWorkflow/);
  assert.match(source, /attachments: latestUser\.attachments/);
  assert.match(source, /shouldUseDeterministicMercadoLivreRuntime/);
  assert.match(source, /return requestKyrubAiConsultant\(payload, signal\)/);
  assert.match(source, /mercado_livre_publication_preparation/);
});