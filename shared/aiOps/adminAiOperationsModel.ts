import type {
  KyrubAgentId,
  KyrubTaskRisk,
  KyrubTaskStatus,
  KyrubWorkstreamId,
} from './agentOperations';

export interface AdminAiAgentCard {
  agentId: KyrubAgentId;
  title: string;
  workstream: KyrubWorkstreamId | 'cross-domain';
  state: 'idle' | 'working' | 'blocked' | 'disabled';
  activeTaskCount: number;
  lastResult: string;
}

export interface AdminAiTaskCard {
  taskId: string;
  title: string;
  ownerAgent: KyrubAgentId;
  workstream: KyrubWorkstreamId;
  status: KyrubTaskStatus;
  risk: KyrubTaskRisk;
  pullRequest: string;
  blockedBy: readonly string[];
}

export interface AdminAiWorkstreamCard {
  id: KyrubWorkstreamId;
  title: string;
  ownerAgent: KyrubAgentId;
  criticalPath: boolean;
  blocked: boolean;
  dependencies: readonly KyrubWorkstreamId[];
}

export interface AdminAiExecutionCost {
  taskId: string;
  provider: string;
  unit: 'unknown' | 'tokens' | 'requests' | 'currency';
  amount: number | null;
  currency: string;
}

export interface AdminAiOperationsSnapshot {
  generatedAt: string;
  agents: readonly AdminAiAgentCard[];
  tasks: readonly AdminAiTaskCard[];
  workstreams: readonly AdminAiWorkstreamCard[];
  costs: readonly AdminAiExecutionCost[];
  failures: ReadonlyArray<{
    taskId: string;
    code: string;
    message: string;
  }>;
  killSwitches: ReadonlyArray<{
    id: string;
    enabled: boolean;
    scope: 'global' | 'agent' | 'workstream';
  }>;
}

export const emptyAdminAiOperationsSnapshot = (): AdminAiOperationsSnapshot => ({
  generatedAt: '',
  agents: [],
  tasks: [],
  workstreams: [],
  costs: [],
  failures: [],
  killSwitches: [],
});
