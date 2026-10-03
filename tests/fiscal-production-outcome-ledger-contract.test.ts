import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('server/integrations/fiscalProductionAttemptLedger.ts', 'utf8');

test('production outcome persistence is transactional and binding-scoped', () => {
  assert.match(source, /persistFiscalProductionOutcome/);
  assert.match(source, /adminDb\.runTransaction/);
  assert.match(source, /current\.externalRequestId !== input\.expectedExternalRequestId/);
  assert.match(source, /current\.payloadFingerprint !== input\.expectedPayloadFingerprint/);
  assert.match(source, /FISCAL_PRODUCTION_OUTCOME_BINDING_STALE/);
});

test('authorized and rejected attempts are immutable terminal states', () => {
  assert.match(source, /current\.state === 'authorized' \|\| current\.state === 'rejected'/);
  assert.match(source, /FISCAL_PRODUCTION_ATTEMPT_TERMINAL/);
});

test('authoritative evidence fields are persisted with the outcome', () => {
  assert.match(source, /authorizationProtocol: next\.authorizationProtocol/);
  assert.match(source, /accessKey: next\.accessKey/);
  assert.match(source, /documentNumber: next\.documentNumber/);
  assert.match(source, /providerStatus: next\.providerStatus/);
});

test('outcome persistence contains no provider transport', () => {
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /focusnfe\.com\.br/);
  assert.doesNotMatch(source, /Authorization:\s*Basic/);
});
