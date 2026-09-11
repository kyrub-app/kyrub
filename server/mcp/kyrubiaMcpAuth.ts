import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';

export type KyrubMcpPrincipal = {
  uid: string;
  email: string | null;
  name: string;
  authType: 'firebase_id_token' | 'bridge_session';
  bridgeSessionId?: string;
  bridgeMode?: 'proposal_only';
};

export class KyrubMcpAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'KyrubMcpAuthError';
  }
}

const enabled = (name: string): boolean =>
  /^(1|true|yes|on)$/i.test(process.env[name]?.trim() ?? '');

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

export const assertKyrubMcpEnabled = (): void => {
  if (!enabled('KYRUB_MCP_ENABLED')) {
    throw new KyrubMcpAuthError(
      503,
      'MCP_DISABLED',
      'A integração externa da Kyrubia ainda não está habilitada neste ambiente.'
    );
  }
};

export const verifyKyrubMcpAuthorization = async (
  authorization: string
): Promise<KyrubMcpPrincipal> => {
  assertKyrubMcpEnabled();

  const token = bearerToken(authorization);
  if (!token) {
    throw new KyrubMcpAuthError(401, 'AUTH_REQUIRED', 'Autenticação obrigatória.');
  }

  if (token.startsWith('kbv0.')) {
    const bridge = await import('./kyrubiaBridgeSessionService.js');
    return bridge.verifyKyrubiaBridgeAuthorization(authorization);
  }

  if (!enabled('KYRUB_MCP_ALLOW_FIREBASE_ID_TOKEN')) {
    throw new KyrubMcpAuthError(
      401,
      'MCP_EXTERNAL_AUTH_NOT_CONFIGURED',
      'A autenticação externa da Kyrubia ainda não foi configurada.'
    );
  }

  try {
    const decoded = await verifyFirebaseIdToken(token);
    return {
      uid: decoded.uid,
      email: typeof decoded.email === 'string' ? decoded.email : null,
      name: typeof decoded.name === 'string' && decoded.name.trim()
        ? decoded.name.trim()
        : 'Usuário do Kyrub',
      authType: 'firebase_id_token',
    };
  } catch {
    throw new KyrubMcpAuthError(401, 'INVALID_TOKEN', 'A credencial informada é inválida ou expirou.');
  }
};
