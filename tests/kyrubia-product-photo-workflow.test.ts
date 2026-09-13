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
  assert.match(runtime, /actionProposal\.isService !== true/);
  assert.match(runtime, /wantsToSkipProductPhoto/);
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