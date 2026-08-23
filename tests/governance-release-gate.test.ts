import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertHumanLegalAuthority,
  buildComplianceFinding,
  evaluateGovernanceReleaseGate,
} from '../shared/governanceReleaseGate';

test('compliance observes every official high-risk product domain', () => {
  const domains = ['payments', 'ai', 'gamification', 'store_connections', 'logistics'] as const;
  for (const domain of domains) {
    const finding = buildComplianceFinding(domain);
    assert.equal(finding.domain, domain);
    assert.equal(finding.material, true);
    assert.ok(finding.impactedDocuments.length > 0);
  }
});

test('material product change blocks release until human legal approval exists', () => {
  const decision = evaluateGovernanceReleaseGate({
    findings: [buildComplianceFinding('payments'), buildComplianceFinding('store_connections')],
    humanLegalApprovalRecorded: false,
  });
  assert.equal(decision.status, 'blocked');
  assert.equal(decision.requiresHumanLegalReview, true);
  assert.equal(decision.blockingCodes.length, 2);
});

test('non-material changes do not invent a legal blocker', () => {
  const decision = evaluateGovernanceReleaseGate({
    findings: [buildComplianceFinding('gamification', false)],
    humanLegalApprovalRecorded: false,
  });
  assert.equal(decision.status, 'clear');
  assert.equal(decision.requiresHumanLegalReview, false);
});

test('agent can never record the human legal approval itself', () => {
  assert.throws(
    () => assertHumanLegalAuthority({ actorType: 'agent', approved: true }),
    /HUMAN_LEGAL_APPROVAL_REQUIRED/
  );
  assert.doesNotThrow(() => assertHumanLegalAuthority({ actorType: 'human', approved: true }));
});
