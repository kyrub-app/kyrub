import type { User } from 'firebase/auth';
import {
  hasAdminPermission,
  type AdminProfile,
} from './adminControlPlane';

export interface AdminOperationsHealthSnapshot {
  generatedAt: string;
  state: 'healthy' | 'attention' | 'critical';
  integration: {
    queued: number;
    processing: number;
    failed: number;
    connected: number;
    attention: number;
  };
  delivery: {
    available: number;
    accepted: number;
    delivering: number;
    waitingFallback: number;
    providerEscalations: number;
  };
}

const finiteCount = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : 0;

const parseState = (
  value: unknown
): AdminOperationsHealthSnapshot['state'] =>
  value === 'critical' || value === 'attention' ? value : 'healthy';

export const parseAdminOperationsHealth = (
  value: unknown
): AdminOperationsHealthSnapshot | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const integration = candidate.integration as Record<string, unknown> | undefined;
  const delivery = candidate.delivery as Record<string, unknown> | undefined;
  if (!integration || !delivery) return null;

  return {
    generatedAt:
      typeof candidate.generatedAt === 'string' ? candidate.generatedAt : '',
    state: parseState(candidate.state),
    integration: {
      queued: finiteCount(integration.queued),
      processing: finiteCount(integration.processing),
      failed: finiteCount(integration.failed),
      connected: finiteCount(integration.connected),
      attention: finiteCount(integration.attention),
    },
    delivery: {
      available: finiteCount(delivery.available),
      accepted: finiteCount(delivery.accepted),
      delivering: finiteCount(delivery.delivering),
      waitingFallback: finiteCount(delivery.waitingFallback),
      providerEscalations: finiteCount(delivery.providerEscalations),
    },
  };
};

export const loadAdminOperationsHealth = async (
  user: Pick<User, 'getIdToken'>,
  profile: AdminProfile
): Promise<AdminOperationsHealthSnapshot> => {
  if (!hasAdminPermission(profile, 'read_system_health')) {
    throw new Error('Seu papel não permite consultar a saúde do sistema.');
  }

  const token = await user.getIdToken();
  const response = await fetch('/api/admin/operations/health', {
    headers: { authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : 'Não foi possível consultar a saúde operacional.'
    );
  }
  const parsed = parseAdminOperationsHealth(payload);
  if (!parsed) throw new Error('O servidor retornou métricas inválidas.');
  return parsed;
};
