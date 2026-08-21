import assert from 'node:assert/strict';
import test from 'node:test';
import { createKyrubEvidenceEnvelope } from '../shared/kyrubEvidence';
import {
  buildKyrubObserveExplainResult,
  classifyKyrubObservation,
  createKyrubObservationClaim,
} from '../shared/kyrubObservations';

const authoritative = createKyrubEvidenceEnvelope({
  sourceKind: 'authoritative_state',
  sourceRef: 'stores/store-1/products/product-1',
  observedAt: '2026-08-21T12:00:00.000Z',
  freshness: 'live',
});

const inferred = createKyrubEvidenceEnvelope({
  sourceKind: 'ai_generated_content',
  sourceRef: 'conversation/message-1',
  observedAt: '2026-08-21T12:00:00.000Z',
  freshness: 'recent',
  confidence: 1,
});

test('authoritative-only evidence is labeled as authoritative fact', () => {
  assert.equal(
    classifyKyrubObservation({ evidence: [authoritative] }),
    'authoritative_fact'
  );
});

test('even confidence 1 AI content remains inference', () => {
  assert.equal(
    classifyKyrubObservation({ evidence: [inferred] }),
    'inference'
  );
});

test('calculations remain distinguishable from authoritative facts', () => {
  assert.equal(
    classifyKyrubObservation({ calculated: true, evidence: [authoritative] }),
    'calculation'
  );
});

test('claims keep evidence, freshness and epistemic explanation', () => {
  const claim = createKyrubObservationClaim({
    id: 'stock-product-1',
    label: 'Estoque atual',
    value: 8,
    evidence: [authoritative],
  });
  assert.equal(claim.knowledgeClass, 'authoritative_fact');
  assert.equal(claim.freshness, 'live');
  assert.equal(claim.evidence.length, 1);
  assert.match(claim.explanation, /fonte autoritativa/i);
});

test('observe-and-explain results have no write capability by contract', () => {
  const result = buildKyrubObserveExplainResult({
    correlationId: 'corr-observe-1',
    generatedAt: '2026-08-21T12:01:00.000Z',
    claims: [
      createKyrubObservationClaim({
        id: 'claim-1',
        label: 'Status do pedido',
        value: 'pending',
        evidence: [authoritative],
      }),
    ],
  });
  assert.equal(result.writeCapability, 'none');
  assert.equal(result.correlationId, 'corr-observe-1');
});
