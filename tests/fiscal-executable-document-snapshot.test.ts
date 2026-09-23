import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isFiscalExecutableDocumentReady } from '../shared/fiscalExecutableDocument';

const attemptSource = readFileSync('shared/fiscalHomologationAttempt.ts', 'utf8');
const attemptLedgerSource = readFileSync(
  'server/integrations/fiscalHomologationAttemptLedger.ts',
  'utf8'
);
const snapshotSource = readFileSync(
  'server/integrations/fiscalExecutableDocumentSnapshotService.ts',
  'utf8'
);
const adapterSource = readFileSync(
  'server/integrations/fiscalProviderAdapter.ts',
  'utf8'
);

test('fiscal attempt tracks a canonical document snapshot before provider execution', () => {
  assert.match(attemptSource, /fiscalDocumentSnapshotId: string \| null/);
  assert.match(attemptSource, /fiscalDocumentStatus: FiscalExecutableDocumentStatus \| null/);
  assert.match(attemptLedgerSource, /fiscalDocumentSnapshotId: null/);
  assert.match(attemptLedgerSource, /fiscalDocumentStatus: null/);
});

test('document snapshot freezes canonical commercial lines without inferring taxes', () => {
  assert.match(snapshotSource, /stores\/\$\{canonicalStoreId\}\/orders\/\$\{attempt\.orderId\}/);
  assert.match(snapshotSource, /productFiscalProfiles/);
  assert.match(snapshotSource, /quantity/);
  assert.match(snapshotSource, /unitPrice/);
  assert.match(snapshotSource, /discountAmount/);
  assert.match(snapshotSource, /documentTotal/);
  assert.match(snapshotSource, /FISCAL_DOCUMENT_PAYMENT_TOTAL_MISMATCH/);
  assert.doesNotMatch(snapshotSource, /\bcfop\b|\bcst\b|\bcsosn\b|taxRate|aliquota_icms/i);
});

test('snapshot stores identity hashes instead of plaintext tax identifiers', () => {
  assert.match(snapshotSource, /issuerTaxIdentifierHash: sha256\(issuerRaw\)/);
  assert.match(snapshotSource, /consumerTaxIdentifierHash: consumerRaw \? sha256\(consumerRaw\) : null/);
  assert.doesNotMatch(
    readFileSync('shared/fiscalExecutableDocument.ts', 'utf8'),
    /issuerTaxIdentifier:\s*string|consumerTaxIdentifier:\s*string/
  );
});

test('first document snapshot stays blocked until an explicit tax execution policy is bound', () => {
  assert.match(snapshotSource, /status: 'required' as const/);
  assert.match(snapshotSource, /status: 'blocked_explicit_tax_policy_required'/);
  assert.equal(
    isFiscalExecutableDocumentReady({
      schemaVersion: 1,
      snapshotId: 'fiscal-doc-test',
      evidenceFingerprint: 'a'.repeat(64),
      canonicalStoreId: 'store-1',
      attemptId: `fiscal-attempt-${'b'.repeat(48)}`,
      orderId: 'order-1',
      documentFamily: 'nfce',
      operationScope: 'goods',
      environment: 'sandbox',
      lines: [],
      subtotal: 10,
      discountTotal: 0,
      documentTotal: 10,
      identityFingerprints: {
        issuerTaxIdentifierHash: 'c'.repeat(64),
        consumerTaxIdentifierHash: null,
      },
      taxExecutionPolicy: { status: 'required', policyId: null, version: null },
      status: 'blocked_explicit_tax_policy_required',
      createdAt: '2026-09-23T10:00:00.000Z',
      authority: 'kyrub_canonical_fiscal_document_snapshot',
    }),
    false
  );
});

test('snapshot builder is server-only and has no provider/SEFAZ side effect', () => {
  assert.doesNotMatch(snapshotSource, /fetch\s*\(|focusnfe|sefaz|adapter\.submit/);
  assert.match(snapshotSource, /transaction\.create\(snapshotRef/);
  assert.match(snapshotSource, /resolveFiscalHomologationOwnerAuthority/);
});

test('runtime provider registry remains fail-closed while executable tax policy is unresolved', () => {
  assert.match(
    adapterSource,
    /createRuntimeFiscalProviderAdapterRegistry[\s\S]*buildFiscalProviderAdapterRegistry\(\[\]\)/
  );
});
