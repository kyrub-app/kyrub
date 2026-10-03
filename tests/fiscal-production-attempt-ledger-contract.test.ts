import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('server/integrations/fiscalProductionAttemptLedger.ts', 'utf8');

test('production attempt claim is transactional and prepared-only', () => {
  assert.match(source, /adminDb\.runTransaction/);
  assert.match(source, /current\.state !== 'prepared'/);
  assert.match(source, /FISCAL_PRODUCTION_ATTEMPT_ALREADY_CLAIMED/);
  assert.match(source, /state: 'processing'/);
});

test('claim freezes provider binding before any future transport', () => {
  assert.match(source, /adapterId: claim\.adapterId/);
  assert.match(source, /adapterVersion: claim\.adapterVersion/);
  assert.match(source, /credentialVersion: claim\.credentialVersion/);
  assert.match(source, /externalRequestId: claim\.externalRequestId/);
  assert.match(source, /payloadFingerprint: claim\.payloadFingerprint/);
});

test('reconciliation accepts only processing or already ambiguous attempts with same binding', () => {
  assert.match(source, /\['processing', 'reconciliation_required'\]\.includes\(current\.state\)/);
  assert.match(source, /current\.externalRequestId !== input\.expectedExternalRequestId/);
  assert.match(source, /current\.payloadFingerprint !== input\.expectedPayloadFingerprint/);
  assert.match(source, /state: 'reconciliation_required'/);
});

test('ledger contains no provider network transport', () => {
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /focusnfe\.com\.br/);
  assert.doesNotMatch(source, /Authorization:\s*Basic/);
});
