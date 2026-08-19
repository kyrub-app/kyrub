import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseKyrubProductPublicationIntent } from '../shared/kyrubProductPublicationIntent';
import { isKyrubAiActionProposal } from '../src/ai/actionEvents';

test('explicit catalog publication and unpublication intents are deterministic', () => {
  assert.deepEqual(
    parseKyrubProductPublicationIntent('Publique o produto "X-Burger"'),
    { productName: 'X-Burger', published: true }
  );
  assert.deepEqual(
    parseKyrubProductPublicationIntent('Retire da vitrine o produto "X-Burger"'),
    { productName: 'X-Burger', published: false }
  );
});

test('browser gate accepts state-changing publication proposals and rejects no-op state', () => {
  const base = {
    id: 'publish-xburger',
    type: 'set_product_publication',
    productId: 'xburger',
    productName: 'X-Burger',
    requiresConfirmation: true,
    origin: 'kyrubia',
    risk: 'medium',
    inputProvenance: 'user_intent',
    impact: { entityCount: 1, reversibility: 'easy' },
  } as const;

  assert.equal(
    isKyrubAiActionProposal({
      ...base,
      expectedCurrentStatus: 'draft',
      published: true,
    }),
    true
  );
  assert.equal(
    isKyrubAiActionProposal({
      ...base,
      expectedCurrentStatus: 'published',
      published: false,
    }),
    true
  );
  assert.equal(
    isKyrubAiActionProposal({
      ...base,
      expectedCurrentStatus: 'published',
      published: true,
    }),
    false
  );
});

test('publication action reuses canonical lifecycle, free-plan enforcement and authoritative sources', async () => {
  const [
    sharedSource,
    executionSource,
    lifecycleSource,
    facadeSource,
    runtimeSource,
    wrapperSource,
    bridgeSource,
  ] = await Promise.all([
    readFile(new URL('../shared/kyrubActions.ts', import.meta.url), 'utf8'),
    readFile(new URL('../server/actions/productPublicationExecutionService.ts', import.meta.url), 'utf8'),
    readFile(new URL('../server/actions/catalogProductLifecycleService.ts', import.meta.url), 'utf8'),
    readFile(new URL('../server/actions/actionExecutionFacade.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/ai/productPublicationRuntime.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/ai/consultantClientWithPlans.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/KyrubAiProductUpdateActionBridge.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(sharedSource, /SET_PRODUCT_PUBLICATION:\s*'set_product_publication'/);
  assert.match(sharedSource, /set_product_publication:\s*\{[\s\S]*requiresConfirmation:\s*true/);
  assert.match(sharedSource, /permission:\s*'products\.write'/);

  assert.match(executionSource, /PRODUCT_CHANGED/);
  assert.match(executionSource, /expectedCurrentStatus/);
  assert.match(executionSource, /permissions:\s*\['products\.write'\]/);
  assert.match(executionSource, /setAuthorizedKyrubCatalogProductPublication/);
  assert.match(executionSource, /kyrub_action_receipts/);

  assert.match(lifecycleSource, /FREE_PRODUCT_LIMIT\s*=\s*5/);
  assert.match(lifecycleSource, /PRODUCT_LIMIT_REACHED/);
  assert.match(lifecycleSource, /setAuthorizedKyrubCatalogProductPublication/);

  assert.match(facadeSource, /isKyrubProductPublicationExecutionRequest/);
  assert.match(runtimeSource, /listKyrubCatalogDrafts/);
  assert.match(runtimeSource, /readKyrubErpContext/);
  assert.match(runtimeSource, /expectedCurrentStatus:\s*published \? 'draft' : 'published'/);

  assert.match(wrapperSource, /isKyrubProductPublicationIntent/);
  assert.match(wrapperSource, /kyrub-product-publication-runtime-v1/);
  assert.match(wrapperSource, /'set_product_publication'/);
  assert.match(bridgeSource, /detail\.proposal\.type === 'set_product_publication'/);
  assert.match(bridgeSource, /limite do seu plano/);
});
