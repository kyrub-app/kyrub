import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertGovernanceTransition,
  assertVersionedConsentMatchesDocument,
  type GovernanceDocument,
  type VersionedConsent,
} from '../shared/governance';

const published: GovernanceDocument = {
  id: 'terms',
  type: 'terms',
  version: '1.3',
  hash: 'sha256:example',
  status: 'published',
  ownerUserId: 'legal-owner',
  createdAt: '2026-08-23T00:00:00.000Z',
  approvedAt: '2026-08-23T01:00:00.000Z',
  publishedAt: '2026-08-23T02:00:00.000Z',
};

test('governance lifecycle requires legal review before approval/publication', () => {
  assert.doesNotThrow(() => assertGovernanceTransition('draft', 'legal_review'));
  assert.doesNotThrow(() => assertGovernanceTransition('legal_review', 'approved'));
  assert.doesNotThrow(() => assertGovernanceTransition('approved', 'published'));
  assert.throws(() => assertGovernanceTransition('draft', 'published'), /TRANSITION_FORBIDDEN/);
});

test('versioned consent binds user acceptance to exact published document hash/version', () => {
  const consent: VersionedConsent = {
    id: 'consent-1',
    userId: 'user-1',
    documentId: 'terms',
    documentType: 'terms',
    documentVersion: '1.3',
    documentHash: 'sha256:example',
    acceptedAt: '2026-08-23T03:00:00.000Z',
    correlationId: 'corr-1',
  };
  assert.equal(assertVersionedConsentMatchesDocument(consent, published), consent);
  assert.throws(
    () => assertVersionedConsentMatchesDocument({ ...consent, documentVersion: '1.2' }, published),
    /VERSION_MISMATCH/
  );
});
