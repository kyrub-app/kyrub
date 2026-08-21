import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildKyrubOpportunity,
  demandShortageOpportunity,
  lowStockOpportunity,
  rankKyrubOpportunities,
} from '../shared/kyrubOpportunityEngine';

test('authoritative low-stock facts become explainable opportunities', () => {
  const opportunity = lowStockOpportunity({
    inventoryItemId: 'fries',
    inventoryItemName: 'Batata frita',
    availableQuantity: 250,
    minimumQuantity: 1000,
    unit: 'g',
    observedAt: '2026-08-21T20:30:00.000Z',
  });
  assert.ok(opportunity);
  assert.equal(opportunity.domain, 'inventory');
  assert.equal(opportunity.priority, 'critical');
  assert.deepEqual(opportunity.evidenceRefs, ['inventory:fries']);
  assert.equal(opportunity.suggestedAction?.autonomyLevel, 2);
  assert.equal(opportunity.suggestedAction?.proposalAllowed, true);
});

test('calculated shortages preserve provenance instead of pretending to be raw facts', () => {
  const opportunity = demandShortageOpportunity({
    inventoryItemId: 'fries',
    inventoryItemName: 'Batata frita',
    shortageQuantity: 300,
    unit: 'g',
    productIds: ['002'],
    observedAt: '2026-08-21T20:31:00.000Z',
  });
  assert.ok(opportunity);
  assert.match(opportunity.explanation, /calculada/i);
  assert.deepEqual(opportunity.evidenceRefs, ['composition:002', 'inventory:fries']);
});

test('kill switches prevent proposals without hiding the opportunity itself', () => {
  const opportunity = lowStockOpportunity({
    inventoryItemId: 'bun',
    inventoryItemName: 'Pão para hambúrguer',
    availableQuantity: 2,
    minimumQuantity: 5,
    unit: 'un',
    observedAt: '2026-08-21T20:32:00.000Z',
    controls: { globalKillSwitch: true },
  });
  assert.ok(opportunity);
  assert.equal(opportunity.suggestedAction?.proposalAllowed, false);
  assert.deepEqual(opportunity.suggestedAction?.blockedReasons, ['GLOBAL_KILL_SWITCH']);
});

test('inference scores below authoritative facts at the same confidence', () => {
  const fact = buildKyrubOpportunity({
    signal: {
      id: 'fact-1', domain: 'sales', kind: 'authoritative_fact', summary: 'Venda confirmada.',
      observedAt: '2026-08-21T20:33:00.000Z', confidence: 0.9, evidenceRefs: ['order:1'],
    },
    title: 'Fato', explanation: 'Fato confirmado.',
  });
  const inference = buildKyrubOpportunity({
    signal: {
      id: 'infer-1', domain: 'sales', kind: 'inference', summary: 'Possível tendência.',
      observedAt: '2026-08-21T20:33:00.000Z', confidence: 0.9, evidenceRefs: ['analysis:1'],
    },
    title: 'Inferência', explanation: 'Tendência inferida.',
  });
  assert.ok(fact.score > inference.score);
  assert.equal(rankKyrubOpportunities([inference, fact])[0]?.opportunityId, fact.opportunityId);
});