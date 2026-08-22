import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  KYRUB_AGENT_REGISTRY,
  KYRUB_WORKSTREAM_REGISTRY,
  sanitizeAgentAuditEvent,
} from '../shared/aiOps/agentOperations';
import {
  KYRUB_EXTERNAL_AI_READ_ONLY_SCOPES,
  requiresGovernedActionLayer,
  validateExternalAiConnectionMetadata,
} from '../shared/aiOps/externalAiConnection';
import { detectComplianceDrift } from '../shared/aiOps/complianceDrift';
import { emptyAdminAiOperationsSnapshot } from '../shared/aiOps/adminAiOperationsModel';

const closeout = readFileSync('docs/AI_DEVELOPMENT_TEAM_PHASE0_CLOSEOUT.md', 'utf8');

test('second-wave agent identities and all seven workstreams are registered', () => {
  assert.ok(KYRUB_AGENT_REGISTRY.some(agent => agent.id === 'ai-platform-agent'));
  assert.ok(KYRUB_AGENT_REGISTRY.some(agent => agent.id === 'compliance-agent'));
  assert.ok(KYRUB_AGENT_REGISTRY.some(agent => agent.id === 'ai-operations-agent'));
  assert.deepEqual(KYRUB_WORKSTREAM_REGISTRY.map(item => item.id).sort(), ['A', 'B', 'C', 'D', 'E', 'F', 'G']);
});

test('external AI starts with bounded read scopes and writes require governed action layer', () => {
  assert.deepEqual(KYRUB_EXTERNAL_AI_READ_ONLY_SCOPES, [
    'store.read',
    'products.read',
    'inventory.read',
    'orders.read',
  ]);
  assert.equal(requiresGovernedActionLayer(['inventory.read']), false);
  assert.equal(requiresGovernedActionLayer(['notes.write']), true);
  assert.throws(() => validateExternalAiConnectionMetadata({
    id: 'connection-1',
    ownerUid: 'user-1',
    provider: 'openai',
    status: 'active',
    scopes: ['inventory.read'],
    authMode: 'oauth',
    credentialAuthority: 'none',
    credentialRef: 'should-not-exist',
    createdAt: '',
    updatedAt: '',
    revokedAt: '',
  }), /CREDENTIAL_REF_WITHOUT_AUTHORITY/);
});

test('compliance agent flags product/legal drift but requires human legal review', () => {
  const findings = detectComplianceDrift({
    paymentsRealMoneyEnabled: true,
    externalAiConnectionsEnabled: true,
    gamificationRewardsEnabled: false,
    logisticsFallbackEnabled: false,
  }, {
    termsDescribeRealMoney: false,
    privacyDescribesExternalAiProviders: false,
    termsDescribeGamificationRewards: false,
    termsDescribeLogisticsFallback: false,
  });
  assert.equal(findings.length, 2);
  assert.ok(findings.every(finding => finding.requiresHumanLegalReview));
  assert.ok(findings.some(finding => finding.code === 'TERMS_REAL_MONEY_DRIFT'));
  assert.ok(findings.some(finding => finding.code === 'PRIVACY_EXTERNAL_AI_DRIFT'));
});

test('admin AI Operations model is empty-by-default and contains no invented usage', () => {
  assert.deepEqual(emptyAdminAiOperationsSnapshot(), {
    generatedAt: '',
    agents: [],
    tasks: [],
    workstreams: [],
    costs: [],
    failures: [],
    killSwitches: [],
  });
});

test('agent audit trail normalizes identifiers without inventing evidence', () => {
  const event = sanitizeAgentAuditEvent({
    id: ' audit_1 ',
    action: 'agent.task.reviewed',
    actorAgent: 'qa-security-agent',
    workstream: 'F',
    taskId: ' task_1 ',
    pullRequest: ' #279 ',
    commitSha: ' abc123 ',
    result: ' passed ',
    createdAt: ' 2026-08-22T00:00:00.000Z ',
  });
  assert.equal(event.id, 'audit_1');
  assert.equal(event.taskId, 'task_1');
  assert.equal(event.pullRequest, '#279');
  assert.equal(event.commitSha, 'abc123');
  assert.equal(event.result, 'passed');
});

test('phase 0 closeout preserves Owner Gates instead of claiming future work is complete', () => {
  assert.match(closeout, /19\. AI Platform Agent/);
  assert.match(closeout, /20\. Compliance Agent/);
  assert.match(closeout, /21\. AI Operations Agent/);
  assert.match(closeout, /22\. Admin AI Operations model/);
  assert.match(closeout, /23\. Roadmap\/dependency graph/);
  assert.match(closeout, /24\. Audit trail/);
  assert.match(closeout, /25\. First real controlled parallel wave/);
  assert.match(closeout, /26\. Cross-stream integration/);
  assert.match(closeout, /27\. Release isolation rule/);
  assert.match(closeout, /Point 28/);
  assert.match(closeout, /does not claim that Mercado Pago production credentials are installed/i);
});
