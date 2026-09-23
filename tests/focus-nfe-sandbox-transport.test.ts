import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildFocusNfeBasicAuthorization,
  buildFocusNfeReference,
  normalizeFocusNfeResult,
} from '../server/integrations/focusNfeSandboxTransport';

const source = readFileSync(
  'server/integrations/focusNfeSandboxTransport.ts',
  'utf8'
);
const registrySource = readFileSync(
  'server/integrations/fiscalProviderAdapter.ts',
  'utf8'
);

const attemptId = `fiscal-attempt-${'a'.repeat(48)}`;

test('Focus reference is deterministic, alphanumeric and detached from Firestore punctuation', () => {
  const first = buildFocusNfeReference(attemptId);
  const second = buildFocusNfeReference(attemptId);
  assert.equal(first, second);
  assert.match(first, /^kyrub[a-f0-9]{48}$/);
  assert.doesNotMatch(first, /[-_:/@ ]/);
});

test('Focus Basic auth uses token as username and blank password', () => {
  const header = buildFocusNfeBasicAuthorization('sandbox-token');
  assert.equal(
    Buffer.from(header.replace(/^Basic\s+/, ''), 'base64').toString('utf8'),
    'sandbox-token:'
  );
});

test('transport is physically pinned to homologation and never production', () => {
  assert.match(source, /https:\/\/homologacao\.focusnfe\.com\.br/);
  assert.doesNotMatch(source, /https:\/\/api\.focusnfe\.com\.br/);
  assert.match(source, /\/v2\/\$\{family\}\?ref=/);
  assert.match(source, /\/v2\/\$\{family\}\/\$\{encodeURIComponent\(ref\)\}/);
});

test('known provider states normalize without preserving raw payloads', () => {
  assert.deepEqual(
    normalizeFocusNfeResult({
      operation: 'submit',
      reference: 'kyrubabc',
      httpStatus: 202,
      payload: { status: 'processando_autorizacao', raw_secret: 'must-not-leak' },
    }),
    {
      kind: 'processing',
      externalRequestId: 'kyrubabc',
      providerStatus: 'processando_autorizacao',
    }
  );

  const authorized = normalizeFocusNfeResult({
    operation: 'status',
    reference: 'kyrubabc',
    httpStatus: 200,
    payload: {
      status: 'autorizado',
      protocolo: '135000000001',
      chave_nfe: '1'.repeat(44),
      numero: '123',
      raw_secret: 'must-not-leak',
    },
  });
  assert.equal(authorized.kind, 'authorized');
  if (authorized.kind === 'authorized') {
    assert.equal(authorized.externalRequestId, 'kyrubabc');
    assert.equal(authorized.authorizationProtocol, '135000000001');
    assert.equal(authorized.accessKey, '1'.repeat(44));
    assert.equal(authorized.documentNumber, '123');
    assert.equal('raw_secret' in authorized, false);
  }
});

test('existing/ambiguous references reconcile instead of becoming retryable validation failures', () => {
  const outcome = normalizeFocusNfeResult({
    operation: 'submit',
    reference: 'kyrubabc',
    httpStatus: 422,
    payload: { mensagem: 'Referência já utilizada ou em processamento' },
  });
  assert.equal(outcome.kind, 'technical_ambiguity');
  if (outcome.kind === 'technical_ambiguity') {
    assert.equal(outcome.externalRequestId, 'kyrubabc');
  }
});

test('authentication failures are deterministic validation failures without secret echo', () => {
  const outcome = normalizeFocusNfeResult({
    operation: 'submit',
    reference: 'kyrubabc',
    httpStatus: 401,
    payload: { token: 'secret', mensagem: 'raw provider detail' },
  });
  assert.equal(outcome.kind, 'validation_failure');
  if (outcome.kind === 'validation_failure') {
    assert.doesNotMatch(outcome.safeMessage, /secret|raw provider detail/);
  }
});

test('Focus transport is not registered in runtime before executable payload wiring', () => {
  assert.match(
    registrySource,
    /createRuntimeFiscalProviderAdapterRegistry[\s\S]*buildFiscalProviderAdapterRegistry\(\[\]\)/
  );
  assert.doesNotMatch(registrySource, /focus-nfe/);
});
