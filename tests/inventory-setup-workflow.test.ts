import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildKyrubInventoryIntakeProposal,
  parseKyrubInventoryIntakeEntries,
} from '../shared/kyrubInventoryIntake';
import {
  isKyrubInventorySetupWorkflowIntent,
  readKyrubInventorySetupWorkflow,
} from '../shared/kyrubInventorySetupWorkflow';
import { isKyrubProductCompositionIntent } from '../shared/kyrubProductCompositionProposal';
import { classifyKyrubiaCapability } from '../shared/kyrubiaCapabilityRouter';

const compoundRequest =
  'Kyrubia, recebi 10 pães, 3 kg de carne bovina Premium, 400 g de queijo e 1 kg de batata. ' +
  'Dê entrada no estoque e separe metade da carne pra criação dos discos de hambúrguer. ' +
  'Cada hambúrguer é feito com 140 g dessa carne. ' +
  'Crie esse componente e monte a ficha técnica do X-Burger com 1 pão, 1 hambúrguer de 140 g, 40 g de queijo e 100 g de batata.';

test('natural intake parses comma-separated received goods including bare unit counts', () => {
  assert.deepEqual(parseKyrubInventoryIntakeEntries(compoundRequest), [
    { name: 'Pão', quantity: 10, unit: 'un' },
    { name: 'carne bovina Premium', quantity: 3, unit: 'kg' },
    { name: 'queijo', quantity: 400, unit: 'g' },
    { name: 'batata', quantity: 1, unit: 'kg' },
  ]);
});

test('compound request stays in inventory mutation routing instead of standalone composition', () => {
  assert.equal(isKyrubInventorySetupWorkflowIntent(compoundRequest), true);
  assert.equal(isKyrubProductCompositionIntent(compoundRequest), false);
  assert.deepEqual(classifyKyrubiaCapability(compoundRequest), {
    primary: 'adjust_inventory',
    mutation: 'inventory',
  });

  assert.equal(
    isKyrubProductCompositionIntent(
      'Crie a ficha técnica do X-Burger\n1 un Pão\n140 g Carne bovina Premium'
    ),
    true
  );
});

test('workflow preserves received-meat allocation and creates ten 140g intermediate burgers', () => {
  const proposal = buildKyrubInventoryIntakeProposal(compoundRequest, 'conversation-e2e');
  assert.ok(proposal);
  if (!proposal) return;

  const workflow = readKyrubInventorySetupWorkflow(proposal);
  assert.ok(workflow);
  if (!workflow) return;

  assert.equal(workflow.targetProductName, 'X-Burger');
  assert.equal(workflow.componentName, 'Hambúrguer 140 g');
  assert.deepEqual(workflow.transformation.inputs, [
    { name: 'carne bovina Premium', quantity: 1.4, unit: 'kg' },
  ]);
  assert.deepEqual(workflow.transformation.outputs, [
    { name: 'Hambúrguer 140 g', quantity: 10, unit: 'un', kind: 'intermediate' },
  ]);
  assert.deepEqual(workflow.transformation.losses, []);
  assert.deepEqual(workflow.preview, {
    receivedSourceQuantity: 3,
    receivedSourceUnit: 'kg',
    allocatedSourceQuantity: 1.5,
    consumedSourceQuantity: 1.4,
    allocatedRemainderQuantity: 0.1,
    producedComponentQuantity: 10,
    componentUnit: 'un',
  });
  assert.deepEqual(workflow.recipeLines, [
    { name: 'Pão', quantity: 1, unit: 'un' },
    { name: 'Hambúrguer 140 g', quantity: 1, unit: 'un' },
    { name: 'queijo', quantity: 40, unit: 'g' },
    { name: 'batata', quantity: 100, unit: 'g' },
  ]);
  assert.match(workflow.compositionMessage, /1 un Hambúrguer 140 g/);
  assert.match(workflow.compositionMessage, /40 g queijo/);
});

test('inventory bridge executes compound workflow through the three official action layers', () => {
  const bridge = readFileSync(
    new URL('../src/components/KyrubAiInventoryActionBridge.tsx', import.meta.url),
    'utf8'
  );
  assert.match(bridge, /readKyrubInventorySetupWorkflow/);
  assert.match(bridge, /executeKyrubAction\(user, current\.proposal, true\)/);
  assert.match(bridge, /executeInventoryTransformation/);
  assert.match(bridge, /readKyrubErpContext\(user, \{ force: true \}\)/);
  assert.match(bridge, /buildKyrubProductCompositionProposal/);
  assert.match(bridge, /Confirmar tudo/);
});
