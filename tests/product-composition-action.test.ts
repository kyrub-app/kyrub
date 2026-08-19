import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  KYRUB_ACTION_REGISTRY,
  KYRUB_ACTION_TYPES,
  type KyrubAiSetProductCompositionProposal,
} from '../shared/kyrubActions';

test('product composition is an official confirmed inventory action', () => {
  assert.equal(KYRUB_ACTION_TYPES.SET_PRODUCT_COMPOSITION, 'set_product_composition');
  assert.deepEqual(KYRUB_ACTION_REGISTRY.set_product_composition, {
    type: 'set_product_composition',
    mode: 'write',
    risk: 'medium',
    requiresConfirmation: true,
    permission: 'inventory.composition.write',
    maxAffectedEntities: 40,
  });

  const proposal: KyrubAiSetProductCompositionProposal = {
    id: 'composition-1',
    type: 'set_product_composition',
    productId: 'product-1',
    productName: 'X-Burger',
    kind: 'recipe',
    yieldQuantity: 1,
    lines: [
      {
        inventoryItemId: 'inv-bread',
        inventoryItemName: 'Pão para hambúrguer',
        quantity: 1,
        unit: 'un',
      },
    ],
    requiresConfirmation: true,
  };

  assert.equal(proposal.lines[0]?.inventoryItemId, 'inv-bread');
});

test('composition executor validates authoritative product and inventory references', () => {
  const source = readFileSync(
    new URL('../server/actions/productCompositionExecutionService.ts', import.meta.url),
    'utf8'
  );

  assert.match(source, /PRODUCT_NOT_FOUND/);
  assert.match(source, /PRODUCT_CHANGED/);
  assert.match(source, /INVENTORY_ITEM_NOT_FOUND/);
  assert.match(source, /INVENTORY_ITEM_CHANGED/);
  assert.match(source, /SERVICE_COMPOSITION_NOT_ALLOWED/);
  assert.match(source, /uniqueIds\.size !== lines\.length/);
  assert.match(source, /compositions: nextCompositions/);
  assert.match(source, /calculateCompositionAvailableStock/);
  assert.match(source, /kyrub_action_receipts/);
});

test('action endpoint dispatches product composition before generic execution', () => {
  const source = readFileSync(
    new URL('../api/action-execute.ts', import.meta.url),
    'utf8'
  );

  assert.match(source, /isKyrubProductCompositionExecutionRequest/);
  assert.match(source, /executeAuthorizedKyrubProductComposition/);
});
