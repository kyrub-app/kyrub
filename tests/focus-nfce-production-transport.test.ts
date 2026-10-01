import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getFocusNfceProductionDocumentStatus,
  submitFocusNfceProductionDocument,
  type FocusNfceProductionCapability,
} from '../server/integrations/focusNfceProductionTransport.js';

const attemptId = `fiscal-attempt-${'a'.repeat(48)}`;
const capability: FocusNfceProductionCapability = {
  enabled: true,
  authority: 'server_owned_focus_nfce_production_capability',
  canonicalStoreId: 'store-1',
  authorizationId: 'prod-auth-1',
};

const response = (status: number, payload: Record<string, unknown>) => ({
  status,
  json: async () => payload,
});

test('production transport is fail-closed without server capability', async () => {
  let called = false;
  await assert.rejects(() => submitFocusNfceProductionDocument({
    canonicalStoreId: 'store-1',
    attemptId,
    token: 'token',
    payload: {},
    fetchImpl: async () => {
      called = true;
      return response(201, {});
    },
  }), /FOCUS_NFCE_PRODUCTION_CAPABILITY_REQUIRED/);
  assert.equal(called, false);
});

test('mocked submit uses production NFC-e endpoint and deterministic ref', async () => {
  let url = '';
  let init: RequestInit | undefined;
  await submitFocusNfceProductionDocument({
    canonicalStoreId: 'store-1',
    attemptId,
    token: 'token',
    payload: { cnpj_emitente: '00000000000000' },
    capability,
    fetchImpl: async (input, requestInit) => {
      url = input;
      init = requestInit;
      return response(201, {
        status: 'autorizado',
        protocolo: '135260000000001',
        chave_nfce: '35123456789012345678901234567890123456789012',
      });
    },
  });
  assert.match(url, /^https:\/\/api\.focusnfe\.com\.br\/v2\/nfce\?ref=kyrub[a-f0-9]{48}$/);
  assert.equal(init?.method, 'POST');
  assert.match(String((init?.headers as Record<string, string>).authorization), /^Basic /);
});

test('mocked status query uses same reference and maps processing', async () => {
  let url = '';
  const outcome = await getFocusNfceProductionDocumentStatus({
    canonicalStoreId: 'store-1',
    attemptId,
    token: 'token',
    capability,
    fetchImpl: async input => {
      url = input;
      return response(200, { status: 'processando_autorizacao' });
    },
  });
  assert.match(url, /^https:\/\/api\.focusnfe\.com\.br\/v2\/nfce\/kyrub[a-f0-9]{48}$/);
  assert.equal(outcome.kind, 'processing');
});

test('mocked duplicate/processing reference becomes reconciliation, not resubmission success', async () => {
  const outcome = await submitFocusNfceProductionDocument({
    canonicalStoreId: 'store-1',
    attemptId,
    token: 'token',
    payload: {},
    capability,
    fetchImpl: async () => response(422, {
      status: 'erro',
      mensagem: 'Referência já utilizada ou em processamento',
    }),
  });
  assert.equal(outcome.kind, 'technical_ambiguity');
});
