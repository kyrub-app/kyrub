import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertPspQualificationDecision,
  canEnablePspSplitInProduction,
  mercadoPagoOneToManyDefaultDecision,
} from '../shared/pspQualification';

test('Mercado Pago 1:N defaults to a required commercial gate', () => {
  const decision = mercadoPagoOneToManyDefaultDecision('2026-08-23T19:40:00.000Z');
  assert.equal(decision.provider, 'mercado_pago');
  assert.equal(decision.splitModel, 'one_to_many');
  assert.equal(decision.commercialGate, 'required');
  assert.equal(canEnablePspSplitInProduction(decision), false);
});

test('commercial approval must carry evidence before production enablement', () => {
  const approved = {
    provider: 'mercado_pago' as const,
    splitModel: 'one_to_many' as const,
    technicallySupported: true,
    commercialGate: 'approved' as const,
    evidenceReference: 'provider-approval:ticket-123',
    assessedAt: '2026-08-23T19:40:00.000Z',
  };
  assert.equal(assertPspQualificationDecision(approved), approved);
  assert.equal(canEnablePspSplitInProduction(approved), true);
  assert.throws(
    () => assertPspQualificationDecision({ ...approved, evidenceReference: '' }),
    /PSP_COMMERCIAL_EVIDENCE_REQUIRED/
  );
});

test('technical support alone never bypasses a required commercial gate', () => {
  assert.equal(canEnablePspSplitInProduction({
    provider: 'pagarme',
    splitModel: 'one_to_many',
    technicallySupported: true,
    commercialGate: 'required',
    assessedAt: '2026-08-23T19:40:00.000Z',
  }), false);
});
