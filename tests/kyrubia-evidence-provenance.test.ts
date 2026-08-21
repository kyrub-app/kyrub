import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canKyrubEvidenceAuthorizeStateMutation,
  classifyKyrubEvidenceAuthority,
  createKyrubEvidenceEnvelope,
  requiresKyrubAuthoritativeReconciliation,
  withKyrubEvidenceConfidence,
} from '../shared/kyrubEvidence';

test('canonical state and verified provider events are authoritative', () => {
  assert.equal(classifyKyrubEvidenceAuthority('authoritative_state'), 'authoritative');
  assert.equal(classifyKyrubEvidenceAuthority('verified_external_event'), 'authoritative');
});

test('documents, user statements and tool outputs remain evidence', () => {
  assert.equal(classifyKyrubEvidenceAuthority('user_intent'), 'evidence');
  assert.equal(classifyKyrubEvidenceAuthority('quoted_content'), 'evidence');
  assert.equal(classifyKyrubEvidenceAuthority('document_content'), 'evidence');
  assert.equal(classifyKyrubEvidenceAuthority('tool_output'), 'evidence');
});

test('sensor and AI derived content remain inference', () => {
  assert.equal(classifyKyrubEvidenceAuthority('sensor_inference'), 'inference');
  assert.equal(classifyKyrubEvidenceAuthority('ai_generated_content'), 'inference');
});

test('high confidence never promotes evidence into authority', () => {
  const source = createKyrubEvidenceEnvelope({
    sourceKind: 'document_content',
    sourceRef: 'catalog-image-1',
    observedAt: '2026-08-21T12:20:00.000Z',
    confidence: 0.7,
  });
  const enriched = withKyrubEvidenceConfidence(source, 1);

  assert.equal(enriched.confidence, 1);
  assert.equal(enriched.authority, 'evidence');
  assert.equal(canKyrubEvidenceAuthorizeStateMutation(enriched), false);
  assert.equal(requiresKyrubAuthoritativeReconciliation(enriched), true);
});

test('only authoritative evidence can authorize a state mutation', () => {
  const verified = createKyrubEvidenceEnvelope({
    sourceKind: 'verified_external_event',
    sourceRef: 'mercado-pago:webhook:payment-1',
    observedAt: '2026-08-21T12:21:00.000Z',
    freshness: 'live',
    correlationId: 'corr-payment-1',
  });
  const model = createKyrubEvidenceEnvelope({
    sourceKind: 'ai_generated_content',
    sourceRef: 'kyrubia:turn-9',
    observedAt: '2026-08-21T12:21:02.000Z',
  });

  assert.equal(canKyrubEvidenceAuthorizeStateMutation(verified), true);
  assert.equal(requiresKyrubAuthoritativeReconciliation(verified), false);
  assert.equal(canKyrubEvidenceAuthorizeStateMutation(model), false);
});
