import type { User } from 'firebase/auth';

export type KyrubiaBridgeSession = {
  id: string;
  label: string;
  mode: 'proposal_only';
  scope: string[];
  createdAt: string;
  expiresAt: string;
  expiresAtMillis: number;
  revoked: boolean;
  token: string;
  tokenType: 'Bearer';
  mcpPath: '/api/mcp';
  warning?: string;
};

const errorFrom = async (response: Response, fallback: string): Promise<Error> => {
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const message = typeof payload.error === 'string' && payload.error.trim() ? payload.error.trim() : fallback;
  const code = typeof payload.code === 'string' && payload.code.trim() ? payload.code.trim() : '';
  return new Error(code ? `${message} (${code})` : message);
};

export const createKyrubiaBridgeSession = async (
  user: User,
  input: { ttlMinutes?: number; label?: string } = {}
): Promise<KyrubiaBridgeSession> => {
  const firebaseToken = await user.getIdToken();
  const response = await fetch('/api/kyrubia-bridge/session', {
    method: 'POST',
    cache: 'no-store',
    headers: {
      authorization: `Bearer ${firebaseToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ttlMinutes: input.ttlMinutes ?? 120,
      label: input.label ?? 'ChatGPT bridge',
    }),
  });
  if (!response.ok) throw await errorFrom(response, 'Não foi possível criar a conexão temporária.');
  return response.json() as Promise<KyrubiaBridgeSession>;
};

export const revokeKyrubiaBridgeSession = async (bridgeToken: string): Promise<void> => {
  const response = await fetch('/api/kyrubia-bridge/session/revoke', {
    method: 'POST',
    cache: 'no-store',
    headers: { authorization: `Bearer ${bridgeToken}` },
  });
  if (!response.ok) throw await errorFrom(response, 'Não foi possível revogar a conexão temporária.');
};

export const kyrubiaBridgeMcpUrl = (): string => `${window.location.origin}/api/mcp`;
