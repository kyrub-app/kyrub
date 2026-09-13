import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  KYRUBIA_PRODUCT_PREPARATION_READY_CHANNELS,
  buildKyrubiaProductChannelOffer,
  resolveKyrubiaProductChannelSelection,
} from '../src/ai/productChannelPreparation';

test('product preparation rollout only offers channels with a real preparation adapter', () => {
  assert.deepEqual(KYRUBIA_PRODUCT_PREPARATION_READY_CHANNELS, ['mercado_livre']);
  const source = readFileSync(
    new URL('../src/ai/productChannelPreparation.ts', import.meta.url),
    'utf8'
  );
  assert.match(source, /connection\.status === 'connected'/);
  assert.match(source, /PRODUCT_PREPARATION_READY_SET\.has\(channel\)/);
  assert.match(source, /loadStoreConnectionOnboarding/);
});

test('channel choice accepts the connected provider, all, or Kyrub-only without inventing another channel', () => {
  const available = ['mercado_livre'] as const;
  assert.deepEqual(
    resolveKyrubiaProductChannelSelection('Mercado Livre', [...available]),
    { kind: 'selected', channels: ['mercado_livre'] }
  );
  assert.deepEqual(
    resolveKyrubiaProductChannelSelection('sim', [...available]),
    { kind: 'selected', channels: ['mercado_livre'] }
  );
  assert.deepEqual(
    resolveKyrubiaProductChannelSelection('somente Kyrub', [...available]),
    { kind: 'kyrub_only', channels: [] }
  );
  assert.deepEqual(
    resolveKyrubiaProductChannelSelection('Shopee', [...available]),
    { kind: 'unresolved', channels: [] }
  );
});

test('proactive offer preserves one canonical Kyrub product and separate provider requirements', () => {
  const reply = buildKyrubiaProductChannelOffer('Squeeze Dobrável', ['mercado_livre']);
  assert.match(reply, /conectada ao Mercado Livre/i);
  assert.match(reply, /produto continuará canônico no Kyrub/i);
  assert.match(reply, /categoria e requisitos próprios/i);
  assert.match(reply, /não publica nada externamente/i);
});

test('operational workflow stores channel selection before resuming canonical field collection', () => {
  const runtime = readFileSync(
    new URL('../src/ai/operationalWorkflowRuntime.ts', import.meta.url),
    'utf8'
  );
  const store = readFileSync(
    new URL('../src/ai/operationalWorkflowStore.ts', import.meta.url),
    'utf8'
  );
  assert.match(store, /'selecting_product_channels'/);
  assert.match(store, /availableProductChannels/);
  assert.match(store, /selectedProductChannels/);
  assert.match(store, /productChannelResumeStage/);
  assert.match(runtime, /loadConnectedKyrubiaProductPreparationChannels/);
  assert.match(runtime, /buildKyrubiaProductChannelOffer/);
  assert.match(runtime, /categoria interna da sua loja no Kyrub/i);
  assert.match(runtime, /Nenhuma publicação externa será feita sem autorização/i);
});

test('confirmed canonical product can continue automatically into the selected Mercado Livre preparation flow', () => {
  const actionClient = readFileSync(
    new URL('../src/actions/kyrubActionService.ts', import.meta.url),
    'utf8'
  );
  const workspace = readFileSync(
    new URL('../src/components/KyrubAiWorkspaceBridge.tsx', import.meta.url),
    'utf8'
  );
  assert.match(actionClient, /selectedProductChannels\?\.includes\('mercado_livre'\)/);
  assert.match(actionClient, /dispatchKyrubiaOperationalWorkflowMessage/);
  assert.match(actionClient, /Prepare “\$\{productName\}” para vender no Mercado Livre\./);
  assert.match(workspace, /KYRUBIA_OPERATIONAL_WORKFLOW_MESSAGE_EVENT/);
  assert.match(workspace, /submitContent\(detail\.message\)/);
});
