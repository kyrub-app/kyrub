import assert from 'node:assert/strict';
import test from 'node:test';
import { fiscalProductionOutcomePatch } from '../server/integrations/fiscalProductionOutcome.js';

test('production authorization requires provider protocol and access key', () => {
  assert.throws(() => fiscalProductionOutcomePatch({
    currentState: 'processing',
    reconciliation: false,
    outcome: {
      kind: 'authorized',
      externalRequestId: 'ref-1',
      providerStatus: 'authorized',
      authorizationProtocol: null,
      accessKey: '351234',
      documentNumber: '1',
    },
  }), /FISCAL_PRODUCTION_AUTHORIZATION_EVIDENCE_REQUIRED/);
});

test('authoritative provider evidence can transition processing to authorized', () => {
  const patch = fiscalProductionOutcomePatch({
    currentState: 'processing',
    reconciliation: false,
    outcome: {
      kind: 'authorized',
      externalRequestId: 'ref-1',
      providerStatus: 'authorized',
      authorizationProtocol: '135260000000001',
      accessKey: '35123456789012345678901234567890123456789012',
      documentNumber: '42',
    },
  });
  assert.equal(patch.state, 'authorized');
  assert.equal(patch.authorizationProtocol, '135260000000001');
});

test('rejection clears all authorization evidence', () => {
  const patch = fiscalProductionOutcomePatch({
    currentState: 'processing',
    reconciliation: false,
    outcome: {
      kind: 'rejected',
      externalRequestId: 'ref-1',
      providerStatus: 'erro_autorizacao',
      code: '999',
      safeMessage: 'Documento rejeitado pelo autorizador.',
    },
  });
  assert.equal(patch.state, 'rejected');
  assert.equal(patch.authorizationProtocol, null);
  assert.equal(patch.accessKey, null);
});

test('processing during reconciliation remains reconciliation_required', () => {
  const patch = fiscalProductionOutcomePatch({
    currentState: 'reconciliation_required',
    reconciliation: true,
    outcome: {
      kind: 'processing',
      externalRequestId: 'ref-1',
      providerStatus: 'processando_autorizacao',
    },
  });
  assert.equal(patch.state, 'reconciliation_required');
});

test('technical ambiguity never becomes authorization', () => {
  const patch = fiscalProductionOutcomePatch({
    currentState: 'processing',
    reconciliation: false,
    outcome: {
      kind: 'technical_ambiguity',
      externalRequestId: 'ref-1',
      providerStatus: 'submission_outcome_unknown',
      safeMessage: 'Reconsulta obrigatória.',
    },
  });
  assert.equal(patch.state, 'reconciliation_required');
  assert.equal(patch.authorizationProtocol, null);
});
