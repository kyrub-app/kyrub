import assert from 'node:assert/strict';
import test from 'node:test';
import type { FiscalProductionAttemptRecord } from '../server/integrations/fiscalProductionAttemptLedger.js';
import {
  executeFocusNfceProductionAttempt,
  reconcileFocusNfceProductionAttempt,
} from '../server/integrations/fiscalProductionFocusOrchestrator.js';
import { buildFocusNfeReference } from '../server/integrations/focusNfeSandboxTransport.js';
import type { FocusNfceProductionCapability } from '../server/integrations/focusNfceProductionTransport.js';

const attemptId = `fiscal-attempt-${'a'.repeat(48)}`;
const fingerprint = 'b'.repeat(64);
const capability: FocusNfceProductionCapability = {
  enabled: true,
  authority: 'server_owned_focus_nfce_production_capability',
  canonicalStoreId: 'store-1',
  authorizationId: 'prod-auth-1',
};

const attempt = (state: 'processing' | 'reconciliation_required' = 'processing'): FiscalProductionAttemptRecord => ({
  schemaVersion: 1,
  canonicalStoreId: 'store-1',
  attemptId,
  state,
  adapterId: 'focus-nfe',
  adapterVersion: '1',
  credentialVersion: '7',
  externalRequestId: buildFocusNfeReference(attemptId),
  payloadFingerprint: fingerprint,
  claimedAt: '2026-10-01T14:00:00.000Z',
  lastCheckedAt: '2026-10-01T14:00:00.000Z',
  authority: 'server_fiscal_production_attempt_ledger',
});

const persisted = (state: FiscalProductionAttemptRecord['state']): FiscalProductionAttemptRecord => ({
  ...attempt(state === 'reconciliation_required' ? state : 'processing'),
  state,
});

const response = (status: number, payload: Record<string, unknown>) => ({
  status,
  json: async () => payload,
});

test('mocked authorized submit persists authoritative evidence through frozen binding', async () => {
  let persistedInput: any;
  const result = await executeFocusNfceProductionAttempt({
    attempt: attempt(),
    token: 'mock-token',
    payload: { natureza_operacao: 'VENDA' },
    capability,
    checkedAt: '2026-10-01T15:00:00.000Z',
    fetchImpl: async () => response(201, {
      status: 'autorizado',
      protocolo: '135260000000001',
      chave_nfce: '35123456789012345678901234567890123456789012',
      numero: '42',
    }),
    dependencies: {
      persistOutcome: async input => {
        persistedInput = input;
        return persisted('authorized');
      },
      requireReconciliation: async () => persisted('reconciliation_required'),
    },
  });
  assert.equal(result.state, 'authorized');
  assert.equal(persistedInput.expectedExternalRequestId, buildFocusNfeReference(attemptId));
  assert.equal(persistedInput.expectedPayloadFingerprint, fingerprint);
  assert.equal(persistedInput.patch.authorizationProtocol, '135260000000001');
});

test('missing capability fails before HTTP and does not manufacture reconciliation', async () => {
  let httpCalls = 0;
  let reconciliations = 0;
  await assert.rejects(() => executeFocusNfceProductionAttempt({
    attempt: attempt(),
    token: 'mock-token',
    payload: {},
    checkedAt: '2026-10-01T15:00:00.000Z',
    fetchImpl: async () => {
      httpCalls += 1;
      return response(201, {});
    },
    dependencies: {
      persistOutcome: async () => persisted('authorized'),
      requireReconciliation: async () => {
        reconciliations += 1;
        return persisted('reconciliation_required');
      },
    },
  }), /FOCUS_NFCE_PRODUCTION_CAPABILITY_REQUIRED/);
  assert.equal(httpCalls, 0);
  assert.equal(reconciliations, 0);
});

test('network ambiguity marks the claimed attempt for reconciliation', async () => {
  let reconciliations = 0;
  await assert.rejects(() => executeFocusNfceProductionAttempt({
    attempt: attempt(),
    token: 'mock-token',
    payload: {},
    capability,
    checkedAt: '2026-10-01T15:00:00.000Z',
    fetchImpl: async () => {
      throw new Error('mock timeout');
    },
    dependencies: {
      persistOutcome: async () => persisted('authorized'),
      requireReconciliation: async input => {
        reconciliations += 1;
        assert.equal(input.expectedPayloadFingerprint, fingerprint);
        return persisted('reconciliation_required');
      },
    },
  }), /mock timeout/);
  assert.equal(reconciliations, 1);
});

test('reconciliation uses GET only and never resubmits', async () => {
  let method = '';
  const result = await reconcileFocusNfceProductionAttempt({
    attempt: attempt('reconciliation_required'),
    token: 'mock-token',
    capability,
    checkedAt: '2026-10-01T15:05:00.000Z',
    fetchImpl: async (_url, init) => {
      method = String(init?.method);
      return response(200, { status: 'processando_autorizacao' });
    },
    dependencies: {
      persistOutcome: async input => {
        assert.equal(input.patch.state, 'reconciliation_required');
        return persisted('reconciliation_required');
      },
      requireReconciliation: async () => persisted('reconciliation_required'),
    },
  });
  assert.equal(method, 'GET');
  assert.equal(result.state, 'reconciliation_required');
});

test('orchestrator rejects a ledger binding that is not the deterministic Focus reference', async () => {
  const invalid = attempt();
  invalid.externalRequestId = 'another-reference';
  await assert.rejects(() => executeFocusNfceProductionAttempt({
    attempt: invalid,
    token: 'mock-token',
    payload: {},
    capability,
    checkedAt: '2026-10-01T15:00:00.000Z',
  }), /FISCAL_PRODUCTION_FOCUS_BINDING_INVALID/);
});
