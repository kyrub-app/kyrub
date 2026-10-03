import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fiscalProductionUnknownOutcomeState,
  prepareFiscalProductionExecutionClaim,
} from '../server/integrations/fiscalProductionExecutorFoundation.js';

const secretRef = 'gsm://projects/kyrub/secrets/focus-production';
const attemptId = `fiscal-attempt-${'a'.repeat(48)}`;
const fingerprint = 'b'.repeat(64);

const base = () => ({
  canonicalStoreId: 'store-1',
  attemptId,
  currentState: 'prepared' as const,
  authorization: {
    schemaVersion: 1 as const,
    canonicalStoreId: 'store-1',
    documentFamily: 'nfce' as const,
    environment: 'production' as const,
    status: 'enabled' as const,
    providerAdapterId: 'focus-nfe',
    providerAdapterVersion: '1',
    credentialSecretRef: secretRef,
    authorizedByUserId: 'owner-1',
    authorizedAt: '2026-10-01T13:00:00.000Z',
    authority: 'server_owned_fiscal_production_authorization' as const,
  },
  configuration: {
    schemaVersion: 1 as const,
    canonicalStoreId: 'store-1',
    documentFamily: 'nfce' as const,
    environment: 'production' as const,
    status: 'active' as const,
    adapterId: 'focus-nfe',
    adapterVersion: '1',
    credentialSecretRef: secretRef,
    authority: 'server_owned_fiscal_provider_configuration' as const,
  },
  credential: {
    secretRef,
    version: '7',
    resourceName: 'projects/kyrub/secrets/focus-production/versions/7',
    value: 'server-only-token',
  },
  externalRequestId: 'nfce-production-attempt-1',
  payloadFingerprint: fingerprint,
  claimedAt: '2026-10-01T14:00:00.000Z',
});

test('claim can only be constructed from prepared state with all production barriers', () => {
  const claim = prepareFiscalProductionExecutionClaim(base());
  assert.equal(claim.state, 'processing');
  assert.equal(claim.credentialVersion, '7');
  assert.equal(claim.authority, 'server_fiscal_production_executor_foundation');
});

test('already claimed or terminal attempts cannot be claimed again', () => {
  const input = base();
  assert.throws(() => prepareFiscalProductionExecutionClaim({
    ...input,
    currentState: 'processing',
  }), /FISCAL_PRODUCTION_ATTEMPT_NOT_PREPARED/);
});

test('payload fingerprint is mandatory before a production claim', () => {
  assert.throws(() => prepareFiscalProductionExecutionClaim({
    ...base(),
    payloadFingerprint: 'not-a-sha256',
  }), /FISCAL_PRODUCTION_PREPARED_SUBMISSION_INVALID/);
});

test('unknown provider outcome always requires reconciliation and never authorization', () => {
  assert.equal(fiscalProductionUnknownOutcomeState('processing'), 'reconciliation_required');
  assert.equal(fiscalProductionUnknownOutcomeState('reconciliation_required'), 'reconciliation_required');
  assert.throws(() => fiscalProductionUnknownOutcomeState('authorized'), /FISCAL_PRODUCTION_RECONCILIATION_STATE_INVALID/);
});
