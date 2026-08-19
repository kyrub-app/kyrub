import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildKyrubInventoryIntakeProposal } from '../shared/kyrubInventoryIntake';
import {
  buildKyrubInventoryMovementProposal,
  classifyKyrubInventoryMovementIntent,
} from '../shared/kyrubInventoryMovements';

test('legacy stock intake remains an increment/intake proposal', () => {
  const proposal = buildKyrubInventoryIntakeProposal(
    'Entrada de estoque\n10 un - Pão para hambúrguer',
    'conversation-1'
  );

  assert.ok(proposal);
  assert.equal(proposal.mode, 'increment');
  assert.equal(proposal.entries[0]?.name, 'Pão para hambúrguer');
  assert.equal(proposal.entries[0]?.quantity, 10);
});

test('loss language becomes a decrement with loss provenance', () => {
  const intent = classifyKyrubInventoryMovementIntent(
    'Perdi 300 g de Carne bovina Premium porque estragou.'
  );
  const proposal = buildKyrubInventoryMovementProposal(
    'Perdi 300 g de Carne bovina Premium porque estragou.',
    'conversation-loss'
  );

  assert.deepEqual(intent, {
    mode: 'decrement',
    movementKind: 'loss',
    sourceKind: 'loss_report',
  });
  assert.ok(proposal);
  assert.equal(proposal.mode, 'decrement');
  assert.equal(proposal.movementKind, 'loss');
  assert.equal(proposal.entries[0]?.quantity, 300);
  assert.equal(proposal.entries[0]?.unit, 'g');
  assert.match(proposal.entries[0]?.name ?? '', /Carne bovina Premium/i);
});

test('explicit stock outflow becomes a decrement without masquerading as loss', () => {
  const proposal = buildKyrubInventoryMovementProposal(
    'Dê baixa em 2 un de Pão para hambúrguer',
    'conversation-outflow'
  );

  assert.ok(proposal);
  assert.equal(proposal.mode, 'decrement');
  assert.equal(proposal.movementKind, 'outflow');
  assert.equal(proposal.source.kind, 'manual_outflow');
  assert.equal(proposal.entries[0]?.quantity, 2);
});

test('physical count correction sets the authoritative target quantity', () => {
  const proposal = buildKyrubInventoryMovementProposal(
    'Contagem física\nPão para hambúrguer para 8 un',
    'conversation-count'
  );

  assert.ok(proposal);
  assert.equal(proposal.mode, 'set');
  assert.equal(proposal.movementKind, 'correction');
  assert.equal(proposal.source.kind, 'physical_count');
  assert.equal(proposal.entries[0]?.quantity, 8);
});

test('physical count may explicitly set an existing item to zero', () => {
  const proposal = buildKyrubInventoryMovementProposal(
    'Inventário físico\nQueijo para hambúrguer para 0 un',
    'conversation-zero'
  );

  assert.ok(proposal);
  assert.equal(proposal.mode, 'set');
  assert.equal(proposal.entries[0]?.quantity, 0);
});

test('ambiguous stock text does not silently create a write proposal', () => {
  assert.equal(
    buildKyrubInventoryMovementProposal(
      'Quanto tenho de queijo no estoque?',
      'conversation-read'
    ),
    null
  );
});

test('server execution protects negative inventory and records semantic movement kinds', () => {
  const source = readFileSync(
    new URL('../server/actions/inventoryAdjustmentExecutionService.ts', import.meta.url),
    'utf8'
  );

  assert.match(source, /INSUFFICIENT_INVENTORY/);
  assert.match(source, /INVENTORY_ITEM_NOT_FOUND/);
  assert.match(source, /movementKindFor/);
  assert.match(source, /mode === 'set'/);
  assert.match(source, /kind: movementKind/);
  assert.doesNotMatch(source, /Math\.max\(0,\s*existing\.currentQuantity\s*-\s*entry\.quantity\)/);
});

test('local ERP reads do not swallow inventory mutations or history requests', () => {
  const source = readFileSync(
    new URL('../shared/kyrubiaDeterministicErp.ts', import.meta.url),
    'utf8'
  );

  assert.match(
    source,
    /KYRUBIA_MUTATION_VERBS\.test\(intent\) \|\| isKyrubInventoryHistoryReadIntent\(intent\)/
  );
});

test('consultor route exposes semantic movements and history before generic AI fallback', () => {
  const source = readFileSync(
    new URL('../api/consultor-kyrub.ts', import.meta.url),
    'utf8'
  );

  assert.match(source, /buildKyrubInventoryMovementProposal/);
  assert.match(source, /resolveKyrubInventoryHistoryRead/);
  assert.match(source, /const history = inventoryHistoryResponse\(body, messages\)/);
  assert.match(source, /const movement = inventoryMovementResponse\(body, messages\)/);
  assert.match(source, /enabledActions: \['adjust_inventory'\]/);
  assert.match(source, /Revise e confirme a movimentação/);
});
