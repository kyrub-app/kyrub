export type KyrubAgentId =
  | 'lead-orchestrator'
  | 'payments-agent'
  | 'platform-secrets-agent'
  | 'gamification-agent'
  | 'ai-platform-agent'
  | 'qa-security-agent'
  | 'compliance-agent'
  | 'ai-operations-agent';

export type KyrubWorkstreamId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
export type KyrubTaskStatus =
  | 'queued'
  | 'active'
  | 'blocked'
  | 'ready_for_review'
  | 'passed'
  | 'failed'
  | 'superseded';

export type KyrubTaskRisk = 'low' | 'medium' | 'high' | 'critical';

export interface KyrubAgentDefinition {
  id: KyrubAgentId;
  title: string;
  workstream: KyrubWorkstreamId | 'cross-domain';
  canImplement: boolean;
  canReview: boolean;
  persistentExecutionEligible: boolean;
  ownerGateCategories: readonly string[];
}

export interface KyrubWorkstreamDefinition {
  id: KyrubWorkstreamId;
  title: string;
  ownerAgent: KyrubAgentId;
  dependencies: readonly KyrubWorkstreamId[];
  priority: 'P0' | 'P1' | 'continuous';
}

export interface KyrubAgentTaskEnvelope {
  taskId: string;
  workstream: KyrubWorkstreamId;
  ownerAgent: KyrubAgentId;
  objective: string;
  baseRef: 'main';
  baseSha: string;
  branch: string;
  contractsTouched: readonly string[];
  dependencies: readonly string[];
  acceptanceCriteria: readonly string[];
  gates: readonly string[];
  risk: KyrubTaskRisk;
  productionBehaviorChange: boolean;
  ownerGate: string;
}

export interface KyrubAgentHandoff {
  taskId: string;
  fromAgent: KyrubAgentId;
  toAgent: KyrubAgentId;
  status: 'ready_for_review' | 'blocked' | 'dependency_ready' | 'superseded';
  baseSha: string;
  headSha: string;
  contractsChanged: readonly string[];
  testsEvidence: string;
  ciEvidence: string;
  runtimeEvidence: string;
  openDependencies: readonly string[];
  risks: readonly string[];
  nextAction: string;
}

export interface KyrubAgentExecutionReceipt {
  receiptId: string;
  taskId: string;
  agentId: KyrubAgentId;
  workstream: KyrubWorkstreamId;
  baseSha: string;
  headSha: string;
  pullRequest: string;
  result: 'passed' | 'failed' | 'blocked' | 'superseded';
  tests: ReadonlyArray<{ name: string; result: string }>;
  deployment: {
    environment: 'none' | 'preview' | 'production';
    result: string;
  };
  secretExposureCheck: 'passed' | 'failed';
  crossDomainDependencies: readonly string[];
  recordedAt: string;
}

export interface KyrubAgentAuditEvent {
  id: string;
  action:
    | 'agent.task.created'
    | 'agent.task.started'
    | 'agent.task.handoff'
    | 'agent.task.reviewed'
    | 'agent.task.merged'
    | 'agent.task.blocked'
    | 'agent.kill_switch.changed';
  actorAgent: KyrubAgentId;
  workstream: KyrubWorkstreamId;
  taskId: string;
  pullRequest: string;
  commitSha: string;
  result: string;
  createdAt: string;
}

export const KYRUB_AGENT_REGISTRY: readonly KyrubAgentDefinition[] = [
  {
    id: 'lead-orchestrator',
    title: 'Lead Architect / Orchestrator',
    workstream: 'cross-domain',
    canImplement: true,
    canReview: true,
    persistentExecutionEligible: false,
    ownerGateCategories: ['business', 'financial', 'legal', 'global-autonomy'],
  },
  {
    id: 'payments-agent',
    title: 'Payments Engineer',
    workstream: 'A',
    canImplement: true,
    canReview: true,
    persistentExecutionEligible: false,
    ownerGateCategories: ['real-money', 'credentials', 'pricing'],
  },
  {
    id: 'platform-secrets-agent',
    title: 'Platform / Secrets Engineer',
    workstream: 'B',
    canImplement: true,
    canReview: false,
    persistentExecutionEligible: false,
    ownerGateCategories: ['real-credentials', 'production-activation'],
  },
  {
    id: 'gamification-agent',
    title: 'Gamification Engineer',
    workstream: 'C',
    canImplement: true,
    canReview: true,
    persistentExecutionEligible: false,
    ownerGateCategories: ['economic-value-policy'],
  },
  {
    id: 'ai-platform-agent',
    title: 'AI Platform Engineer',
    workstream: 'D',
    canImplement: true,
    canReview: false,
    persistentExecutionEligible: true,
    ownerGateCategories: ['external-authority', 'paid-provider'],
  },
  {
    id: 'qa-security-agent',
    title: 'QA / Security Reviewer',
    workstream: 'F',
    canImplement: true,
    canReview: true,
    persistentExecutionEligible: true,
    ownerGateCategories: ['destructive-production-remediation'],
  },
  {
    id: 'compliance-agent',
    title: 'Compliance Drift Reviewer',
    workstream: 'G',
    canImplement: true,
    canReview: true,
    persistentExecutionEligible: true,
    ownerGateCategories: ['legal-conclusion', 'legal-publication'],
  },
  {
    id: 'ai-operations-agent',
    title: 'AI Operations Coordinator',
    workstream: 'E',
    canImplement: true,
    canReview: true,
    persistentExecutionEligible: true,
    ownerGateCategories: ['global-autonomy', 'kill-switch-policy'],
  },
] as const;

export const KYRUB_WORKSTREAM_REGISTRY: readonly KyrubWorkstreamDefinition[] = [
  { id: 'A', title: 'Payments / Marketplace E2E', ownerAgent: 'payments-agent', dependencies: ['B', 'F'], priority: 'P0' },
  { id: 'B', title: 'Admin Integrations / Credentials Vault', ownerAgent: 'platform-secrets-agent', dependencies: ['F'], priority: 'P0' },
  { id: 'C', title: 'Gamification / Clubs', ownerAgent: 'gamification-agent', dependencies: ['F', 'G'], priority: 'P1' },
  { id: 'D', title: 'External AI / MCP / Provider Router', ownerAgent: 'ai-platform-agent', dependencies: ['B', 'F', 'G'], priority: 'P1' },
  { id: 'E', title: 'AI Operations / Agent Control Plane', ownerAgent: 'ai-operations-agent', dependencies: ['F'], priority: 'P0' },
  { id: 'F', title: 'QA / Security / Infrastructure', ownerAgent: 'qa-security-agent', dependencies: [], priority: 'continuous' },
  { id: 'G', title: 'Legal / Compliance / Trust', ownerAgent: 'compliance-agent', dependencies: [], priority: 'continuous' },
] as const;

export const sanitizeAgentAuditEvent = (
  value: KyrubAgentAuditEvent
): KyrubAgentAuditEvent => ({
  ...value,
  id: value.id.trim(),
  taskId: value.taskId.trim(),
  pullRequest: value.pullRequest.trim(),
  commitSha: value.commitSha.trim(),
  result: value.result.trim(),
  createdAt: value.createdAt.trim(),
});
